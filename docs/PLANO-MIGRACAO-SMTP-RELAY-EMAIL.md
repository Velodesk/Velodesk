# Plano — Migração do envio de e-mail para Google Workspace SMTP Relay

## Contexto

Desde a troca do remetente de outbound de `suporte@velotax.com.br` para
`atendimento@velotax.com.br` (2026-09-22/23), os envios via Gmail API
(`gmail.users.messages.send`, domain-wide delegation) passaram a falhar de
forma sustentada com `User-rate limit exceeded (Mail sending)`.

Investigação (2026-09-23):

- A cota do projeto GCP para a Gmail API **não é o gargalo** — está em
  15.000 req/min por usuário e 1,2M/min no projeto (`serviceusage`
  `consumerQuotaMetrics`), bem acima do volume real.
- O erro vem do **sistema interno de anti-abuso do Gmail** para envio de
  mensagens, que é separado das cotas de API do Cloud Console e reage ao
  padrão de envio daquele *client* específico (a service account com
  domain-wide delegation), não ao volume histórico da caixa por outro
  canal.
- `atendimento@velotax.com.br` já tinha volume alto de envio via
  **Octadesk** (provedor externo), mas isso passava pela infraestrutura
  de envio própria do Octadesk (SMTP/relay externo) — um caminho sem
  nenhuma relação de reputação com a integração via Gmail API que o
  Velodesk usa agora. Por isso o volume histórico não "protege" o novo
  client.

Mitigação já aplicada em produção (curto prazo):
- Throttle serializado entre envios (`EMAIL_SEND_MIN_INTERVAL_MS`, ver
  [email-outbound.service.ts](../backend/src/services/email-outbound.service.ts)).
- Remoção do retry interno de 3x (competia com o throttle e multiplicava
  chamadas durante o throttling sustentado).
- Pausa temporária de envio (`EMAIL_ENABLED=false`) para permitir a
  janela de rate limit do Gmail se recompor, seguida de reativação
  gradual ("aquecimento").

Essas mitigações reduzem o problema mas não o eliminam: dependem do
algoritmo de reputação do Gmail para essa integração específica amadurecer
ao longo de dias, o que é imprevisível.

## Decisão de produto

- O remetente de outbound em produção continua sendo exclusivamente
  `atendimento@velotax.com.br` — não haverá rotação entre múltiplas
  caixas de e-mail.
- `suporte@velotax.com.br` deixará de ter função de outbound em produção
  e passará a ser usado exclusivamente no ambiente `dev-velotax` para
  testes (mudança futura, fora do escopo deste plano).

## Proposta: Google Workspace SMTP Relay Service

Migrar o transporte de envio da Gmail API para o
**SMTP Relay Service** do Google Workspace (`smtp-relay.gmail.com`).

### Por que

- É um serviço separado da Gmail API, desenhado especificamente para
  aplicações/sistemas enviando e-mail em nome de um usuário do domínio
  (exatamente o caso de uso do Velodesk).
- Tem cota própria, dimensionada para volume de aplicação (não de
  usuário individual) — Google divulga limites da ordem de milhares de
  mensagens/dia por licença.
- Não está sujeito ao mesmo throttle de "client novo" que está afetando
  a integração atual via API.

### Autenticação — duas opções

1. **SMTP autenticado (OAuth2 XOAUTH2 ou usuário/senha de app)**
   - Funciona de qualquer IP de saída, inclusive o IP dinâmico do Cloud
     Run.
   - Reaproveita a mesma service account com domain-wide delegation já
     configurada (escopo adicional `https://mail.google.com/` ou
     `gmail.send` conforme exigido pelo relay autenticado).
   - Caminho recomendado — não depende de infraestrutura de rede
     adicional.

2. **SMTP relay por IP liberado (sem autenticação)**
   - Exige IP de saída fixo do Cloud Run, o que requer configurar
     **Cloud NAT com IP estático** (trabalho de infra adicional, custo
     recorrente do NAT).
   - Só vale a pena se a autenticação OAuth2 no relay se mostrar
     inviável.

### Escopo da migração no código

- Reaproveitar a montagem MIME já existente em
  [gmailApiSend.ts](../backend/src/services/gmail/gmailApiSend.ts)
  (`buildRawRfc822` e afins) — a lógica de headers, threading
  (`Message-ID`/`In-Reply-To`/`References`), anexos e imagens inline
  não muda.
- Trocar apenas a camada de transporte: usar `nodemailer` com
  `createTransport({ host: 'smtp-relay.gmail.com', ... })` no lugar de
  `gmail.users.messages.send`.
- Manter a mesma interface pública (`sendViaGmailApi` → renomear para
  algo neutro tipo `sendOutboundMail`) para não exigir mudanças em
  `email-outbound.service.ts`, `emailTrigger.service.ts`,
  `emailNotification.service.ts`, `csatEmail.service.ts`.
- Manter o throttle serializado já implementado — SMTP relay também tem
  limites, ainda que mais folgados.

### Pré-requisitos a validar antes de implementar

- [ ] Confirmar no Admin Console do Workspace se o SMTP Relay Service
      está habilitado para o domínio `velotax.com.br` e quais opções de
      autenticação estão permitidas.
- [ ] Definir se a autenticação será via OAuth2 XOAUTH2 (reaproveitando
      a service account) ou credencial dedicada.
- [ ] Confirmar limites de volume/dia aplicáveis à licença do Workspace
      da Velotax.

### Alternativa em paralelo (não excludente)

Abrir chamado no **Google Workspace Support** (não é "quota increase" do
Cloud Console) explicando a migração do Octadesk para a integração via
Gmail API, solicitando revisão/liberação do padrão de envio da
integração atual. Pode resolver o problema na API sem precisar migrar
o transporte — mas é um processo com prazo fora do nosso controle.

## Próximos passos

1. Manter throttle + aquecimento gradual rodando em produção (já feito).
2. Validar pré-requisitos do SMTP Relay Service no Admin Console.
3. Implementar a troca de transporte em `gmailApiSend.ts` conforme
   escopo acima, com testes em `dev-velotax` usando `suporte@` antes de
   promover para produção.
4. Avaliar em paralelo o chamado ao Workspace Support.
