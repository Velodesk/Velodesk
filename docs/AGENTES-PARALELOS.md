# Agentes Paralelos — VeloDesk

VERSION: v1.1.0 | DATE: 2026-08-07

## Visão geral

Programa de quatro agentes IA no backend do Desk:

| # | Nome oficial | Competência |
|---|--------------|-------------|
| 1 | **Agente de Resposta** | Compõe resposta + tabulação (vector stores pública + POPs) |
| 2 | **Agente Auditor** | Valida conformidade, decide revisão/envio/handoff |
| 3 | **Agente Gestor de Tickets** | SLA, filas, picos inbound, handoff crítico, alertas |
| 4 | **Agente de Casos especiais** | Triagem RA/Procon/Bacen/consumidor.gov na entrada do ticket |

Nomenclatura centralizada em `backend/src/services/agents/agentRegistry.ts`.

## Ativação

```env
AGENTS_ENABLED=true
# Agente autônomo: ligado/desligado em Configurações > Agentes de IA (não há variável de ambiente)
AGENT_CASOS_ESPECIAIS_ENABLED=false
OPENAI_POP_VECTOR_STORE_ID=vs_...
OPENAI_PUBLIC_VECTOR_STORE_ID=vs_...
OPENAI_AUDIT_VECTOR_STORE_ID=vs_...   # upload docs/vector-stores/INSTRUCOES-VERIFICACAO.md
```

## Thresholds

| Modo | Threshold | Ação se abaixo |
|------|-----------|----------------|
| Envio automático (inbound) | 85% | Revisão Agente de Resposta (máx. 2x) |
| Sugestão Desk | 70% | Revisão automática Agente de Resposta |

Palavras críticas bloqueiam envio autônomo e acionam Agente Gestor de Tickets (handoff).

## Endpoints (`/api/agents/*`)

- `GET /status` — configuração
- `POST /pipeline` — pipeline completo
- `POST /revisar-sugestao` — revisão com input do operador
- `POST /auditoria` — auditoria compliance (supervisor)
- `GET/POST/PUT/DELETE /autonomy-rules` — regras de autonomia
- `GET /feedback` — histórico de aprendizado
- `GET /gestao/alerts` — alertas operacionais
- `POST /gestao/handoff` — handoff crítico manual
- `POST /gestao/run` — ciclo manual do job

## Retrocompatibilidade

`POST /api/ticket-ai/suggest` delega ao orquestrador quando `AGENTS_ENABLED=true`.
Resposta estendida inclui `auditScore`, `auditAprovado`, `confidence`.

Campos legados (`requerRevisaoAgente1`, `notificarAgente3`) permanecem nos JSONs de auditoria.

## Coleções Mongo (b2c_chamados)

- `agent_feedback` — aprendizado
- `agent_autonomy_rules` — regras de envio autônomo
- `agent_gestao_alerts` — alertas do Agente Gestor de Tickets

## Vector store de auditoria

Criar store na OpenAI e fazer upload de `docs/vector-stores/INSTRUCOES-VERIFICACAO.md`.
Definir `OPENAI_AUDIT_VECTOR_STORE_ID` no ambiente.
