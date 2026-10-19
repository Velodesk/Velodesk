# API da fila de aprovação humana (agente autônomo)

Base: `/api/ai-approvals` · Auth: Bearer · Acesso: módulo `permissoes.acesso.ia` (menu "IA" — Inteligência Artificial)

Fluxo: o ticket que chega por um canal liberado (app, chat ou agente-ia) com a tabulação de origem dentro do escopo
nasce já na fila do agente (`processando`, responsável "Agente Autônomo", fora das filas convencionais) → o agente
de resposta gera resposta + restante da tabulação → o auditor dá a nota; abaixo da nota mínima a IA refaz na hora, e
acima dela a resposta fica `aguardando_aprovacao` (nada é enviado ao cliente) → o humano aprova ou reprova.
Tudo configurado em Configurações > Agentes de IA (liga/desliga, switches de canal, escopo, nota mínima, destino),
sem variável de ambiente. Tickets do agente não passam pela varredura de palavras críticas.

## Estados (`status`)
`processando` (agente preparando; ainda sem resposta) · `aguardando_aprovacao` · `em_revisao` (decisão em andamento — transitório) · `aprovada` · `enviada_direto` (congelado nesta fase) · `encerrada_humano` · `cancelada` (ticket encerrado enquanto aguardava)

## GET `/` — lista
Query: `status` (padrão `aguardando_aprovacao`), `page`, `limit` (máx. 100). Ordem: mais antigos primeiro.
```json
{ "success": true, "total": 3, "page": 1, "limit": 30, "items": [{
  "id": "…", "protocolo": "…", "titulo": "…", "status": "aguardando_aprovacao",
  "tentativa": 1, "bloqueadoIA": false, "ruleId": "…", "aguardandoMinutos": 12,
  "geradaEm": "ISO",
  "pendente": { "tentativa": 1, "resposta": "texto do núcleo (sem saudação)",
    "tabulacao": { "tipo": "", "produto": "", "motivo": "", "detalhe": "" },
    "auditScore": 97, "confidence": "alta", "model": "…", "geradaEm": "ISO" },
  "historico": [ /* tentativas já decididas: decisao, feedback, decididoPor, decididoEm */ ]
}] }
```

## GET `/:id` — detalhe
Igual a um item + `messages` (`[{ role: "cliente"|"agente", text }]`) e `tabulacaoAtual` (tabulação já gravada no chamado, ou `null`).

## POST `/:id/aprovar`
Envia ao cliente (com saudação + núcleo), grava a tabulação do agente no chamado, marca como acerto da IA.
`200 { success, id, status: "aprovada" }` · `409` se não estiver aguardando · `422` se a tabulação deixou de ser válida na árvore.

## POST `/:id/reprovar`
Body: `{ "feedback"?: string }` (opcional).
- 1ª reprovação: o agente reescreve (usando o feedback, se houver) e a nova resposta sempre volta à fila →
  `200 { status: "aguardando_aprovacao", tentativa: 2 }`.
- 2ª reprovação → `200 { status: "encerrada_humano", motivo: "segunda_reprovacao" }`: o chamado vai para a fila
  convencional e a IA não tenta mais.
- Falha técnica da IA/API (após repetir) → `503`; o chamado continua na fila e a reprovação pode ser refeita.
`motivo` (encerrada_humano) ∈ `segunda_reprovacao | sem_contexto`.

A reprovação demora (chamadas à OpenAI): usar timeout generoso (≥ 60 s) e travar o botão enquanto processa.
