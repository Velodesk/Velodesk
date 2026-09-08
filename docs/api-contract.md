# Contrato API Velodesk v1.2.0

Mapeamento provisório: protótipo vanilla (`../dev - desk/`) → API REST → MongoDB.

> Schemas finais dependem do arquivo oficial de coleções VeloHub. Campos abaixo são provisórios.

## Endpoints Fase 1

| Método | Rota | Coleção / origem |
|--------|------|------------------|
| POST | `/api/login` | users |
| GET | `/api/health` | — |
| GET | `/api/dashboard` | agregação tickets |
| GET | `/api/stats` | alias dashboard |
| GET | `/api/boxes` | boxes (Kanban) |
| GET/POST/PUT/DELETE | `/api/tickets` | tickets (`chamados_n1`) |
| GET | `/api/inbound/tickets/health` | inbound tickets (health) |
| POST | `/api/inbound/tickets` | inbound tickets — criação App / Telefone / Agente IA |
| GET | `/api/tickets/by-protocol/:protocolo` | tickets |
| POST | `/api/tickets/:id/messages` | tickets.messages |
| GET | `/api/forms` | forms |
| GET | `/api/users` | users |
| POST | `/api/uploads/signed-url` | uploads GCS |
| GET/POST | `/api/whatsapp/*` | módulo WhatsApp |
| GET/POST | `/api/ticket-ai/*` | IA sugestão de resposta (status, suggest, suggest-stream) — sem coleção própria, lê `chamados_n1` |

### POST /api/ticket-ai/suggest, POST /api/ticket-ai/suggest-stream

Contexto para geração de sugestão IA é sempre montado no backend a partir do
histórico completo do ticket (`chamados_n1.registro`), nunca apenas do payload
enviado pelo cliente:

- Mensagens públicas (e-mail, WhatsApp, portal) e anotações internas do agente
  são **sempre mescladas** — não há mais escolha exclusiva entre "contexto
  interno" ou "contexto público".
- O campo de request `contextSource` (`"internal" | "public"`) está
  **descontinuado e ignorado pelo backend** a partir desta versão. Clientes
  antigos que ainda o enviam continuam funcionando (campo é aceito e
  descartado), mas não deve ser usado por novos clientes.
- `messages` e `internalNote` no corpo da requisição são tratados como
  fallback apenas para tickets ainda não persistidos (sem `ticketId` válido em
  `chamados_n1`); para tickets existentes, o backend sempre reconstrói o
  contexto a partir do banco (`resolveMessagesForSuggest` /
  `resolveInternalNoteForSuggest` em `openaiTicketSuggest.service.ts`).
- A requisição só falha por falta de contexto se não houver **nenhuma**
  mensagem pública nem anotação interna disponível.

## localStorage → MongoDB

### kanbanColumns → boxes + tickets

```json
{
  "id": "string",
  "name": "string",
  "order": "number",
  "tickets": ["ObjectId ref ticket"]
}
```

### Ticket (protótipo)

| Campo protótipo | Campo API | Tipo |
|-----------------|-----------|------|
| id | _id | ObjectId |
| title | title | string |
| description | description | string |
| status | status | string |
| priority | priority | string |
| channel | channel | string |
| source | source | string |
| messages | messages | array |
| internalNotes | internalNotes | array |
| formData | formData | object |
| lateralForm | lateralForm | object |
| clientName | clientName | string |
| clientCPF | clientCPF | string |
| responsibleAgent | responsibleAgent | string |
| createdAt | createdAt | date |
| updatedAt | updatedAt | date |

### lateralForm (ticket-lateral-form.js)

`cpf`, `canal`, `classificacaoTipo`, `produto`, `motivo`, `detalhe`, `responsavel`, `atribuido` → subdocumento `lateralForm`.

### velodeskClientDB → clients

Chave CPF → documento com `produtos`, `termometro`, `atendimentos`.

### forms → forms

Builder de campos: `fields[]` com tipos text, select, tree, checkbox.

### Perfis V3 (UI only)

`velodeskProfile`: agent | supervisor | monitor | training | management — não persiste no ticket; controla nav/RBAC futuro.

## Seeds

Apenas `NODE_ENV=development`. Produção sem dados hardcoded.
