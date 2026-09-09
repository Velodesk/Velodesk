# API Inbound Tickets — Chat

<!-- VERSION: v1.0.0 | DATE: 2026-09-09 | AUTHOR: VeloHub Development Team -->

Documento para **homologação e uso** da API de **abertura e continuidade de tickets** no Velodesk a partir do canal de **Chat** (widget de chat, disparo único por mensagem — não é uma sessão de chat ao vivo mantida pelo servidor).

- **Coleção MongoDB:** `b2c_chamados.chamados_n1`
- **Backend:** `desk/backend` — rota em `backend/src/routes/inbound.routes.ts`
- **Canal aplicado automaticamente pelo servidor:** **`Chat`**

> Cada mensagem do cliente (abertura ou resposta) é uma chamada independente a este endpoint. Quem envia o chat decide se é uma mensagem nova (sem `chamadoProtocolo`) ou continuidade de um ticket já aberto (com `chamadoProtocolo`).

---

## URL base (produção)

**Base URL:** `https://velodesk-278491073220.us-east1.run.app`

| Endpoint | URL completa |
|----------|--------------|
| Health | `https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets/health` |
| Criar/Responder ticket | `https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets` |

---

## Autenticação e segurança

A rota `POST /api/inbound/tickets` exige **somente** os headers abaixo:

```http
Content-Type: application/json
X-Inbound-Chat-Secret: <chave_35_caracteres>
```

| Header | Obrigatório | Descrição |
|--------|-------------|-----------|
| `Content-Type` | Sim | `application/json` |
| `X-Inbound-Chat-Secret` | Sim | Chave exclusiva do Chat (`INBOUND_TICKET_CHAT_SECRET` no servidor Velodesk) |

### Formato da chave

- Exatamente **35 caracteres**
- Apenas letras minúsculas (`a-z`) e números (`0-9`)

A chave real será entregue **separadamente** pela equipe VeloHub — não commitar em repositórios.

### Respostas de autenticação

| HTTP | Corpo | Causa |
|------|-------|-------|
| `401` | `{ "message": "Header de autenticação inbound ticket ausente" }` | Header `X-Inbound-Chat-Secret` ausente |
| `401` | `{ "message": "Chave inbound ticket inválida — use 35 caracteres [a-z0-9]" }` | Formato da chave incorreto |
| `401` | `{ "message": "Chave inbound ticket incorreta" }` | Valor da chave errado |
| `400` | `{ "message": "Informe apenas um header de autenticação por requisição" }` | Mais de um header `X-Inbound-*-Secret` enviado junto |
| `503` | `{ "message": "Inbound tickets desabilitado" }` | `INBOUND_TICKETS_ENABLED=false` |
| `503` | `{ "message": "Inbound tickets desabilitado — secret ausente (chat)" }` | Produção sem secret configurado |

---

## Health check (sem autenticação)

```http
GET https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets/health
```

**Resposta `200`:**

```json
{
  "status": "ok",
  "enabled": true,
  "apiVersion": "1.0.0",
  "origins": ["app", "telefone", "agente-ia", "chat"],
  "secretFormat": "[a-z0-9]{35}"
}
```

---

## POST — Abrir ticket (primeira mensagem do chat)

```http
POST https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets
Content-Type: application/json
X-Inbound-Chat-Secret: <chave_35_caracteres>
```

### Payload

**Obrigatórios:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `externalId` | string | ID único **desta mensagem** (idempotência em retry) |
| `title` ou `chamadoTitulo` | string | Título do chamado (assunto/primeira mensagem resumida) |
| `text` ou `description` | string | Mensagem do cliente |
| `clientName` | string | Nome do cliente |

**Identificação do cliente (ao menos um):**

| Campo | Tipo |
|-------|------|
| `clientCPF` | string |
| `clientPhone` | string |
| `clientEmail` | string |

**Opcionais:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `attachments` | string[] | URLs de anexos já hospedados |
| `priority` | string | `baixa`, `media` ou `alta` |
| `produto`, `motivo`, `detalhe` | string | Tabulação |
| `tipoChamado` / `classificacaoTipo` | string | Default: `Solicitação` |
| `metadata` | object | Dados extras (ex.: `chatSessionId`, página de origem) |

**Não enviar:**

- `canal` — ignorado; o servidor grava **`Chat`** automaticamente

### Exemplo

```json
{
  "externalId": "chat-sess-abc123-msg1",
  "title": "Dúvida sobre cupom",
  "text": "Oi, meu cupom não aplicou o desconto no app.",
  "clientName": "Mariana Silva",
  "clientCPF": "12345678901",
  "metadata": {
    "chatSessionId": "sess-abc-123",
    "pagina": "carrinho"
  }
}
```

### Respostas

**`201` — ticket criado:**

```json
{
  "action": "created",
  "ticketId": "674a1b2c3d4e5f6789012345",
  "chamadoProtocolo": "VD-20260909-0188",
  "canal": "Chat"
}
```

**`200` — retry com mesmo `externalId` (idempotente):**

```json
{
  "action": "duplicate",
  "ticketId": "674a1b2c3d4e5f6789012345",
  "chamadoProtocolo": "VD-20260909-0188",
  "canal": "Chat"
}
```

**`400` — payload inválido:**

```json
{
  "message": "externalId é obrigatório"
}
```

---

## POST — Responder / dar continuidade a um ticket já aberto

O **mesmo endpoint** serve para anexar novas mensagens do cliente a um ticket já existente — é assim que o chat mantém a conversa depois da primeira mensagem, e também é o que permite ao cliente responder a um ticket que ele viu através da API de leitura do App (ver seção abaixo).

Basta incluir `chamadoProtocolo` no payload. Quando esse campo vem preenchido:

- `title`/`chamadoTitulo` **deixa de ser obrigatório**.
- `externalId` continua obrigatório e **deve ser único por mensagem** — não reaproveite o `externalId` da mensagem anterior da mesma conversa.
- O `text`/`description` é anexado como nova mensagem pública do cliente no ticket.

### Payload (resposta)

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|--------------|-----------|
| `externalId` | string | Sim | ID único **desta mensagem** |
| `chamadoProtocolo` | string | Sim (para responder) | Protocolo do ticket a continuar (`VD-YYYYMMDD-####`) |
| `text` ou `description` | string | Sim | Conteúdo da mensagem |
| `clientName` | string | Sim | Nome do cliente |
| `clientCPF` / `clientPhone` / `clientEmail` | string | Ao menos um | Mesma identificação usada na criação |
| `attachments` | string[] | Não | URLs de anexos já hospedados |
| `metadata` | object | Não | Dados extras da mensagem |

### Exemplo

```json
{
  "externalId": "chat-sess-abc123-msg2",
  "chamadoProtocolo": "VD-20260909-0188",
  "text": "Já tentei de novo e continua sem aplicar o cupom.",
  "clientName": "Mariana Silva",
  "clientCPF": "12345678901"
}
```

### Respostas

**`200` — mensagem anexada ao ticket existente:**

```json
{
  "action": "replied",
  "ticketId": "674a1b2c3d4e5f6789012345",
  "chamadoProtocolo": "VD-20260909-0188",
  "canal": "Chat"
}
```

**`400` — protocolo informado não existe:**

```json
{
  "message": "chamadoProtocolo inválido — ticket não encontrado"
}
```

**`201` — ticket novo criado (não anexado):** se o ticket referenciado por `chamadoProtocolo` estiver **fechado**, **cancelado** ou **resolvido há mais de 48h**, o servidor não reabre — cria um ticket novo automaticamente, com nota interna registrando a origem (`Novo ticket derivado de VD-20260909-0188`). A resposta é igual à de criação (`action: "created"`, `chamadoProtocolo` novo).

> Reenviar o mesmo `externalId` de uma resposta (retry) devolve `200` com `action: "duplicate"`, sem duplicar a mensagem.

---

## Como o widget de chat descobre qual `chamadoProtocolo` usar

Este endpoint só cria e anexa mensagens — ele não lista tickets. Para o cliente ver o histórico e escolher a qual ticket responder (ex.: depois de fechar e reabrir o chat/app), quem integra o chat deve manter esse vínculo do lado dele (guardando o `chamadoProtocolo` retornado na criação) **ou** usar a API de leitura dedicada ao App:

```http
GET /api/inbound/tickets/client?clientCPF=...&clientPhone=...&clientEmail=...
X-Inbound-App-Secret: <chave_35_caracteres>
```

Essa leitura é **exclusiva da origem App** (autenticação server-to-server com `X-Inbound-App-Secret`) — o canal Chat não tem acesso direto a ela. Se o chat roda dentro do App, o backend do App é quem consulta essa lista e repassa o `chamadoProtocolo` correto para a próxima chamada de resposta do chat.

---

## Exemplo curl

```powershell
# Abrir ticket
curl.exe -s -X POST "https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets" `
  -H "Content-Type: application/json" `
  -H "X-Inbound-Chat-Secret: <chave_35_caracteres>" `
  -d "{\"externalId\":\"chat-sess-abc123-msg1\",\"title\":\"Dúvida sobre cupom\",\"text\":\"Meu cupom não aplicou o desconto.\",\"clientName\":\"Mariana Silva\",\"clientCPF\":\"12345678901\"}"

# Responder ao mesmo ticket
curl.exe -s -X POST "https://velodesk-278491073220.us-east1.run.app/api/inbound/tickets" `
  -H "Content-Type: application/json" `
  -H "X-Inbound-Chat-Secret: <chave_35_caracteres>" `
  -d "{\"externalId\":\"chat-sess-abc123-msg2\",\"chamadoProtocolo\":\"VD-20260909-0188\",\"text\":\"Continua sem aplicar.\",\"clientName\":\"Mariana Silva\",\"clientCPF\":\"12345678901\"}"
```

---

## Checklist de homologação (Chat)

- [ ] `GET /api/inbound/tickets/health` retorna `enabled: true` e lista `chat` em `origins`
- [ ] `POST /api/inbound/tickets` com `X-Inbound-Chat-Secret` correto e sem `chamadoProtocolo` retorna `201 created`
- [ ] Retry com mesmo `externalId` retorna `200 duplicate` (sem ticket duplicado)
- [ ] Requisição sem header retorna `401`
- [ ] Chave com formato errado retorna `401`
- [ ] Ticket aparece no Desk com canal **Chat**
- [ ] Protocolo `VD-YYYYMMDD-####` retornado na resposta
- [ ] Resposta com `chamadoProtocolo` válido (`externalId` novo) retorna `200 replied` e a mensagem aparece no ticket
- [ ] Resposta com `chamadoProtocolo` de ticket fechado/cancelado/resolvido há +48h retorna `201 created` (ticket novo derivado)
- [ ] Resposta com `chamadoProtocolo` inexistente retorna `400`

---

## Referências internas VeloHub

| Recurso | Caminho |
|---------|---------|
| Rotas inbound | `backend/src/routes/inbound.routes.ts` |
| Serviço criação/resposta | `backend/src/services/inbound-ticket/inboundTicket.service.ts` |
| Serviço leitura (App) | `backend/src/services/inbound-ticket/inboundTicketRead.service.ts` |
| Auth Chat | `backend/src/middleware/inboundTicketAuth.ts` |
| Contrato de tipos | `backend/src/services/inbound-ticket/types.ts` |
