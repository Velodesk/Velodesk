# API da fila de aprovação humana (agente autônomo)

Base: `/api/ai-approvals` · Auth: Bearer · Acesso: módulo `permissoes.acesso.aprovacao-ia`
(o id `aprovacao-ia` precisa ser registrado em `NAV_ITEMS` do front para aparecer em Módulos de Acesso).

Fluxo: o agente de resposta gera → o auditor aprova com a régua estrita → a resposta fica
`aguardando_aprovacao` (nada é enviado ao cliente) → o humano aprova ou reprova.
Só ocorre quando o agente está ligado em Configurações > Agentes de IA (sem variável de ambiente),
o escopo (produto/motivo/detalhe) está liberado e o destino configurado é "Fila de aprovação humana".

## Estados (`status`)
`aguardando_aprovacao` · `em_revisao` (processando — transitório) · `aprovada` · `enviada_direto` · `encerrada_humano`

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
- 1ª reprovação: o agente reescreve (usando o feedback, se houver), o auditor reavalia:
  - passa na régua → `200 { status: "aguardando_aprovacao", tentativa: 2 }`
  - não passa → `200 { status: "encerrada_humano", motivo }`
- 2ª reprovação → `200 { status: "encerrada_humano", motivo: "segunda_reprovacao" }`.
Em `encerrada_humano` o chamado segue o atendimento humano normal e a IA nunca mais tenta responder automaticamente.
`motivo` ∈ `segunda_reprovacao | sem_contexto | falha_revisao | segunda_tentativa_reprovada_pela_ia`.

A reprovação demora (chamadas à OpenAI): usar timeout generoso (≥ 60 s) e travar o botão enquanto processa.
