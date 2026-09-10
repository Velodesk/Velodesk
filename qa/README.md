# Claudio Q.A. — Agente de QA do Velodesk

Monitoramento automático das principais funções do CRM, duas vezes por dia útil
(07h e 17h). Cada rodada alimenta uma planilha consolidada em
`qa/relatorios/Consolidado_QA_Velodesk.xlsx`.

**VERSION: v1.0.0 | DATE: 2026-09-08**

---

## O que ele testa

| Área | Casos |
|---|---|
| Saúde do sistema | API no ar, bancos conectados, transporte de e-mail, entrada de tickets, login, contadores |
| Tickets novos | criação pela API de entrada, busca por protocolo, proteção contra duplicidade, fila, contador de protocolo, volume de 24h |
| Mensagens e respostas | anotação interna, resposta pública, tabulação, encaminhamento para grupo |
| Finalização | trava de responsável, trava de tabulação, finalizar de verdade, rotinas automáticas de 48h |
| Mesclas | mesclar dois tickets, absorvido sai da fila, trava de CPF divergente, mesclas do dia |
| Envios de e-mail | disparos de 24h, modelos do CSAT e da repescagem, e-mail do ticket de teste, auditoria da lista segura |
| CSAT | registro da nota, notas inválidas, avaliação não enviada, idempotência, página do cliente, números e rotina de envio |
| Erros | erros de servidor, erros no console, tickets sem protocolo, tickets travados, módulos do console |
| Telas | login, "Meu dia", fila de atendimento, ticket aberto (com print de cada uma) |

O catálogo completo está em [`src/catalogo.ts`](src/catalogo.ts) — é a fonte da
verdade e o que vira linha na planilha.

## As travas de segurança

O agente roda **em produção**. Estas são as travas que impedem qualquer efeito
sobre cliente real:

1. **Lista de e-mails seguros (`QA_EMAIL_ALLOWLIST`)** — os únicos endereços que
   o agente pode usar. Lista vazia = o agente não roda.
2. **Trava no backend** — `backend/src/services/qaEmailGuard.service.ts` recusa,
   no próprio caminho de envio, qualquer e-mail de ticket marcado como QA para
   endereço fora da lista. Vale mesmo se o script de teste estiver errado.
3. **CPF fictício próprio (`QA_CLIENT_CPF`)** — os tickets de teste nunca usam
   CPF de cliente. O cadastro desse CPF é conferido a cada rodada: se aparecer
   e-mail fora da lista, a rodada aborta.
4. **Só escreve no que ele mesmo criou** — toda escrita passa por
   `exigirTicketDeQa()`, que confere a marca de origem antes de tocar no ticket.
5. **Print só de ticket de QA** — a checagem de tela nunca abre ticket de
   cliente real, para não expor dado pessoal em imagem.
6. **Limpeza no fim** — os tickets de teste são fechados, saindo das filas e das
   rotinas automáticas (inclusive da pesquisa de satisfação).

> Os CPFs `12345678901`, `11122233300` e `901000000xx` são **proibidos**: o
> backend apaga tickets com esses CPFs em todo boot (`seed.service.ts`).

## Rodar localmente

```bash
cd qa
cp .env.example .env      # preencha as variáveis
npm install
npm run navegador         # baixa o Chromium (só a primeira vez)

npm run qa                # rodada completa
npm run qa:leitura        # só leitura: não cria nada, não envia e-mail
npm run qa:sem-navegador  # sem a camada de telas
npm run typecheck
```

Comece sempre por `npm run qa:leitura` num ambiente novo: ele valida acesso,
conexões e números sem escrever nada.

## Rodar no GitHub Actions

O workflow é `.github/workflows/qa-velodesk.yml`. Ele não interfere em nenhum
outro processo do repositório: o deploy do frontend (Vercel) só executa
`vite build` dentro de `frontend/`, e o do backend usa `Dockerfile`/
`cloudbuild.yaml` — nenhum dos dois olha para `qa/` ou `.github/`.

Secrets necessários em **Settings → Secrets and variables → Actions**:

| Secret | Para quê |
|---|---|
| `QA_BASE_URL` | origem do Velodesk (ex.: `https://velodesk-....run.app`) |
| `QA_API_URL` | só se a API estiver em outro host |
| `QA_EMAIL_ALLOWLIST` | e-mails seguros, separados por vírgula |
| `QA_LOGIN_EMAIL` / `QA_LOGIN_PASSWORD` | colaborador de QA com acesso ao Desk |
| `QA_RESPONSAVEL` | nome do responsável usado ao finalizar (opcional) |
| `QA_INBOUND_QA_TESTE_SECRET` | secret da origem dedicada "qa-teste" no canal de entrada de tickets |
| `QA_CLIENT_CPF` | CPF fictício dos tickets de teste |
| `QA_MONGODB_URI` | conexão de leitura do MongoDB |
| `QA_OPENAI_API_KEY` | chave da IA que escreve a coluna Devolutiva (opcional) |
| `QA_GEMINI_API_KEY` | alternativa à chave da OpenAI (opcional) |

O mesmo `QA_EMAIL_ALLOWLIST` precisa estar configurado **no ambiente do backend
em produção** (Cloud Run → Variables), senão a trava do item 2 bloqueia todo
e-mail de ticket de QA — que é o comportamento seguro, mas deixa os casos de
e-mail sempre com ressalva.

## A planilha

`qa/relatorios/Consolidado_QA_Velodesk.xlsx`, com três abas:

- **Resumo por rodada** — uma linha por rodada: situação geral, quantos testes
  passaram, falharam ou ficaram com ressalva, e o que precisa de atenção.
- **Casos de Teste** — uma linha por caso testado, no mesmo formato do
  consolidado manual (Área / Objetivo / Resultado esperado / OK? / Observação),
  mais a coluna **Devolutiva (sugestão da IA)**: uma orientação curta de
  correção para cada caso que não passou. Caso que passou fica com a coluna em
  branco, porque não há nada a corrigir.
- **Números do dia** — indicadores por rodada (tickets criados, e-mails
  disparados, CSAT enviado e respondido, acúmulos), com Normal / Atenção / Alerta.

Valores da coluna **OK?**: `Sim`, `Nao`, `Parcial`, `Falha conhecida`,
`Bloqueado`, `Nao testavel`, `Nao testado`.

`Falha conhecida` é falha já mapeada pelo time (as do consolidado de 21/08:
resposta pública no Compose, tabulação automática, encaminhar para grupo). Elas
são testadas e registradas, mas não contam como regressão nova — o alarme fica
reservado para o que quebrou de novo.

## A devolutiva sugerida pela IA

A coluna **Devolutiva** é preenchida automaticamente com uma orientação de até
240 caracteres dizendo onde olhar primeiro. São duas camadas:

1. **Orientação base do catálogo** (`src/orientacoes.ts`) — escrita à mão, uma
   por caso de teste. É o que entra quando não há chave de IA configurada, e é
   também o contexto enviado à IA para a sugestão não sair genérica.
2. **Sugestão da IA** — uma única chamada por rodada, com todos os casos que não
   passaram (no máximo 25, priorizando falhas novas). Usa a mesma configuração
   do projeto: `OPENAI_API_KEY`/`OPENAI_MODEL` ou, na falta, `GEMINI_API_KEY`.

Se a chamada falhar ou a resposta vier inaproveitável, a coluna cai na
orientação base e o motivo aparece na aba **Resumo por rodada**. A coluna nunca
fica vazia num caso que falhou, e nunca depende da IA para a rodada terminar.

`QA_IA_DESATIVADA=true` desliga a chamada e usa só a orientação base.

> A devolutiva é **sugestão**, não diagnóstico confirmado. Ela aponta onde
> começar a investigar; quem decide a correção é o time.

## Manutenção

- **Novo caso de teste**: adicione no catálogo (`src/catalogo.ts`) e implemente a
  checagem no módulo da área em `src/checks/`. O que estiver no catálogo e não
  for executado aparece na planilha como `Nao testado` — nada desaparece
  silenciosamente.
- **Bug conhecido foi corrigido**: remova o campo `conhecida` do caso. A partir
  daí, se falhar de novo, volta a soar alarme.
- **Mudou a estrutura da tela**: os seletores usados estão em `src/checks/ui.ts`.
  O frontend tem quase nenhum `data-testid`, então as âncoras são `id` e classes
  (`#crmQueuePanel`, `section.ws360-kpis`, `nav.tabs-top`).
