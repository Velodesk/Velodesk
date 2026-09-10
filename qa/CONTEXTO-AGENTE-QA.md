# Contexto do agente de QA — continuação do trabalho

Documento de passagem de bastão. Foi escrito para que uma sessão nova de
Claude Code (ou qualquer pessoa do time) continue este trabalho sem precisar
redescobrir nada.

**VERSION: v1.0.0 | DATE: 2026-09-08 | Origem: sessão de Cowork com a Nathália**

---

## 1. Objetivo

Este agente se chama **Claudio Q.A.** (nome oficial, decidido pela Nathália em 09/09).

Agente de QA que testa automaticamente as principais funções do Velodesk duas
vezes por dia útil (07h e 17h de Brasília) e alimenta uma planilha consolidada
em `qa/relatorios/Consolidado_QA_Velodesk.xlsx`.

Áreas cobertas, definidas pela Nathália: **envios de e-mail, CSAT, mesclas,
tickets novos, finalização e erros** — mais saúde do sistema e telas.

## 2. Decisões já tomadas (não reabrir sem falar com ela)

| Decisão | Escolha |
|---|---|
| Abordagem | Testes de fluxo real pela API **+** checagens por dados **+** smoke de tela no navegador |
| Ambiente | **Produção**, com dados de teste e lista de e-mails seguros |
| Onde roda | GitHub Actions, `.github/workflows/qa-velodesk.yml` |
| Frequência | Duas vezes por dia útil: 10:00 e 20:00 UTC (07h e 17h BRT) |
| Saída | **Um único Excel** alimentado a cada rodada (não um arquivo por dia) |
| Falhas já mapeadas | Registradas como `Falha conhecida`, sem alarme |
| Trava de e-mail | No **backend**, na camada de envio — não só no script de teste |
| Coluna Devolutiva | Preenchida por IA com orientação curta de correção |

## 3. Mapa de arquivos

```
qa/
  src/
    config.ts        variáveis + travas de segurança (validarConfig, exigirEmailSeguro)
    catalogo.ts      OS 49 CASOS DE TESTE — fonte da verdade, vira linha na planilha
    orientacoes.ts   orientação de correção escrita à mão, uma por caso
    ia.ts            devolutiva sugerida pela IA (1 chamada por rodada, com fallback)
    resultado.ts     coletor de resultados e métricas
    api.ts           cliente HTTP do Velodesk
    db.ts            leitura do MongoDB + exigirTicketDeQa (trava de escrita)
    contexto.ts      estado compartilhado da rodada
    relatorio.ts     alimenta o Excel consolidado
    limpeza.ts       fecha os tickets criados pela rodada
    run.ts           orquestrador
    checks/          saude, tickets, finalizacao, mescla, csat, emails, erros, ui
.github/workflows/qa-velodesk.yml
backend/src/services/qaEmailGuard.service.ts    (novo)
```

Alterações em arquivos que já existiam — **apenas estas três**, 5 linhas cada,
inserindo a trava antes do `sendOutboundEmail`:

- `backend/src/services/csatEmail.service.ts`
- `backend/src/services/emailNotification.service.ts`
- `backend/src/services/emailTrigger.service.ts`

## 4. Travas de segurança — não remover nenhuma

O agente roda em produção. Estas seis camadas é que tornam isso aceitável:

1. **`QA_EMAIL_ALLOWLIST`** — únicos endereços que o QA pode usar. Lista vazia
   faz o agente **não rodar** (`validarConfig` lança).
2. **`qaEmailGuard.service.ts` no backend** — recusa, no caminho de envio, todo
   e-mail de ticket marcado como QA para endereço fora da lista. É a trava que
   sobrevive a erro no script de teste. Ticket de cliente real não é afetado.
3. **CPF fictício próprio (`QA_CLIENT_CPF`)** — conferido a cada rodada
   (`garantirClienteQa`): se o cadastro tiver e-mail fora da lista, a rodada
   aborta antes de escrever.
4. **`exigirTicketDeQa()`** — toda escrita confere a marca de origem
   (`registro[].metadados.inboundTicketMetadata.origemQa === 'qa-velodesk'`)
   antes de tocar no ticket.
5. **Print só de ticket de QA** — o smoke de tela nunca abre ticket de cliente
   real, para não expor dado pessoal em imagem.
6. **Limpeza no fim** — os tickets de teste são fechados, saindo das filas e das
   rotinas automáticas, inclusive da pesquisa de satisfação.

**Exceção deliberada — caso E08 (09/09, decisão da Nathália):** é o único caso
que lê conteúdo de ticket de CLIENTE REAL (o texto de um e-mail automático que
já saiu de verdade), pra revisar qualidade de mensageria por IA. Antes de
mandar pra IA (OpenAI/Gemini, serviço externo), o primeiro nome do cliente é
trocado por `"[cliente]"` (`redigirNome()` em `checks/mensageria.ts`) — CPF e
nome completo nunca saem da máquina, só o texto redigido. Amostra pequena (5
por rodada) e nunca inclui ticket de QA (`filtroQa()` excluído). Se decidir
reabrir essa decisão, é aqui que ela foi tomada — não é a mesma trava das
outras seis, é uma exceção consciente a "nunca toca em dado de cliente real".

## 5. Estado: o que está verificado e o que não está

**Verificado**
- `tsc --noEmit` limpo em `qa/` e em `backend/`.
- Alimentação da planilha em rodadas seguidas (achou e corrigiu um bug: ao
  reabrir o arquivo salvo o ExcelJS perde as chaves das colunas e a segunda
  rodada gravava linhas em branco — por isso `novaLinha()` monta a linha pela
  ordem das colunas, e não por chave).
- Degradação: sem banco, sem login e sem navegador a rodada termina e registra
  cada caso como `Bloqueado` com o motivo, em vez de quebrar.
- Devolutiva nos 5 caminhos, com chamada simulada: IA respondeu, IA fora do ar,
  IA devolveu texto inválido, sem chave, IA desligada.

**NÃO verificado — é aqui que a continuação começa**
- Nenhuma rodada real contra produção. O ambiente da sessão não tinha saída de
  rede para `velodesk-278491073220.us-east1.run.app`.
- A chamada real à API da OpenAI/Gemini (só testada com resposta simulada).
- Os seletores de tela do `checks/ui.ts` nunca rodaram contra a tela real.
- O workflow nunca executou no GitHub Actions.

## 6. Pendências, em ordem

1. Criar a caixa de e-mail de QA e cadastrá-la no CPF de teste.
2. `cd qa && cp .env.example .env`, preencher, e rodar **`npm run qa:leitura`**
   (não escreve nada). Corrigir o que aparecer.
3. Rodar `npm run qa` completo uma vez, com acompanhamento, e conferir na
   planilha se os 49 casos fecham com resultado coerente.
4. Revisar os diffs dos 3 arquivos de backend e configurar
   `QA_EMAIL_ALLOWLIST` nas variáveis do Cloud Run. **A trava só passa a valer
   depois do deploy do backend.**
5. Cadastrar os secrets no GitHub e disparar o workflow manualmente
   (`workflow_dispatch`) antes de confiar no agendamento.
6. Ajustar os seletores de `checks/ui.ts` conforme o que a tela real mostrar.

## 7. Comandos

```bash
cd qa
npm install
npm run navegador        # baixa o Chromium (primeira vez)
npm run qa:leitura       # só leitura — comece por aqui
npm run qa               # rodada completa
npm run qa:sem-navegador
npm run typecheck
```

## 8. Fatos do código que custaram tempo para descobrir

Guardados aqui porque **contrariam a documentação do repo** ou não estão
escritos em lugar nenhum:

- **Protocolo**: o formato real é `AAMMDDXXXX` numérico (`protocolo.service.ts`).
  Os docs `api-inbound-tickets-*.md` dizem `VD-YYYYMMDD-####` e estão
  **desatualizados**. Valide contra `/^\d{10}$/`.
- **`purgeAllMockTickets()` roda em TODO boot do backend** (`index.ts` →
  `seed.service.ts`) e faz `deleteMany`. Por isso são **proibidos** em dados de
  teste: título começando com `[TESTE]`, os CPFs `12345678901`, `11122233300`,
  `901000000xx`, e e-mails `@email-teste.com`. O CPF proibido `12345678901` é
  justamente o do exemplo dos docs.
- **Não existe campo `status`** no ticket. O status corrente é o `status` do
  **último item de `registro[]`** (`currentStatus()`), e mudança de status é
  sempre um item novo empilhado (`appendStatusTransition()`), nunca `$set`.
  Não existe campo com a data de finalização.
- **Encerrar exige duas coisas**: responsável real e tabulação completa — dois
  erros 400 diferentes. E `assertResponsavelForTerminalStatus` lê o responsável
  **já gravado no ticket**, não o que vem no corpo da requisição. Por isso o
  caso F02 faz um passo preparatório com status `em-espera` (que não exige
  tabulação) antes de testar a trava de tabulação.
- **CSAT não é disparado ao resolver**: quem envia é um job horário, 48 horas
  **úteis** depois, e **só se o modelo "Encerramento mais satisfação" existir e
  estiver ativo** em `email_conteudos`. Antes de `POST /api/csat`, o ticket
  precisa ter `csat.enviado === true`, senão a resposta é 404.
- **`sendOutboundEmail` nunca lança** — devolve `{sent, reason}`. Tem exatamente
  4 chamadores; 3 têm um `chamado` em escopo (são os que receberam a trava) e o
  4º é alerta interno de gestão. Sem transporte configurado, o CSAT **não grava
  nada** no ticket: retorna antes.
- **E-mail do cliente não está no ticket**. Fica em `b2c_cadastros.clientes`,
  em `clienteDados[].clienteEmail.{lista,resposta}`, resolvido por
  `resolveClienteEmailFromChamado()`.
- **Criar ticket sem JWT**: `POST /api/inbound/tickets` com header
  `x-inbound-app-secret` (35 caracteres `a-z0-9`). Mínimo: `externalId`,
  `title`, `text`, `clientName` e um entre CPF, telefone e e-mail. O campo
  `metadata` é gravado em `registro[0].metadados.inboundTicketMetadata` — é ali
  que fica a marca de QA.
- **Login automatizável**: `POST /api/login` com e-mail e senha existe e
  funciona, mesmo com o frontend em modo Google. Para abrir as telas, injete no
  `localStorage`: `velodesk_token`, `velodesk_user`, `velodesk_colaborador`,
  `velodesk_gate_authorized='1'`, `velodesk_auth_mode='cadastro-desk'`. O
  colaborador precisa de `acessos.Desk === true`.
- **O frontend tem 1 (um) `data-testid` em todo o `src`**. As âncoras usadas
  são `id` e classes: `#crmQueuePanel`, `#queueStatusList li[data-queue]`,
  `section.ws360-kpis`, `article.ws360-kpi`, `nav.tabs-top`,
  `li.crm-ticket-card[data-ticket-id]`. O Desk em `?desk=v2` é renderizado num
  **portal fora do `#root`**, na `div#velodeskDeskV2Root`.
- **Fila e ticket aberto são a mesma rota**: `/tickets?desk=v2&ticket=<id>&queue=<fila>`.
- **Erro de API no console** sai como `console.error('[VeloDesk] API', '<METHOD> <url> FALHOU', …)`.
  O `console.warn` com "console operacional ATIVO" é esperado no load — filtre.

## 9. Como continuar no VS Code

1. Abra a pasta `velodesk` no VS Code.
2. No terminal integrado, rode `claude` (ou use a extensão do Claude Code).
3. Peça para ler este arquivo primeiro:
   `leia qa/CONTEXTO-AGENTE-QA.md e continue da pendência 2`.

Para que toda sessão carregue este contexto sozinha, crie um `CLAUDE.md` na
raiz do repositório com uma linha apontando para cá. Hoje o repo não tem
`CLAUDE.md` — foi decisão consciente não criar um, porque ele passa a valer
como instrução para o repositório inteiro, não só para o `qa/`.
