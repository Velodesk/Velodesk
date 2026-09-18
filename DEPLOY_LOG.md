# DEPLOY LOG — Velodesk React

<!-- VERSION: v1.93.0 | DATE: 2026-09-17 | AUTHOR: VeloHub Development Team -->

---

## Deploys e pushes realizados

### GitHub Push — webhook outbound Velodesk → App Velotax + histórico de mensagens (origem app)

- **Data/Hora**: 2026-09-17
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Backend**: chamado.mapper (pushRegistroEntry — ponto único de mutação de `registro`), ChamadoN1 (hook `post('save')`), velodeskWebhook.service (novo), inboundTicketRead.service, inbound.routes
- **O que mudou**:
  - Webhook outbound (`POST` com `X-Velodesk-Webhook-Secret`) disparado para qualquer origem/canal de chamado — mensagem pública de agente/sistema ou mudança de status (inclui reabertura).
  - `GET /api/inbound/tickets/client/:chamadoProtocolo/messages` (origem app) — histórico completo de mensagens públicas.
- **Requer no Cloud Run** (novos, ver tabela em `README.md`): `VELODESK_WEBHOOK_URL` (dev → `https://velotax-server.ngrok.io/api/tickets/webhook`) e `VELODESK_WEBHOOK_SECRET`.

### GitHub Push — planilha QA Workflow/E-mail/Painel 360 (25 apontamentos)

- **Data/Hora**: 2026-08-21
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.92.0
  - **Frontend**: DeskV2Root v3.44.0, ticketsCache v1.21.0, desk/utils v3.22.0, tabulationConfig v1.11.0, DeskComposePanel v1.17.0, DeskConversation v1.10.0, DeskWhatsAppChat v1.14.0, DeskRightPanel v1.15.0, attachmentPreview v1.4.0, ticketAdapter v1.8.0, clientDb v1.2.0, especiaisChannelDetection v1.2.0, workflowApprovalData v1.8.0, workflowDecisionHandlers v2.5.1, WorkflowApprovalShell v1.11.0, Ra/Pc/Bc/CgClassificacaoFields v1.1.0
  - **Backend**: chamado.mapper v2.16.1, tabulation.service v1.7.0, attachmentFilter.util v1.3.0, emailTrigger.service v1.1.0, geminiRefinar.service (retry só 404)
- **Arquivos principais**:
  - Onda 0: Casos Especiais (RA/Bacen/Procon/C.Gov) nunca no módulo Tickets — exclusão absoluta no front e em toda query de boxes
  - Onda 1A: hidratação de contato só em `b2c_cadastros.clientes` + painel superior (sem PUT/claim no ticket)
  - Onda 1B: caixas Em andamento/Pendente filtram por responsável (WF não tira o ticket do dono)
  - Onda 1C: busca por CPF/protocolo sempre une API + cache (fim do early-return "achou 1 de 3")
  - Onda 1D: botão Iniciar Workflow sem gate de compose público; `isTicketWorkflowActive` só com workflow real; busca no console WK mantém o ticket aberto
  - Onda 1E: start do WF em um único persist (POST /workflow/start), responsável preservado, cache marca active na hora; merge do poll não apaga `workflow.active`
  - Onda 2: tabulação CE com Produto da árvore + Motivo do órgão (sem cascata POP); save exige os dois
  - Onda 3: "Chamado aberto"/e-mail padrão como bolha de sistema; substituição de `{client_name}` no template
  - Onda 4: dedupe de anexos inclui outbound (reply não ecoa anexo do agente), MIME forçado no preview, "Verificando…" só em inbound
  - Onda 5: SpellCheck removido do compose (hook, UI e engines); permanece apenas o Revisor de Texto
- **Descrição**: Correção dos 25 apontamentos da planilha de testes Workflow/E-mail/Painel 360 (21-08-2026), agrupados por causa raiz.
- **Status**: Push dev

---

### GitHub Push — correções QA Desk (Enviar como, CPF, POPs, rascunho, workflow)

- **Data/Hora**: 2026-08-21
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.91.0
  - **Frontend**: DeskV2Root v3.40.0, sendCommitGates v1.0.0, CreateTicketPanel v2.0.3, DeskComposePanel v1.16.0, DeskRightPanel v1.14.0, ticketsCache v1.19.0, TicketTabsBar v2.2.0, workflowApprovalData v1.7.0, workflowTeamQueues v1.6.0, permissionService v1.9.2, WorkflowApprovalShell/Queue/Search/Detail (busca + remoção stepper)
  - **Backend**: popTabulationWhitelist v1.0.0, agentTabulation v1.4.0, openaiAgent v1.1.0, openaiTicketSuggest v1.4.0, atendimentoPersona v1.5.0, ticketSuggestPersona v1.3.0, normalizeFuncao v1.3.1
- **Arquivos principais**:
  - Item 1: gates visíveis no botão Enviar como (tabulação + revisor de texto; exceção Cancelado)
  - Item 2: CPF 404 ao criar ticket → RegisterClientModal
  - Item 3: tabulação IA restrita aos POPs (vector store + whitelist + personas)
  - Item 4: persistência de rascunho entre abas; descarte total ao fechar aba draft
  - Item 5: fila console workflow por função atribuída (normalizeFuncao + visibilidade)
  - Console aprovações: busca CPF/protocolo, remoção stepper do header
  - Anexos: reconcile/preview, attachmentScanStatus, melhorias inbound/outbound
  - Login Desk, profiles, Sidebar e CSS ecosystem (workflow search)
- **Descrição**: Pacote de correções da auditoria QA (planilha 21-08-2026) e melhorias correlatas no Desk, workflow e anexos.
- **Status**: Push dev

---

### GitHub Push — fix build TypeScript clients.routes (Cloud Build)

- **Data/Hora**: 2026-08-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.90.4
  - **Backend**: clients.routes v1.0.8
- **Arquivos principais**:
  - Tipagem explícita `(item: unknown)` no map de `clienteEmail.lista` — corrige TS7006 no `npm run build` do Docker/Cloud Build
- **Descrição**: Hotfix pós d5c969e; build GCP falhava no stage api-build sem alterar contrato da API.
- **Status**: Push dev + main

---

### GitHub Push — IA em rascunho, Enviar Nota, cadastro cliente e melhorias Desk

- **Data/Hora**: 2026-08-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.90.3
  - **Backend**: persistedTicketId v1.0.0, ticketAi.routes v1.0.5, tickets.routes v1.26.1, agentOrchestrator v1.2.1, openaiTicketSuggest v1.3.2, clients.routes v1.0.7
  - **Frontend**: useTicketAiSuggestions v1.12.5, ticketsCache v1.18.2, DeskV2Root v3.39.x, ClientContactFieldsEditor v1.3.1, RegisterClientModal v1.2.1, ticketThreadSync v1.9.1, deskDebugLog, responsavelDisplay
- **Arquivos principais**:
  - **IA rascunho**: `findById('draft-*')` causava CastError no orquestrador — sugestão IA nunca retornava; util `persistedTicketId`, skip Mongo para rascunhos locais, try/catch no `/ticket-ai/suggest`
  - **Enviar Nota**: append só no cache em rascunho, sem save completo nem refresh global; hook IA relê ticket via `ticketCacheEpoch` e coalesce de POST duplicado
  - **Cadastro manual**: e-mail obrigatório quando CPF não encontrado (frontend + POST `/clients`)
  - **Desk/workflow**: stepper, polling leve, exibição responsável, debug operacional, melhorias colaboradores e filas
- **Descrição**: Corrige ~2 min de espera sem resposta do Agente 1 em tickets rascunho, regressão do botão Enviar Nota e validação de e-mail no cadastro manual, sem alterar contratos de API ou schemas MongoDB existentes.
- **Status**: Push dev + main

---

### GitHub Push — fix CSS hub de cards do módulo E-mail (config)

- **Data/Hora**: 2026-08-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.90.2
  - **Frontend**: styles.css v2.4.9 (config-email-hub, outbound editor, assinatura)
- **Arquivos principais**:
  - Grid 3 colunas dos cards do hub E-mail; layout editor/preview outbound e assinatura
- **Descrição**: CSS do hub de e-mail estava no stash local e não tinha ido no push ac8efca — cards quebravam em prod.
- **Status**: Push dev + main

---

### GitHub Push — fix build TypeScript (emailTrigger + chamado.mapper)

- **Data/Hora**: 2026-08-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.90.1
  - **Backend**: chamado.mapper v2.15.1, emailTrigger.service v1.0.1
- **Arquivos principais**:
  - `isEspeciaisChamado` exportado em chamado.mapper (RA, Procon, Consumidor.gov, BACEN)
  - Narrow de `chamado.workflow` no DTO de listagem
  - Fallback `saudacao`/`corpo` vazios no disparo de e-mail template
- **Descrição**: Corrige falha `tsc` no Cloud Build do commit ac8efca sem alterar contratos de API.
- **Status**: Push dev + main

---

### GitHub Push — layout e-mail outbound, workflow reprovação e melhorias Desk/360

- **Data/Hora**: 2026-08-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.90.0
  - **Backend**: emailSkeleton.service v1.3.0, emailBrand.util v1.2.0, emailOutbound.constants, emailAssinatura/Conteudo/Trigger services, emailOutbound.routes, EmailAssinatura/Conteudo/DisparoLog models, emailSlaTrigger.job, workflowDto.util v1.4.0, workflowTicket.service v1.9.0, workspace360.service v1.5.1, workflowStatus.util, whatsappInbound.service, email-inbound/outbound/notification/transport/replyContent
  - **Frontend**: EmailOutboundEditor, EmailAssinaturaSection, EmailRemetentesSection, emailPreviewHtml v1.2.1, TicketWorkflowStepper v1.7.1, desk/utils v3.19.1, workflowEngine v1.11.2, DeskV2Root, workflowDecisionHandlers, deskData v2.6.1, velodesk-crm.css v1.18.1, DeskTicketErrorBoundary
  - **Assets**: `backend/assets/email/velotax_ajustada_branco.png`, `public/velotax_ajustada_branco.png`
- **Arquivos principais**:
  - E-mail outbound — skeleton HTML padronizado (header Velotax, despedida, assinatura configurável), brand colors/logo inline, preview na config, rotas e modelos de conteúdo/disparo
  - Workflow — estado `denied` no stepper após reprovação; reprovação sem auto-resposta; approve Produtos envia mensagem ao cliente; tickets reprovados em action-now no Painel 360
  - Desk/360 — melhorias thread e-mail, WhatsApp inbound, queue counts, workspace360 API, VeloNews, sugestões IA e error boundary no ticket
- **Descrição**: Entrega layout profissional de e-mails enviados, fluxo de reprovação workflow visível ao agente e pacote de melhorias operacionais no Desk sem alterar contratos de API ou schemas MongoDB existentes.
- **Status**: Push dev + main

---

### GitHub Push — performance Desk, anexos (reconcile/preview) e propagação workflow

- **Data/Hora**: 2026-08-19
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.89.0
  - **Backend**: tickets.routes v1.24.0, attachmentScanReconcile v1.0.0, chamado.mapper v2.12.2, ticketEventsBroadcast.service v1.1.0, permission.service v1.10.0, gestaoInsightsPainel.service v1.1.0
  - **Frontend**: ticketsCache v1.16.0, DeskV2Root v3.37.0, DeskAttachmentPreviewModal v1.1.0, attachmentPreview v1.2.1, desk/utils v3.19.0, dateTimeBr v1.0.1, WorkflowApprovalShell v1.9.0, workflowDecisionHandlers v2.4.0, GestaoPanel v3.9.0, useWorkspace360 v1.3.0, TicketsContext v1.8.3, velodesk-crm.css
- **Arquivos principais**:
  - Anexos: reconcile `pending`→`clean` ao carregar ticket (GCS já promoveu); alinhamento scanStatus por storageKey; PDF no iframe (sem download fantasma); texto Office simplificado
  - Race conditions: proteção in-flight + abas abertas no merge `/boxes`; serialização de `loadTicketDetailFromApi` por ticket; merge leve preserva thread; fallback bolha vazia em parse de e-mail
  - Workflow: `publishTicketEvent('workflow')` nas mutações; polling 25s + Realtime no painel de aprovação; `createWorkflowInfoRequest` no pedido de informação
  - Performance 360: render progressivo GestaoPanel; hook workspace360 aguarda permissões; cache TTL insights (45s) e permissões por userId (30s); coalesce refreshTickets
  - Fix crash `dateTimeBr` (`year: false`); assumir ticket sem reload bloqueante
- **Descrição**: Corrige “Verificando…” preso, preview PDF com download indesejado, lentidão heterogênea, bolhas vazias e fila workflow desatualizada sem alterar contratos de API ou schemas MongoDB.
- **Status**: Push dev

---

### GitHub Push — source file POPs no container, hidratação cadastro e Consulta Operacional prod

- **Data/Hora**: 2026-08-19
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.88.0
  - **Backend**: popCatalog.service v1.4.2, index (logPopCatalogStartup), Dockerfile v1.1.1, Dockerfile raiz v2.0.1, `.env.example` (POPS_SOURCE_DIR)
  - **Frontend**: clienteAdapter v1.4.2, DeskV2Root v3.36.2
  - **Assets**: `backend/source file/` completa — 16 `.docx` (POPs) + 17 `.pdf` (POP Completo) versionados e copiados no Docker
- **Arquivos principais**:
  - `.gitignore` — `/POPs/` só na raiz; `backend/source file/` versionada integralmente
  - Dockerfiles copiam pasta `source file/` inteira para Cloud Run — corrige prod vazio em `/api/processos/produtos`
  - Log de boot `[processos] source file POPs: produtos=N docx=N pdf=N` para diagnóstico
  - Hidratação cadastro silenciosa: só se faltar email ou telefone; Mongo local primeiro (`hydrateFromApi=0`), API externa só se ainda incompleto; sem loading bloqueante no header
- **Descrição**: Restaura Consulta Operacional em produção (POPs no container) e corrige regressão de hidratação automática de cadastro no Desk.
- **Status**: Push dev + main

---

### GitHub Push — Consulta Operacional POPs, datas BRT, anexos workflow e Hugme/RA

- **Data/Hora**: 2026-08-19
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.87.0
  - **Backend**: popCatalog.service v1.4.0, processos.routes v1.3.0, env (popsCompletoSourceDir), brDateTime.util v1.0.0, hugmeImport.service v1.2.0, hugmeSpreadsheet.service, reclameAquiTicketCreate.service, permission.service, tabulationOpcoes.service, ticketSearch.service v1.4.0, attachmentScanCallback.service v1.1.0, reclamacoes.routes, reclameAquiHugme.routes
  - **Frontend**: ProcessosPopover v2.4.0, processosCatalog v1.3.4, DeskRightPanel v1.12.5, dateTimeBr v1.0.0, utils/consultaFormatters, WorkflowApprovalTicketAttachments v1.0.0, WorkflowApprovalEssentials, attachmentPreview, TabulationProdutosList, Hugme/RA (RaHugmeImportModal, RaTicketSide, ReclameAquiRegistroPage), ticketsCache, velodesk-crm.css
  - **Assets**: `backend/source file/POPs` (resumos .docx) + `backend/source file/POP Completo` (PDFs)
- **Arquivos principais**:
  - Consulta Operacional — resumo estruturado lê `POPs/*.docx` (seções h1–h6); botão **Ver Pop Completo** abre PDF de `POP Completo` em nova aba (`GET .../completo/visualizar`)
  - Auto-match tabulação → produto e motivo POP no drawer Processos
  - Utilitários BRT centralizados (`brDateTime.util`, `dateTimeBr.js`) — persistência e exibição de datas em inbound, telephony, workspace360, ticketSearch e CRM
  - Console de aprovação workflow — anexos clicáveis do ticket (`WorkflowApprovalTicketAttachments`, `collectTicketAttachments`)
  - Import Hugme em lote com progresso persistido; melhorias criação de tickets RA e permissões de tabulação
- **Descrição**: Corrige separação POP resumo vs POP completo no Desk, padroniza fuso BRT no stack, expõe anexos no fluxo de aprovação e evolui módulo Reclame Aqui/Hugme.
- **Status**: Push dev + main

---

### GitHub Push — workflowStatus finished, busca dual órgãos e histórico reclamações

- **Data/Hora**: 2026-08-18
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.86.0
  - **Backend**: ChamadoN1 v1.12.0 (workflowStatus), workflowTicket.service v1.7.0, workflowDto.util v1.2.0, chamado.mapper v2.12.0, reclamacao.service v1.3.1, ticketSearch.service v1.3.0, workflowConfigSeed v1.6.0, tickets.routes v1.21.0, reclamacoes.routes v1.1.0
  - **Frontend**: utils v3.17.0, DeskTicketList v2.4.0, TicketWorkflowStepper v1.7.0, WorkflowProgressModal v1.1.0, workflowTeamQueues v1.4.1, useEspeciaisDualSearch v1.0.0, CRM RA/Procon/Bacen/CG (busca dual), ClientTicketHistoryModal v2.2.0
- **Arquivos principais**:
  - `workflowStatus` (`active` | `finished`) — conclusão persistente dos passos do workflow; badge verde e checks no agente
  - `finishWorkflowAfterPublicReply` — última devolutiva concluída ao enviar mensagem pública (e-mail/WhatsApp)
  - Busca rápida CRM órgãos em `chamados_n1` + `chamados_reclamacoes` (`GET /api/reclamacoes/:orgao/search`)
  - Histórico por CPF inclui chamados de reclamações
  - Removido seed de workflows `escalonar-*` (gestão manual)
  - Merge híbrido com console de aprovação (filas WF mantêm exclusão de resolvidos)
- **Descrição**: Persistência visual de workflow concluído para agentes, busca dual nos módulos especiais e histórico Client360 unificado, sem re-seed de workflows escalonar.
- **Status**: Push dev + main

---

### GitHub Push — performance Gestão/Painel 360: agregações MongoDB, cache, endpoint unificado e voz-cliente congelado

- **Data/Hora**: 2026-08-18
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.85.0
  - **Backend**: env v1.39.0 (telephonyIaBatchEnabled, ticketEventsRealtime), ChamadoN1 v1.11.0 (índices), gestaoInsights.service (agregações), workspace360.service (agregação slim registro + cache TTL), gestaoInsightsPainel.service v1.0.0, boxesCache.service v1.0.0, ticketEventsBroadcast.service v1.0.0, chamado.mapper (view=light), boxes.routes v1.9.0, gestaoInsights.routes (painel + voz-cliente 503), tickets.routes (light + publishTicketEvent)
  - **Frontend**: useGestaoInsightsPainel v1.0.0, ticketEventsRealtime v1.0.0, GestaoPanel, GestaoCustomerVoiceCard (congelado), cards gestaoInsights (painelData), DeskV2Root (poll light + realtime), Workspace360OperationalLeaderboard (leaderboard inline)
- **Arquivos principais**:
  - `backend/src/services/workspace360.service.ts` — agregação MongoDB com `$project` enxuto de `registro`; KPIs/leaderboard em memória; cache TTL 30s
  - `backend/src/services/gestaoInsights.service.ts` — volume/resumo/motivos via `$aggregate` (paridade validada em `test-gestao-insights-parity.ts`)
  - `backend/src/services/gestaoInsightsPainel.service.ts` + `GET /api/gestao-insights/painel` — payload unificado dos cards analíticos
  - `backend/src/config/env.ts` — `TELEPHONY_IA_BATCH_ENABLED` default false; config Supabase Realtime para eventos de ticket
  - `GET /api/tickets/:id?view=light` + `ticketEventsBroadcast.service.ts` — polling leve e push Supabase como fallback
  - `backend/src/services/boxesCache.service.ts` — cache TTL 15s em `Box.find`
  - `GET /api/gestao-insights/voz-cliente` — congelado (503); card frontend com badge "Em desenvolvimento"
- **Descrição**: Reduz latência crítica do dashboard de Gestão: elimina varreduras completas de `registro`, consolida múltiplos GETs de insights em um endpoint, pausa batch redundante de IA de telefonia, adiciona cache curto e polling leve no Desk. Card voz-cliente desativado até refatoração de performance.
- **Status**: Push dev + main

---

### GitHub Push — Painel 360 perf, WhatsApp anexo/emoji e mediaUrl Twilio

- **Data/Hora**: 2026-08-17
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.84.0
  - **Backend**: workspace360.service v1.3.0, whatsappActiveOutbound v1.5.0, whatsappOutbound v1.4.0, whatsappOutboundMedia v1.0.0, sentAttachmentStorage v1.3.0, inbound.routes v1.9.0, tickets.routes (WA anexos)
  - **Frontend**: DeskWhatsAppChat v1.13.0, WhatsAppEmojiPicker v1.0.0, useWorkspace360 v1.2.0, ticketsCache, DeskV2Root, velodesk-crm.css v1.17.0
- **Arquivos principais**:
  - `backend/src/services/workspace360.service.ts` — queries filtradas + map list em lote (sem loadAllChamados / chamadoToTicketFull por ticket)
  - `frontend/src/hooks/useWorkspace360.js` — perfil gestão quando `painel_360_equipe`
  - `frontend/src/features/desk/components/DeskWhatsAppChat.jsx` — upload anexo, picker emoji, envio com mídia
  - `backend/src/services/twilio/whatsappOutboundMedia.util.ts` + `GET /api/inbound/whatsapp/outbound-media/:token` — URL pública temporária para Twilio
  - `backend/src/services/twilio/whatsappActiveOutbound.service.ts` — envio session com mediaUrl
- **Descrição**: Acelera carregamento inicial do Painel 360 (gestão e agente). Habilita botão de anexo no chat WhatsApp (upload + envio Twilio) e picker de emojis no compose. Anexos só na janela 24h; PDF em quarentena bloqueado até scan.
- **Status**: Push main

---

### GitHub Push — Desk v2: compose, notas internas, presence e remoção Chat/WhatsApp legado

- **Data/Hora**: 2026-08-17
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.83.0
  - **Frontend**: DeskV2Root v3.33.1, ComposeRichEditor v1.2.0, DeskNoteCardParts v1.1.0, ticketThreadSync v1.8.0, utils v3.16.0, ticketsCache v1.13.0, ticketPresenceRealtime v1.1.0, TicketPresenceContext v1.1.0
  - **Backend**: chamado.mapper, funcaoPermissao v1.x, permission.service, reclamacao.service, workflowNotificacao, casosEspeciaisRouting, env (remoção vars WhatsApp legado)
- **Arquivos principais**:
  - `frontend/src/features/desk/DeskV2Root.jsx` — fim do loop poll→refresh; commit com text/internalText corretos; sync assíncrono pós-save; rascunho persistido
  - `frontend/src/features/desk/components/ComposeRichEditor.jsx` — não sobrescreve DOM enquanto agente digita
  - `frontend/src/services/desk/utils.js` — feed Notas lê `anotacaoInterna` do registro; ignora HTML vazio
  - `frontend/src/services/ticketsCache.js` — detalhe do ticket antes de loadBoxes no commit
  - `frontend/src/services/presence/ticketPresenceRealtime.js` — para retry em 503; backoff nos demais erros
  - Remoção `frontend/src/features/chat/*`, `ChatPage.js`, `backend/src/whatsapp/whatsappModule.js`
  - Permissões/funções, reclamações, workflow notificações, Docker e `.env.example` alinhados
- **Descrição**: Corrige re-render que apagava texto do compose (anotação interna), notas internas que não apareciam/salvavam na aba Notas, e lentidão extrema no commit (loadBoxes bloqueante + loop de GET). Presence para de martelar 503 em loop. Remove módulo Chat e WhatsApp legado do monólito. Push completo para forçar rebuild Cloud Build.
- **Status**: Push main

---

### GitHub Push — inbound tickets (App / Telefone / Agente IA)

- **Data/Hora**: 2026-08-13
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.82.0
  - **Backend**: inbound.routes v1.8.0, inboundTicketAuth v1.0.0, inboundTicket.service v1.0.0, env v1.38.0, assignmentRouter v1.4.1
- **Arquivos principais**:
  - `POST /api/inbound/tickets` + `GET /api/inbound/tickets/health` — abertura canônica por origem (App, Telefone, Agente IA)
  - `backend/src/middleware/inboundTicketAuth.ts` — secret dedicado por header (`[a-z0-9]{35}`)
  - `docs/api-inbound-tickets-app.md`, `docs/api-inbound-tickets-agente-ia.md`
- **Descrição**: Endpoint inbound para criação de chamados por integrações externas, com autenticação por origem e documentação de homologação.
- **Status**: Push dev + main

---

### GCP Config — fio ClamAV: secret de callback, 2Gi no scanner e Eventarc

- **Data/Hora**: 2026-08-13
- **Tipo**: GCP Config (Secret Manager + Cloud Run + Eventarc)
- **Serviço**: velodesk (`us-east1`) + security-git (`us-east1`)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.82.0
- **Cloud Run env / recursos**:
  - Secret `ATTACHMENT_SCAN_CALLBACK_SECRET` no Secret Manager, anexado ao `velodesk` e ao `security-git`
  - `security-git`: 2 GiB, min-instances=1, env de callback/bucket/prefixos
  - Eventarc `velodesk-clamav-quarantine` em `object.v1.finalized` no bucket `velodesk_storage` → `security-git` `/scan`
- **Descrição**: Completa o fio do scanner isolado. O Desk só ganhou o secret de callback (nenhum endpoint/schema alterado). PDF de teste `IPSUN LORUM.pdf` foi varrido (`clean`) e promovido ao prefixo limpo.
- **Status**: Configurado no GCP

---

### GitHub Push — filtro de anexos, preview no Desk e quarentena para ClamAV isolado

- **Data/Hora**: 2026-08-13
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.80.0
  - **Backend**: attachmentGuard v1.0.0, attachmentScanCallback v1.0.0, inboundAttachmentStorage v1.6.0, gcsAttachmentStorage v1.5.0, uploads.routes v1.5.0, gmailAttachment v1.6.0, twilioMediaInbound v1.1.0, whatsappInbound v1.6.0, whatsappThread v1.7.0, email-inbound v1.15.0, chamado.mapper v2.11.0, env v1.37.0, index v1.16.0
  - **Frontend**: DeskConversation v1.8.0, DeskWhatsAppChat v1.11.0, DeskAttachmentPreviewModal v1.0.0, attachmentPreview v1.1.0, utils v3.14.0, velodesk-crm.css v1.16.0, velodesk-dark-theme.css v1.2.1
- **Arquivos principais**:
  - `backend/src/services/attachmentGuard.util.ts` — allowlist, magic bytes, teto por tipo, bloqueio de exe/HTML/SVG/ZIP com senha
  - `backend/src/services/inboundAttachmentStorage.service.ts` + `gcsAttachmentStorage.service.ts` — prefixo `desk_ticket_attachments_quarantine`; cache local só para skipped/clean
  - `backend/src/routes/uploads.routes.ts` — `Content-Disposition: attachment` + nosniff; GET inbound 423/403
  - `backend/src/routes/internalAttachmentScan.routes.ts` — callback `POST /api/internal/attachment-scan-result`
  - `frontend/src/features/desk/components/DeskAttachmentPreviewModal.jsx` — preview de imagem/áudio/vídeo/PDF no Desk
- **Descrição**: Anexos inbound (e-mail e WhatsApp) passam por filtro na recepção. Imagem/áudio/vídeo válidos ficam no prefixo limpo (`skipped`). PDF/Office/ZIP vão à quarentena (`pending`) até o scanner isolado (`admVeloHub/security`, Cloud Run `velodesk-clamav`) promover. O agente visualiza no Desk em vez de baixar automaticamente; infectado não é servido. O binário do ClamAV não entra neste repositório. Eventarc/deploy do scanner ainda pendente de autorização.
- **Status**: Push dev + main

---

### GitHub Push — fix build Cloud Build: service de anexos legado Octadesk fora do versionamento

- **Data/Hora**: 2026-08-12
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.79.0
  - **Backend**: octadeskLegacyAttachmentStorage v1.0.0
- **Arquivos principais**:
  - `backend/src/services/octadeskLegacyAttachmentStorage.service.ts` — arquivo passa a ser versionado
- **Descrição**: O push anterior (`d994c2c`) levou `uploads.routes.ts` v1.4.0, que importa `openOctadeskLegacyAttachment`, mas o service permaneceu como untracked no repositório. O `tsc` no Cloud Build falhou com `TS2307: Cannot find module '../services/octadeskLegacyAttachmentStorage.service'`. Nenhuma alteração de código: apenas inclusão do arquivo ausente no versionamento. `npx tsc --noEmit` no backend passa sem erros.
- **Status**: Push dev + main

---

### GitHub Push — Consolidado Testes CRM (Meus Tickets, anexos, 360, pendente, especiais)

- **Data/Hora**: 2026-08-12
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.78.0
  - **Backend**: email-inbound v1.14.0, gmailAttachment v1.5.0, gmailInbound v1.5.0, emailHtml v1.1.0, emailNotification v1.8.0, composeInlineImages v1.0.0, openaiTicketSuggest v1.3.1, ticketIaAdapter v1.1.1, resolvePendenteTickets v1.0.0, telephonyTicketNotify v1.0.0, telephonyInbound v2.2.0, chamado.mapper v2.10.1, workspace360 v1.2.0, env v1.36.1
  - **Frontend**: DeskV2Root v3.32.1, DeskConversation v1.6.1, especiaisChannelDetection v1.1.0, NotificationPanel v1.0.0, AgentPanel v3.2.0, GestaoPanel v3.6.0, deskData v2.5.0, app.css v1.1.0, App v2.7.1, NotificationContext v1.3.0
- **Arquivos principais**:
  - `frontend/src/features/desk/DeskV2Root.jsx` — restaura tabela Meus Tickets/Resolvidos ao fechar última aba
  - `frontend/src/services/especiais/*` + `backend/.../chamado.mapper.ts` — exclui RA/Procon/CG do Desk agente
  - `backend/src/services/email-inbound.service.ts`, `gmailAttachment.service.ts`, `composeInlineImages.util.ts`, `emailNotification.service.ts` — imagens CID inbound/outbound + anexos só com filename
  - `backend/src/services/openaiTicketSuggest.service.ts`, `ticketIaAdapter.service.ts` — últimas 50 msgs + notas internas do Mongo
  - `backend/src/jobs/resolvePendenteTickets.job.ts` — pendente ≥48h → resolvido (hora cheia)
  - `frontend/src/features/workspace/*` + `workspace360.service.ts` — alert, channelVision, KPIs supervisor, pendente nas seções
  - `backend/src/services/telephonyTicketNotify.service.ts` + `NotificationPanel.jsx` — CTA sininho para ticket de telefonia
- **Descrição**: Entrega do consolidado de testes CRM (sem lote de permissões Responsável/overrides). Corrige navegação Meus Tickets, exclusão de especiais, anexos/imagens de e-mail, contexto IA, automação pendente→resolvido, Painel 360 e notificação de ligação no sininho.
- **Status**: Push dev + main

---

### GitHub Push — fix persistência thread WhatsApp + balão de presença e polling rápido

- **Data/Hora**: 2026-08-11
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.77.0
  - **Backend**: whatsappThread v1.4.0
  - **Frontend**: DeskV2Root v3.30.0, DeskConversation v1.6.0, utils v3.12.0, velodesk-crm.css v1.13.0, velodesk-dark-theme.css v1.2.0
- **Arquivos principais**:
  - `backend/src/services/twilio/whatsappThread.service.ts` — `chamado.markModified('registro.N.metadados')` em `appendWhatsAppMensagemToChamado` e `updateWhatsAppMensagemDeliveryBySid`
  - `frontend/src/services/desk/utils.js` — `collapseWhatsAppThreadToBalloon` + `channel` preservado na thread
  - `frontend/src/features/desk/components/DeskConversation.jsx` — balão de presença da conversa WhatsApp (abre o chat ao clicar)
  - `frontend/src/features/desk/DeskV2Root.jsx` — timeline usa `displayMsgs`; poll 3s com chat WA aberto, 5s com sessão 24h ativa
  - `frontend/velodesk-crm.css` / `velodesk-dark-theme.css` — estilos `.wa-presence-balloon` (claro + escuro)
- **Descrição**: (1) Corrige mensagens WhatsApp (inbound do cliente, 2ª+ do agente e status de entrega) descartadas no `save()` — `registro.metadados` é `Schema.Types.Mixed` e o Mongoose não rastreia mutação interna sem `markModified`. (2) Timeline do ticket deixa de listar mensagens WhatsApp individuais e exibe balão único de presença da conversa. (3) Mensagens chegam em tempo quase real: polling 3s com a conversa em tela e 5s com sessão do cliente aberta.
- **Status**: Push main

---

### GitHub Push — fix auto-reply Sandbox no inbound WhatsApp e polling thread WA no Desk

- **Data/Hora**: 2026-08-11
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.76.0
  - **Backend**: whatsappInbound v1.3.1, inbound.routes v1.7.3, chamado.mapper, emailNotification
  - **Frontend**: DeskV2Root v3.29.0, ticketThreadSync v1.3.0, ticketsCache
- **Arquivos principais**:
  - `backend/src/services/twilio/whatsappInbound.service.ts` — remove fallback hardcoded "Twilio Sandbox"; TwiML vazio salvo se `TWILIO_WHATSAPP_AUTO_REPLY` ausente
  - `frontend/src/features/desk/DeskV2Root.jsx` — poll imediato + 5s enquanto aguarda resposta WA; fingerprint thread WhatsApp
  - `frontend/src/services/desk/ticketThreadSync.js` — `hasWhatsAppThreadChanged`
- **Descrição**: Corrige produção respondendo "Hello again from the Twilio Sandbox" a cada inbound. Desk passa a exibir respostas do cliente na janela WhatsApp sem depender só do poll de 15s.
- **Status**: Push dev + main

---

### GCP Config — sender WhatsApp Desk +17406697857 (conta principal)

- **Data/Hora**: 2026-08-11
- **Tipo**: GCP Config (Twilio + Cloud Run env)
- **Serviço**: velodesk (`us-east1`)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.75.0
  - **Scripts**: configure-desk-whatsapp-sender v1.0.0, enable-ms-inbound-on-number v1.0.0
- **Alterações Twilio (API)**:
  - Sender `+17406697857` (XE6db6bd8cf6b31fdec915093bae2d82eb) — webhooks inbound/status → Velodesk
  - Messaging Service `Autenticação – Verificação` — `use_inbound_webhook_on_number=true` (desbloqueia inbound)
- **Cloud Run env**:
  - `TWILIO_WHATSAPP_FROM=whatsapp:+17406697857`
- **Descrição**: Desk passa a usar sender +17406697857 na conta principal; corrige bloqueio de inbound causado pelo Messaging Service de Autenticação.
- **Status**: Twilio configurado; Cloud Run env requer `gcloud run services update`

---

### GitHub Push — fix assinatura Twilio com URL pública 278491073220

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main (exclusivo)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.74.0
  - **Backend**: twilioWebhookAuth v1.2.0, env v1.34.0, inbound.routes v1.7.2
- **Arquivos principais**:
  - `backend/src/middleware/twilioWebhookAuth.ts` — `resolveTwilioWebhookUrlCandidates` (URL pública + host request)
  - `backend/src/config/env.ts` — `TWILIO_WEBHOOK_PUBLIC_BASE_URL` default `https://velodesk-278491073220.us-east1.run.app`
- **Descrição**: Corrige 403 na validação X-Twilio-Signature quando Cloud Run usa host interno diferente da URL configurada na Twilio.
- **Status**: Push main

---

### GitHub Push — fix webhook inbound WhatsApp (assinatura Twilio + match E.164)

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main (exclusivo)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.73.0
  - **Backend**: twilioWebhookAuth v1.1.0, twilioClient v1.3.0, whatsappInbound v1.3.0, whatsappThread v1.3.1, inbound.routes v1.7.1
- **Arquivos principais**:
  - `backend/src/middleware/twilioWebhookAuth.ts` — valida X-Twilio-Signature com token parent + subconta
  - `backend/src/services/twilio/twilioClient.util.ts` — `getTwilioWebhookAuthTokens()`
  - `backend/src/services/twilio/whatsappInbound.service.ts` — `normalizeWaChatId` canônico (E.164)
  - `backend/scripts/update-desk-whatsapp-sender-webhook.ts` — utilitário sender +17406933944 callback POST
- **Descrição**: Corrige recebimento de respostas WhatsApp — status callbacks retornavam 403 (token errado); sender Desk atualizado na Twilio com `callback_method: POST` para inbound.
- **Status**: Push main

---

### GitHub Push — fix E.164 WhatsApp BR (+55) no envio Desk

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.72.0
  - **Backend**: whatsappThread v1.3.0, whatsappOutbound v1.3.0, whatsappActiveOutbound v1.2.0
  - **Frontend**: DeskV2Root v3.28.4, utils v3.11.13
- **Arquivos principais**:
  - `backend/src/services/twilio/whatsappThread.service.ts` — `resolveWhatsAppDestinationPhone` com E.164 BR
  - `backend/src/services/twilio/whatsappOutbound.service.ts` — normalização antes do `messages.create`
  - `backend/src/services/twilio/whatsappActiveOutbound.service.ts` — fallback `clienteTelefone.whatsapp` do cadastro
  - `frontend/src/services/desk/utils.js` — `normalizePhoneE164`, `toWhatsAppChatIdDigits`
  - `frontend/src/features/desk/DeskV2Root.jsx` — `waChatId` canônico com DDI 55
- **Descrição**: Corrige envio WhatsApp para números cadastrados sem DDI (ex. `11966153419` → `+5511966153419`). Elimina falha Twilio 21211 por destino inválido.
- **Status**: Push dev + main

---

### GitHub Push — fix ReferenceError isAtendimentoAgent no Desk

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.71.0
  - **Frontend**: DeskV2Root v3.28.3
- **Arquivos principais**:
  - `frontend/src/features/desk/DeskV2Root.jsx` — restaura `isAtendimentoAgent = hasAtendimentoFuncao(colaboradorAtuacao)` (referência órfã pós-merge c34d021)
- **Descrição**: Corrige crash `ReferenceError: isAtendimentoAgent is not defined` ao abrir ticket no Desk (bloco `canAdvanceWorkflow` sem definição da variável).
- **Status**: Push dev + main

---

### GitHub Push — WhatsApp botão Enviar Mensagem Inicial + feed persistente

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.70.0
  - **Backend**: whatsappActiveOutbound v1.1.0, tickets.routes v1.16.0 (`initialTemplate`)
  - **Frontend**: DeskV2Root v3.28.2, DeskWhatsAppChat v1.6.0, utils v3.11.12, ticketsCache (preserve messages + `_detailLoaded`)
- **Arquivos principais**:
  - `backend/src/routes/tickets.routes.ts` — flag `initialTemplate` envia template sem texto do compose
  - `backend/src/services/twilio/whatsappActiveOutbound.service.ts` — texto padrão da mensagem inicial
  - `frontend/src/features/desk/components/DeskWhatsAppChat.jsx` — card no feed + compose bloqueado
  - `frontend/src/services/desk/utils.js` — `getWhatsAppDeskUiState`
  - `frontend/src/services/ticketsCache.js` — fix mensagem WA sumindo após reload da fila
- **Descrição**: UX dedicada para conversa WhatsApp ativa — botão “Enviar Mensagem Inicial” no feed, compose inativo até resposta do cliente; mensagem permanece no histórico.
- **Status**: Push dev + main

---

### GitHub Push — WhatsApp mensagem ativa (template UTILITY) e sessão 24h Desk

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.69.0
  - **WhatsApp ativo**: whatsappActiveOutbound v1.0.1, whatsappThread v1.2.0, whatsappOutbound v1.2.0, tickets.routes v1.15.0, env v1.33.0
  - **Template Twilio**: `desk_atendimento_ativo` (`HXcbba12297392a996aeaf60af3e05ccc4`, UTILITY)
  - **Frontend**: DeskV2Root v3.28.1, DeskWhatsAppChat v1.5.0, utils v3.11.11, DeskRightPanel v1.12.2
- **Arquivos principais**:
  - `backend/src/services/twilio/whatsappActiveOutbound.service.ts` — template fora da janela 24h; texto livre na sessão
  - `backend/src/routes/tickets.routes.ts` — POST whatsapp/messages usa fluxo ativo/receptivo
  - `backend/src/config/env.ts` — `TWILIO_WHATSAPP_DESK_ACTIVE_CONTENT_SID`
  - `frontend/src/features/desk/components/DeskWhatsAppChat.jsx` — aviso de envio ativo
  - `frontend/src/services/desk/utils.js` — `isWhatsAppCustomerSessionOpen`
  - `backend/scripts/create-desk-whatsapp-template.ts` — criação/submissão template UTILITY
- **Descrição**: Desk envia mensagem ativa via template aprovado quando o cliente não respondeu nas últimas 24h; após resposta, texto livre. Inclui scripts de auditoria Twilio e ajuste do botão Iniciar Workflow (desacoplado de tabulação completa).
- **Cloud Run (manual)**: `TWILIO_WHATSAPP_DESK_ACTIVE_CONTENT_SID=HXcbba12297392a996aeaf60af3e05ccc4` (+ callbacks já configurados).
- **Status**: Push dev + main

---

### GitHub Push — WhatsApp contínuo, confirmação de entrega e fix rascunho Desk

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.68.0
  - **WhatsApp Twilio**: whatsappThread v1.1.0, whatsappOutbound v1.1.0, whatsappStatusCallback v1.0.0, inbound.routes v1.7.0, tickets.routes (POST whatsapp/messages + deliveryStatus)
  - **Backend**: env v1.32.0, chamado.mapper v2.9.5, whatsappInbound v1.2.0
  - **Frontend**: DeskV2Root (WA contínuo, fix refreshQueueCounts), DeskWhatsAppChat v1.4.0, ticketsCache v1.12.0, TicketsContext v1.8.2
- **Arquivos principais**:
  - `backend/src/routes/tickets.routes.ts` — envio WA sem commit de status; thread única com array aninhado
  - `backend/src/routes/inbound.routes.ts` — `POST /whatsapp/message-status` (sent/delivered/read)
  - `backend/src/services/twilio/whatsappThread.service.ts` — `whatsappMensagens[]` + deliveryStatus
  - `backend/src/services/twilio/whatsappStatusCallback.service.ts` — atualiza entrega por MessageSid
  - `frontend/src/features/desk/DeskV2Root.jsx` — handleSendWhatsAppMessage; fix import refreshQueueCountsFromApi; rascunho não dispara sync
  - `frontend/src/services/ticketsCache.js` — preserva drafts em refresh concorrente
  - `frontend/src/context/TicketsContext.js` — mantém abas draft-* durante reload
- **Descrição**: Conversa WhatsApp contínua no Desk (envio leve sem salvar ticket). Confirmação de entrega Twilio via status callback persistida na thread. Corrige race que fechava rascunho ao criar ticket e ReferenceError em syncTicketViews.
- **Cloud Run (manual)**: `TWILIO_*`, `WHATSAPP_INBOUND_ENABLED`, `TWILIO_WHATSAPP_STATUS_CALLBACK_URL`, `ENABLE_WHATSAPP=false`; Twilio Console status callback → Velodesk.
- **Status**: Push dev + main

---

### GitHub Push — Reclamações MongoDB, Agente 4 unificado e mensageria envelope

- **Data/Hora**: 2026-08-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.67.0
  - **Reclamações**: database v1.9.0, env v1.31.0, reclamacao.service v1.0.0, reclamacoes.routes v1.0.0, ReclamacaoBase.schema v1.0.0
  - **Inbound/Agente 4**: email-inbound v1.13.0, casosEspeciaisRouting v1.1.0, casosEspeciaisTrigger v1.1.0, casosEspeciaisPrecheck v1.1.0
  - **Mensageria**: clientMessageEnvelope v1.0.0, clientMessageSendMask v1.0.0, emailBrand.util, emailNotification.service
  - **Frontend**: reclamacoesApi, procon/consumidorGov/reclameAqui stores via API, ticketsCache sync API
- **Arquivos principais**:
  - `backend/src/config/database.ts`, `env.ts` — conexão `chamados_reclamacoes`
  - `backend/src/models/reclamacoes/`, `services/reclamacoes/reclamacao.service.ts` — upsert/list/sync pós Agente 4
  - `backend/src/routes/reclamacoes.routes.ts` — GET/POST/PATCH `/api/reclamacoes/:orgao`
  - `backend/src/services/email-inbound.service.ts` — classificador como hint; hooks Agente 4 sempre no create
  - `backend/src/services/agents/casosEspeciais*.ts` — persistência em `reclamacoes_*`, guards duplicidade
  - `backend/src/services/clientMessageEnvelope.service.ts`, `clientMessageSendMask.util.ts` — envelope/máscara envio cliente
  - `frontend/src/api/client.js`, `services/especiais/*Store.js`, `*TicketService.js` — leitura/refresh via API reclamações
  - `backend/scripts/test-reclamacoes-smoke.ts`, `test-inbound-especiais-channel.ts` — smoke Agente 4 + persistência
- **Descrição**: Persistência de casos formais em MongoDB (`chamados_reclamacoes` / collections por órgão) somente após validação do Agente 4. Inbound sempre cria ticket em `chamados_n1` e passa pelo Agente 4; classificador vira hint de canal. Frontend Especiais consome API em vez de sync local. Inclui evoluções de mensageria (envelope/máscara) e ajustes de personas/prompts.
- **Validação**: `npm run build` backend OK; `npm run test:reclamacoes-smoke` OK; `test-inbound-especiais-channel` OK.
- **Status**: Push dev + main

---

### GitHub Push — Desk: permissões workflow/compose, Meus Tickets e persistência de workflow

- **Data/Hora**: 2026-08-07
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.66.0
  - **Backend**: permission.service v1.7.0, tickets.routes v1.14.0
  - **Frontend**: permissionService v1.7.0, DeskComposePanel v1.12.0, DeskV2Root v3.28.0, utils v3.11.9, ticketsCache v1.11.4, DeskMyTicketsTable v1.5.4, pendingWorkflowStart
- **Arquivos principais**:
  - `backend/src/services/permission.service.ts` — avanço de workflow só para atribuído do passo; commit/messages com anotação interna para observadores
  - `backend/src/routes/tickets.routes.ts` — `assertCanCommitTicket` e `assertCanPostTicketMessage`
  - `frontend/src/services/permissions/permissionService.js` — compose público vs comentário interno; `canAdvanceWorkflowStep`
  - `frontend/src/features/desk/components/DeskComposePanel.jsx` — lock separado para resposta pública e anotação interna
  - `frontend/src/services/desk/utils.js`, `DeskMyTicketsTable.jsx` — Meus Tickets confia filtro backend; seções Cliente respondeu/Pendentes
  - `frontend/src/services/ticketsCache.js`, `pendingWorkflowStart.js`, `DeskV2Root.jsx` — preserva workflow pendente pós-commit/reload
- **Descrição**: Observadores de ticket em workflow podem registrar anotação interna sem alterar status/tabulacao ou enviar resposta pública. Avanço de workflow restringido ao atribuído do passo ativo. Corrige listagem Meus Tickets e mantém stepper/badge de workflow após salvar.
- **Validação**: alterações de permissão alinhadas backend/frontend; filtros Meus Tickets sem double-filter de responsável.
- **Status**: Push main

---

### GitHub Push — Backend: Agente 4 casos especiais, telefonia/Twilio e prompts anti-eco

- **Data/Hora**: 2026-08-07
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.65.0
  - **Agente 4**: agentRegistry v1.0.0, casosEspeciaisTrigger v1.0.0, casosEspeciaisAgent v1.0.0, casosEspeciaisRouting v1.0.0, assignmentRouter v1.4.0, inboundAgentPipeline v1.1.0, agentOrchestrator v1.0.5, env v1.30.0
  - **Prompts**: clientResponseFormatPersona v1.1.1, atendimentoPersona v1.3.1, auditoriaPersona v1.2.2, gestaoChamadosPersona v1.2.1
  - **Telefonia**: telephonyRecado validation/constants, Twilio webhook auth, scripts test twilio/whatsapp
  - **Desk**: filas/contagens, telefonia IA UI, remoção legado escalonar/supervisorEscalate
- **Arquivos principais**:
  - `backend/src/services/agents/` — Agente 4 (triagem RA/Procon/Bacen/consumidor.gov na entrada), registry numerado 1–4, handoff Agente 3 em ameaça vazia, roteamento por função especial
  - `backend/src/services/email-inbound.service.ts`, `app-inbound.service.ts` — hooks pós-create
  - `backend/src/config/env.ts` — `AGENT_CASOS_ESPECIAIS_ENABLED`, alertas por órgão
  - `backend/scripts/test-casos-especiais-precheck.ts` — smoke pre-check
  - `backend/src/services/twilio/`, `inbound.routes.ts` — WhatsApp inbound Twilio
  - `backend/src/services/clientResponseFormatPersona.ts` — regras anti-eco/clichê consolidadas
  - `frontend/src/features/atendimento-ia-telefonico/` — recados operacionais e painéis telefonia
  - Removidos: `migrateEscalonarPermissao`, `workflowTestSeed`, `supervisorEscalateData`, `Workspace360EscalateModal`
- **Descrição**: Agente 4 classifica silenciosamente tickets com sinal regulatório na entrada, roteia casos formais ao time do órgão (função especial + workflow/CTA) e encaminha ameaças vazias ao Agente 3. Inclui nomenclatura numerada dos agentes, melhorias de prompt anti-eco, integração Twilio/WhatsApp e evoluções Desk/telefonia IA.
- **Validação**: `npm run build` backend OK; `npm run test:casos-especiais-precheck` OK.
- **Status**: Push dev + main

---

### GitHub Push — Desk: filas Meus Tickets e Novos por responsável do agente

- **Data/Hora**: 2026-08-04
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.64.0
  - **Desk/filas**: utils v3.10.2, responsavelSegmentation v1.6.1, ticketsCache v1.10.3, DeskMyTicketsTable v1.5.2
- **Arquivos principais**:
  - `frontend/src/services/desk/utils.js` — Meus Tickets só novos/cliente respondeu/em andamento; exclui resolvidos e pendente; fila Novos filtrada por responsável
  - `frontend/src/services/desk/responsavelSegmentation.js` — `ticketBelongsInAgentNovosQueue` (atribuídos ao agente ou sem responsável real); `readTicketResponsavel` com sanitize
  - `frontend/src/services/ticketsCache.js` — coluna Novos filtrada ao hidratar cache da API
  - `frontend/src/features/desk/components/DeskMyTicketsTable.jsx` — remove seção flat sem status; só seções com cabeçalho
- **Descrição**: Corrige tickets resolvidos aparecendo no final de Meus Tickets (devem ir só para Resolvidos). Fila Novos para agentes exibe apenas tickets novos atribuídos a si ou sem atribuição; gestão/ver_todos mantém visão completa.
- **Validação**: Filtros aplicados em listagem, contagem de fila e cache pós-API.
- **Status**: Push dev + main

---

### GitHub Push — Backend: fix build GCP workflow (contexto tabulação IChamadoN1)

- **Data/Hora**: 2026-08-04
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.63.0
  - **Backend**: workflowMatcher.service v1.6.1, workflowTicket.service v1.6.1
- **Arquivos principais**:
  - `backend/src/services/workflowMatcher.service.ts` — `resolveCanalFromChamado`, `buildWorkflowTicketContextFromChamado`, `buildTabulationFieldsFromChamado` (canal via `registro[].metadados`, sem `metadados` na raiz)
  - `backend/src/services/workflowTicket.service.ts` — `startWorkflowForChamado` e ativação usam helpers; remove acesso inválido a `chamado.metadados`
- **Descrição**: Corrige falha de build TypeScript no Cloud Build (`Property 'metadados' does not exist on type 'IChamadoN1'`). Contexto de tabulação/canal para match de workflow passa a ser montado a partir da estrutura real do chamado N1.
- **Validação**: `npm run build` backend OK (`tsc` sem erros).
- **Status**: Push dev + main

---

### GitHub Push — Desk: busca avançada de tickets e mesclagem (fusão)

- **Data/Hora**: 2026-08-04
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.62.0
  - **Backend**: index v1.13.0, ChamadoN1 v1.9.0, chamado.mapper, ticketSearch.routes v1.1.0, ticketSearch.service, ticketFusao.routes v1.0.1, ticketFusao.service v1.1.1, ticketFusao.helpers
  - **Frontend**: TicketSearchView v1.0.0, TicketSearchPage, client.js v1.22.0, ClientTicketHistoryModal (mesclagem multi-seleção), FusaoFundidoBadge v1.1.0, TicketFusaoStatusControls, ticketFusaoService, utils (isFusaoAbsorvido), styles.css, velodesk-crm.css
  - **Desk/workflow**: DeskV2Root, workflowEngine, workflowDefinitions, TicketWorkflowStepper, App.js (rota `/busca-tickets`), profiles.js
- **Arquivos principais**:
  - `backend/src/routes/ticketSearch.routes.ts` — `GET/POST /api/ticket-search` com critérios multi-campo + busca por CPF
  - `backend/src/routes/ticketFusao.routes.ts` — `POST /api/ticket-fusao` mescla ticket ativo + inativos (mesmo CPF)
  - `backend/src/models/ChamadoN1.ts` — campo `fusao` (fundido, hierarquia, parent/child) + índice `cliente.clienteCpf`
  - `frontend/src/features/ticket-search/` — página Busca de Tickets com critérios reutilizando padrão de caixas
  - `frontend/src/features/desk/components/ClientTicketHistoryModal.jsx` — seleção múltipla e confirmação de mesclagem no histórico por CPF
  - `frontend/src/services/desk/utils.js` — tickets absorvidos pela fusão saem das filas abertas
- **Descrição**: Nova página de busca avançada de tickets no Desk e mesclagem de chamados do mesmo cliente (estilo Ouvidoria VeloHub): ticket ativo permanece aberto, absorvidos vão para resolvido com vínculo `fusao` e badge "Mesclado" no histórico.
- **Validação**: Rotas novas registradas em `index.ts`; fluxo UI histórico → seleção → confirmação → POST fusão.
- **Status**: Push dev + main

---

### GitHub Push — Desk: botão Iniciar Workflow por tabulação (sem legado escalonar)

- **Data/Hora**: 2026-08-03
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.61.0
  - **Match workflow**: workflowEngine v1.10.0, workflowMatcher v1.6.0, workflowDefinicao.service v1.8.0, workflowTicket.service v1.6.0
  - **Desk**: DeskV2Root v3.22.0, utils v3.8.0, workflowDefinitions v2.2.0, ticketAdapter v1.7.1
  - **Config**: workflowConfigData v2.9.0, WorkflowCriteriaEditor v2.4.0, WorkflowConfigEditor v2.7.2, WorkflowsConfigSection v3.0.1
  - **Permissões/filas**: permissionService v1.6.1, workflowTeamQueues v1.2.1, constants v2.3.6
- **Arquivos principais**:
  - `frontend/src/services/desk/workflowEngine.js` — match só por gatilho ativo; remove legado escalonar; canal + normalização sem acento
  - `frontend/src/features/desk/DeskV2Root.jsx` — reavalia botão quando lista de workflows do contexto muda
  - `frontend/src/services/desk/utils.js` / `pendingWorkflowStart` — arquitetura: tabulação → botão → requisição → cache → save
  - `backend/src/services/workflowMatcher.service.ts` / `workflowDefinicao.service.ts` / `workflowTicket.service.ts` — start/resolve sem bloqueio por slug legado
  - `frontend/src/api/adapters/ticketAdapter.js` — remove campo escalonar do lateralForm
  - `workflowConfigData.js` — workflow novo nasce ativo; gatilho com canal
- **Descrição**: Corrige botão "Iniciar Workflow" que não aparecia com tabulação válida. Removido bloqueio/legado do campo escalonar; ativação segue apenas a arquitetura atual (match por gatilho → painel de requisição → pending em cache → persistência ao salvar o ticket).
- **Validação**: Match local contra workflows ativos no desk_config; fluxo pending→save intacto.
- **Status**: Push dev + main

---

### GitHub Push — Desk: consultas em rascunho, máscara telefone e poll silencioso

- **Data/Hora**: 2026-08-03
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.60.0
  - **Consultas**: consultas.routes v1.0.1, consultaCpfResolver v1.0.3, consultaFormatters v1.0.1, useCustomerConsulta v1.0.2, DeskConsultasPanel v2.1.1, client.js (consultasApi payload completo)
  - **Contato/telefone**: utils v3.7.4, clienteAdapter v1.1.1, ClientContactFieldsEditor v1.2.0
  - **Desk UX**: TicketsContext v1.7.5, ticketsCache v1.10.2, RegisterClientModal v1.1.1, CreateTicketPanel v2.0.2
- **Arquivos principais**:
  - `backend/src/services/consultaCpfResolver.service.ts` — rascunho usa CPF do painel sem consultar MongoDB; códigos `missing_cpf`, `ticket_not_found`, `invalid_cpf`
  - `backend/src/routes/consultas.routes.ts` — body com `cpf`, `isDraft`, `ticketProduct`; erros distintos na resposta
  - `frontend/src/hooks/useCustomerConsulta.js`, `consultaFormatters.js`, `DeskConsultasPanel.jsx` — envia CPF/isDraft; estados de erro separados
  - `frontend/src/services/desk/utils.js`, `clienteAdapter.js`, `ClientContactFieldsEditor.jsx` — máscara e formatação telefone BR
  - `frontend/src/context/TicketsContext.js`, `ticketsCache.js` — poll silencioso só incrementa refreshKey se fingerprint das filas mudou
  - `RegisterClientModal.jsx`, `CreateTicketPanel.jsx` — corrige re-render/fechamento do modal de cadastro
- **Descrição**: Corrige aba Consultas em tickets rascunho (CPF visível no painel mas 404 "Ticket não encontrado"). Adiciona máscara de telefone BR no editor de contato e formatação consistente na exibição. Otimiza poll silencioso das filas para evitar re-render desnecessário.
- **Validação**: `tsc --noEmit` backend OK; resolver de rascunho validado com CPF local.
- **Status**: Push dev + main

---

### GitHub Push — Desk: API inbound telefonia IA, aba Consultas e melhorias Desk/VeloNews

- **Data/Hora**: 2026-07-31
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.59.0
  - **Telefonia inbound**: inbound.routes v1.4.0, telephony-integration.md v1.1.1, api-inbound-telephony-parceiro.md v1.0.2
  - **Backend**: env v1.27.0, index v1.11.0, consultas.routes v1.0.0, customerDataApi v1.0.0, consultaCpfResolver v1.0.0, consultaProductMap v1.0.0, chamado.mapper, email-inbound, geminiRefinar, workspace360, agentQueueBox
  - **Frontend**: DeskConsultasPanel v2.0.0, ConsultaOverviewSummary, ConsultaProductCard, useCustomerConsulta, CriteriaMultiSelect, ticketThreadSync, VeloNews modals, DeskV2Root, composeRichEditor, ticketsCache, velodesk-crm.css
- **Arquivos principais**:
  - `docs/api-inbound-telephony-parceiro.md` — guia Contact Tel (POST ligações, GET recados, URL prod Cloud Run)
  - `backend/src/routes/inbound.routes.ts` — health telefonia com `apiVersion`
  - `backend/src/routes/consultas.routes.ts` + services Customer Data API
  - `frontend/src/features/desk/components/DeskConsultasPanel.jsx` e hooks/formatters Consultas
  - Preferências (caixas/critérios), VeloNews, thread sync, Gemini refinar, CSS CRM
- **Descrição**: Documentação e endpoints inbound para IA telefônica (Contact Tel → `telephony_calls`); integração aba Consultas com Customer Data API; melhorias de UX Desk, caixas por critérios, VeloNews e compose. **Produção:** configurar `INBOUND_TELEPHONY_WEBHOOK_SECRET` no Cloud Run antes de homologar POST/GET com a parceira.
- **Validação**: `npm run test:telephony-inbound` OK local; health prod `GET /api/inbound/telephony/health` OK; POST/GET aguardam secret no Cloud Run.
- **Status**: Push dev + main

---

### Desenvolvimento local — Aba Consultas (Customer Data API, estratégia B+)

- **Data/Hora**: 2026-07-30
- **Tipo**: Desenvolvimento local (sem push)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.58.0
  - **Backend**: env v1.26.0, index v1.11.0, customerDataApi.service v1.0.0, consultaCpfResolver v1.0.0, consultaProductMap v1.0.0, consultas.routes v1.0.0
  - **Frontend**: DeskConsultasPanel v2.0.0, ConsultaOverviewSummary v1.0.0, ConsultaProductCard v1.0.0, useCustomerConsulta v1.0.1, consultaFormatters v1.0.0, client.js v1.20.0
- **Arquivos modificados/criados**:
  - `backend/src/config/env.ts`, `loadFonteVelodeskEnv.cjs` — `x-api-key` (fonte da verdade; dotenv não lê chaves com hífen)
  - `backend/src/services/customerDataApi.service.ts` — proxy Velotax Customer Data API (overview + produtos, retry 503, logs mascarados)
  - `backend/src/services/consultaCpfResolver.service.ts` — CPF resolvido server-side via ticket + `b2c_cadastros.clientes`
  - `backend/src/services/consultaProductMap.ts` — mapeamento tabulação → slug API + prefetch B+
  - `backend/src/routes/consultas.routes.ts`, `backend/src/index.ts` — rotas novas `/api/consultas/*`
  - `frontend/src/hooks/useCustomerConsulta.js` — fetch lazy ao abrir aba + refresh manual + cache por ticket
  - `frontend/src/features/desk/components/DeskConsultasPanel.jsx` e componentes auxiliares — UI 360° real
  - `frontend/src/api/client.js` — `consultasApi`
  - `frontend/velodesk-crm.css` — estilos flags, loading, request-id
- **Descrição**: Integração da aba Consultas com a Velotax Customer Data API (estratégia B+): overview imediato, prefetch paralelo dos produtos com flag ativa + produto do ticket, expand sob demanda para demais produtos. Chave de API somente no backend; sem CPF no ticket bloqueia com mensagem. Homologação end-to-end aguarda chave na fonte da verdade.
- **Validação**: `tsc --noEmit` backend OK; rotas retornam 503 quando chave ausente; checklist guia §10 pendente de chave real.
- **Status**: Desenvolvimento local — `x-api-key` na fonte da verdade; health upstream `Up` validado localmente

---

### GitHub Push — Desk: módulo Preferências (caixas por critérios) + correção do fluxo de anexos inbound

- **Data/Hora**: 2026-07-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.57.0
  - **Preferências / caixas por critérios (backend)**: funcaoPermissaoDefaults v1.2.0, funcaoPermissao.service v1.2.0, DeskAgentQueueBox v1.2.0, agentQueueBox.service v1.1.0, agentQueueBoxes.routes v1.1.0
  - **Preferências / caixas por critérios (frontend)**: PreferenciasPage v1.0.0, PreferenciasView v1.0.1, QueueBoxCriteriaEditor v1.0.0, CreateQueueBoxModal v2.0.0, customQueueBoxCriteria v1.0.1, customQueueBoxes v2.1.0, desk/utils v3.5.0, App v2.6.0, profiles v1.6.0, cockpitBridge v2.3.0, client.js v1.19.0, funcaoPermissoesLabels v1.2.1, DeskV2Root v3.19.0, DeskRightPanel v1.12.0, DeskQueuePanel v1.4.0
  - **Correção anexos inbound**: attachmentFilter.util v1.2.0, gmailAttachment.service v1.4.1, gmailInbound.service v1.4.0, inboundAttachmentStorage v1.4.1, email-inbound.service v1.10.1, uploads.routes v1.3.1
  - **Correção atribuição 1ª interação**: tabulation.service v1.5.0, chamado.mapper v2.5.2, tickets.routes v1.12.2
- **Arquivos modificados**:
  - `backend/src/config/funcaoPermissaoDefaults.ts`, `services/funcaoPermissao.service.ts` — módulo `preferencias.visualizar` no catálogo RBAC + backfill nas funções já existentes
  - `backend/src/models/DeskAgentQueueBox.ts`, `services/agentQueueBox.service.ts`, `routes/agentQueueBoxes.routes.ts` — campo `criterios[]` (tipo/campo/operador/valor) e PUT de atualização
  - `frontend/src/pages/PreferenciasPage.js`, `features/preferencias/PreferenciasView.jsx`, `features/preferencias/components/QueueBoxCriteriaEditor.jsx` — nova página com comportamento ao salvar + CRUD de caixas personalizadas
  - `frontend/src/app/App.js`, `config/profiles.js`, `utils/cockpitBridge.js`, `features/config/funcoes/funcaoPermissoesLabels.js` — rota `/preferencias` com gate de permissão e navegação via bridge do Cockpit
  - `frontend/src/services/desk/customQueueBoxCriteria.js`, `customQueueBoxes.js`, `utils.js` — filtro AND por critérios em `filterTickets`/`countByQueue` (visão virtual)
  - `frontend/src/features/desk/DeskV2Root.jsx`, `components/CreateQueueBoxModal.jsx`, `DeskQueuePanel.jsx`, `DeskRightPanel.jsx`, `styles.css`, `velodesk-crm.css` — modal multi-critério; remoção do botão "Nova caixa" e do popover de settings migrados para Preferências
  - `backend/src/services/attachmentFilter.util.ts` — dedupe por `contentHash` ou `bytes+filename`; fingerprint por nome isolado descontinuada
  - `backend/src/services/gmail/gmailAttachment.service.ts` — `Content-ID` deixa de bloquear parte com `Content-Disposition: attachment`; `message/rfc822` percorrido (container `.eml` e anexos aninhados)
  - `backend/src/services/inboundAttachmentStorage.service.ts` — lookup tolerante a chave legada (`messageId/arquivo`) e a `__` literal no nome; fim do double-decode da storageKey; GCS obrigatório em produção
  - `backend/src/services/gmail/gmailInbound.service.ts`, `email-inbound.service.ts`, `routes/uploads.routes.ts` — alinhamento com o novo dedupe e fallback de chaves no download
  - `backend/src/services/tabulation.service.ts`, `chamado.mapper.ts`, `routes/tickets.routes.ts` — responsável deixa de ser exigido como tabulação; merge do body não apaga claim automático na 1ª interação
- **Descrição**: Novo módulo Preferências concentra o comportamento ao salvar e as caixas personalizadas, agora com filtros multi-critério reais (tabulação, status, workflow, atribuição e SLA) aplicados como visão virtual sobre a fila. No fluxo de anexos recebidos, corrige quatro defeitos que faziam anexos legítimos serem descartados ou retornarem 404: dedupe por nome de arquivo (bloqueava homônimos com conteúdo distinto), descarte de partes com `Content-ID` mesmo marcadas como attachment, perda de `.eml` encaminhado e de anexos aninhados, e incompatibilidade de leitura entre a chave legada com subpasta e o layout flat no bucket. Corrige loop na 1ª interação em que o agente não conseguia salvar porque o backend exigia Responsável na tabulação enquanto o merge do commit apagava a atribuição automática.
- **Validação**: 27 verificações locais do fluxo inbound com round-trip real de gravação/leitura no bucket `velodesk_storage` (anexos homônimos, chave legada, 404 legítimo, path traversal bloqueado); `tsc --noEmit` e lint sem erros. Artefatos de teste removidos do bucket após a execução.
- **Observação**: anexos recebidos antes desta correção existiram apenas no disco efêmero do Cloud Run e permanecem irrecuperáveis (404); a garantia vale a partir do próximo e-mail processado.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: dedupe anexos inbound por mensagem (sem acumular thread)

- **Data/Hora**: 2026-07-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.56.0
  - attachmentFilter v1.1.0, gmailAttachment v1.3.0, gmailInbound v1.4.0
  - email-inbound.service v1.10.0, inbound-email/types v1.3.0
- **Arquivos modificados**:
  - `backend/src/services/attachmentFilter.util.ts` — fingerprints (hash/nome/tamanho) e coleta no chamado
  - `backend/src/services/gmail/gmailAttachment.service.ts` — ignora `message/rfc822` aninhado; dedupe antes do upload GCS
  - `backend/src/services/gmail/gmailInbound.service.ts` — carrega fingerprints do ticket antes de baixar anexos
  - `backend/src/services/email-inbound.service.ts` — safety net `retainOnlyNewAttachments` na resposta
  - `backend/src/services/inbound-email/types.ts` — `contentHash` / `bytes` no anexo inbound
- **Descrição**: Cada mensagem do cliente passa a registrar apenas anexos novos daquela mensagem; anexos reenviados pelo Gmail na thread deixam de ser acumulados nas mensagens seguintes.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: anexos GCS, thread de e-mail, header brand e compose anexo

- **Data/Hora**: 2026-07-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.55.0
  - env v1.24.0, gcsAttachmentStorage v1.3.0, inboundAttachmentStorage v1.3.0, sentAttachmentStorage v1.1.0
  - gmailAttachment v1.2.0, attachmentFilter v1.0.0, uploads.routes v1.3.0
  - emailThread v1.3.0, emailNotification v1.5.0, email-outbound v1.5.0, gmailApiSend v1.3.0, emailBrand v1.0.0
  - chamado.mapper (filtro anexos marca), tickets.routes (notify com attachments)
  - DeskComposePanel v1.11.0, DeskConversation v1.5.7, DeskV2Root (composeAttachments), client.js v1.18.0
  - Dockerfile (raiz + backend) — assets/email com logo Velotax
- **Arquivos modificados**:
  - `backend/src/services/gcsAttachmentStorage.service.ts` — upload/leitura GCS (prefixos inbound/sent)
  - `backend/src/services/inboundAttachmentStorage.service.ts` — await GCS + path flat em `desk_ticket_attachments/`
  - `backend/src/services/sentAttachmentStorage.service.ts` — anexos do agente flat em `desk_ticket_sent_attachments/`
  - `backend/src/services/gmail/gmailAttachment.service.ts` — ignora inline/CID e logo de marca no inbound
  - `backend/src/services/attachmentFilter.util.ts`, `emailBrand.util.ts` — filtro + header gradiente/logo
  - `backend/src/services/emailThread.service.ts` — thread única (In-Reply-To/References + âncora por protocolo)
  - `backend/src/services/emailNotification.service.ts`, `email-outbound.service.ts`, `gmail/gmailApiSend.ts` — layout brand, anexos MIME, logo CID
  - `backend/src/routes/uploads.routes.ts`, `tickets.routes.ts`, `config/env.ts`, Dockerfiles
  - `frontend/.../DeskComposePanel.jsx`, `DeskV2Root.jsx`, `DeskConversation.jsx`, `api/client.js`, `velodesk-crm.css`
  - `public/simbolo_velotax_ajustada_branco.png`, `backend/assets/email/`
- **Descrição**: Anexos inbound/outbound no bucket `velodesk_storage` sem subpastas; respostas do agente na mesma thread Gmail; e-mail ao cliente com header gradiente (azul escuro→médio→opaco) e logo Velotax; botão Anexo no compose ao lado do Revisor de Texto; logo/inline deixam de aparecer como anexo do cliente.
- **Status**: Concluído (push dev)

---

### GitHub Push — Desk: caixas personalizadas, IA composição, assunto e-mail e nome operador

- **Data/Hora**: 2026-07-29
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.54.0
  - database v1.8.3, env v1.22.0, DeskAgentQueueBox v1.1.0, agentQueueBox.service v1.0.1, agentQueueBoxes.routes v1.0.1
  - agentTabulation.util v1.2.0, agentOrchestrator v1.0.3, atendimentoPersona v1.2.0, openaiTicketSuggest v1.2.0
  - colaboradoresCadastro v1.3.1, emailThread v1.2.0, email-outbound v1.3.0, emailNotification v1.3.1, tickets.routes v1.12.1
  - useTicketAiSuggestions v1.5.0, customQueueBoxes v2.0.0, DeskComposePanel v1.10.4, userDisplayName v1.2.0, AuthContext v1.8.3
- **Arquivos modificados**:
  - `backend/src/config/database.ts`, `env.ts`, `index.ts` — conexão `desk_preferences` + health
  - `backend/src/models/DeskAgentQueueBox.ts`, `services/agentQueueBox.service.ts`, `routes/agentQueueBoxes.routes.ts` — caixas personalizadas em `desk_preferences.desk_agent_boxex` (GET/POST/migrate/DELETE)
  - `frontend/src/services/desk/customQueueBoxes.js`, `DeskV2Root.jsx`, `CreateQueueBoxModal.jsx`, `api/client.js` — hidratação e persistência API (substitui só localStorage)
  - `frontend/src/hooks/useTicketAiSuggestions.js`, `backend/.../agentTabulation.util.ts`, `openaiTicketSuggest.service.ts`, `atendimentoPersona.ts` — agente de composição com histórico público + anotações internas
  - `backend/src/services/emailThread.service.ts`, `emailNotification.service.ts`, `tickets.routes.ts` — assunto padronizado `Atendimento Velotax Numero {protocolo}`; criação manual envia 1ª mensagem pública do agente
  - `colaboradoresCadastro.service.ts`, rotas `ticketAi/agents/compose/auth` — `nomeOperador` resolvido no servidor (alias ou primeiro+último de colaboradorNome)
  - `DeskComposePanel.jsx` — botão renomeado para **Revisor de Texto**; `userDisplayName.js`, `AuthContext.js`, `clientDb.js`
- **Descrição**: Caixas “Nova caixa” persistem por agente no Mongo; sugestão IA considera thread completa incluindo anotações internas; e-mails ao cliente deixam de usar nome do cliente no assunto; identificação do operador nas respostas IA vem do cadastro do colaborador logado.
- **Status**: Concluído (push dev)

---

### GitHub Push — Desk: ciclo status inbound e-mail + fechamento resolvido 48h

- **Data/Hora**: 2026-07-29
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.53.0
  - ChamadoN1 v1.8.0, chamado.mapper v2.5.1, email-inbound.service v1.8.0
  - closeResolvedTickets.service v1.0.1, closeResolvedTickets.job v1.0.0, env v1.21.0, index v1.10.0
  - tickets.routes v1.12.0, ticketMerge.service v1.1.0
  - DeskV2Root v3.18.2, desk/utils v3.4.0, DeskComposePanel v1.10.0, DeskClientProfileBar v1.9.2
  - ticketsStorage v1.3.0, velodesk-crm.css v1.9.1, test-status-lifecycle v1.0.0
- **Arquivos modificados**:
  - `backend/src/models/ChamadoN1.ts` — enum `fechado` em `registro.status`
  - `backend/src/services/chamado.mapper.ts` — helpers ciclo (resolvedAt, assert fechado, spawn inbound, fila Resolvidos)
  - `backend/src/services/email-inbound.service.ts` — pendente/resolvido&lt;48h → em-andamento; fechado/cancelado/resolvido≥48h → ticket novo
  - `backend/src/jobs/closeResolvedTickets.job.ts`, `closeResolvedTickets.service.ts` — job horário resolvido → fechado (backfill na 1ª run)
  - `backend/src/config/env.ts`, `backend/.env.example` — `RESOLVED_CLOSE_INTERVAL_MS`, `RESOLVED_CLOSE_AFTER_MS`
  - `backend/src/routes/tickets.routes.ts`, `ticketMerge.service.ts`, agents — bloqueio 409 em ticket fechado
  - `frontend/src/services/desk/utils.js`, `ticketsStorage.js`, `DeskV2Root.jsx` — badge Fechado + Desk somente leitura
  - `frontend/velodesk-crm.css` — `.status-badge--fechado` e banner compose bloqueado
  - `backend/scripts/test-status-lifecycle.ts` — script de validação do ciclo
- **Descrição**: Automação pós-resposta do cliente: pendente vira em-andamento; resolvido reabre se &lt;48h; após 48h job fecha como fechado (imutável); nova resposta gera ticket novo. Fechados permanecem na fila Resolvidos com badge distinta.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: estabilidade, formatação e-mail, Cancelado gestão, links na thread

- **Data/Hora**: 2026-07-28
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.52.0
  - TicketsContext v1.7.4, DeskV2Root v3.16.4
  - htmlText.util v1.0.0, desk/utils v3.3.13, DeskConversation v1.5.4
  - chamado.mapper v2.3.3, email-inbound.service v1.7.1, emailHtml.util v1.0.1
  - constants v2.3.3, DeskComposePanel v1.9.4, velodesk-crm.css v1.8.9
- **Arquivos modificados**:
  - `frontend/src/context/TicketsContext.js` — restaura `import deskLog` (corrige `ReferenceError` em prod)
  - `frontend/src/features/desk/DeskV2Root.jsx` — traço `render:thread-mudou` em `useEffect`
  - `frontend/src/utils/htmlText.util.js` (novo) — decodifica `&nbsp;` e entidades HTML na thread
  - `backend/src/services/email-inbound.service.ts`, `chamado.mapper.ts`, `emailHtml.util.ts` — normalização na ingestão e no DTO
  - `frontend/src/services/desk/utils.js`, `DeskConversation.jsx` — exibição sem entidades literais
  - `frontend/src/services/desk/constants.js`, `DeskComposePanel.jsx` — opção **Cancelado** restaurada para perfil Gestão (`gestao` / `shouldViewAllDeskTickets`)
  - `frontend/velodesk-crm.css` — quebra de linha de URLs/texto longo dentro da bolha da mensagem
- **Descrição**: Hotfix de estabilidade pós-instrumentação; mensagens de e-mail deixam de exibir `&nbsp;` literal; perfil Gestão volta a enviar ticket como Cancelado; links longos na conversa ficam contidos na bolha.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: instrumentação auto-refresh prod + rede local

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.50.0
  - deskPlatformTrace v1.0.0, deskTraceIngestConfig v1.0.0, deskDebugLog v1.0.1
  - DeskV2Root v3.16.3, TicketsContext v1.7.3, .env.example v1.3.1
- **Arquivos modificados**:
  - `frontend/src/utils/deskPlatformTrace.js` (novo) — traços enxutos sempre no console (`[VeloDesk:trace]`) com contexto env/host/rede; ingest opcional
  - `frontend/src/utils/deskTraceIngestConfig.js` (novo) — URL de ingest via sessionStorage, `VITE_DESK_TRACE_INGEST_URL` ou localhost:7310 em dev
  - `frontend/src/utils/deskDebugLog.js` — `velodeskDebug.setTraceIngest()` / `getTraceIngest()`
  - `frontend/src/features/desk/DeskV2Root.jsx` — poll 15s: `poll:msgs-mudou`, `poll:erro`, `render:thread-mudou`
  - `frontend/src/context/TicketsContext.js` — `patchTicket:miss` quando cache não aplica patch
  - `frontend/.env.example` — documenta `VITE_DESK_TRACE_INGEST_URL`
- **Descrição**: Centraliza instrumentação do auto-refresh do Desk para funcionar em produção e rede local (console sempre visível). Ingest remoto deixa de depender de fetch hardcoded espalhado; em prod sem config só console; em dev/LAN configurável por env ou `velodeskDebug.setTraceIngest(url)`.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: aliasColaborador, higienização e-mail e expurgo avaliação bot

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.49.0
  - userDisplayName v1.1.0, colaboradoresCadastro.service v1.3.0, auth.routes v1.5.0
  - DeskComposePanel v1.9.3, chamado.mapper v2.3.2, emailReplyContent.util v1.0.0
  - botEvaluationPurge.service v1.0.0, desk/utils v3.3.12
- **Arquivos modificados**:
  - `frontend/src/utils/userDisplayName.js`, `clientDb.js`, `AuthContext.js`, `hubSession.js` — nome de exibição: `aliasColaborador` → primeiro+último de `colaboradorNome` → fallback e-mail
  - `backend/src/services/colaboradoresCadastro.service.ts`, `auth.routes.ts` — projeta `aliasColaborador`; JWT/login usa `resolveColaboradorDisplayName`
  - `frontend/src/features/desk/components/DeskComposePanel.jsx` — Revisão de texto (Gemini) usa `getDeskDisplayName` no compose
  - `backend/src/services/emailReplyContent.util.ts`, `email-inbound.service.ts`, `chamado.mapper.ts`, `frontend/src/services/desk/utils.js` — remove citação/assinatura de respostas de e-mail na thread
  - `backend/scripts/purge-bot-evaluation-tickets.ts`, `botEvaluationPurge.service.ts` — expurgo de tickets de pesquisa `info@velotax.info` (1.398 removidos em dev)
- **Descrição**: Compositores e revisores de mensagem passam a usar alias ou nome civil em vez do prefixo do e-mail. Respostas inbound de e-mail deixam de poluir a conversa com thread citada. Script de expurgo remove tickets gerados pelas pesquisas de avaliação do bot antes da regra `mail_ignorado`.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: correção crítica do fluxo inbound de e-mail (thread contínua)

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.48.0
  - gmailInbound.service v1.2.0, gmailWatch.service v1.2.0, email-inbound.service v1.6.0
  - GmailInboundMessage v1.0.0, inboundDedupe.service v1.0.0
  - emailBootstrap.service v1.1.0, inbound.routes v1.3.0
  - mailRules.service v1.0.1, EmailConfigSection v1.0.0
  - TicketsContext v1.7.0, DeskV2Root v3.16.0
- **Arquivos modificados**:
  - `backend/src/services/gmail/gmailInbound.service.ts` — ponteiro de history monotônico: o `historyId` avança para o último record concluído mesmo com backlog parcial; corte de orçamento só em fronteira de record e só depois de concluir um; orçamento conta apenas trabalho real (`created`/`replied`); `history.list` com `labelId: INBOX`; realinhamento explícito quando o Gmail expira o `historyId`; logs de instrumentação por mensagem e por ciclo
  - `backend/src/services/gmail/gmailWatch.service.ts` — `persistWatchState` não sobrescreve mais o `historyId` (preserva backlog em cold start/renovação); `updateStoredHistoryId` só avança para frente e informa se houve avanço
  - `backend/src/models/GmailInboundMessage.ts` — nova collection `gmail_inbound_messages` em `desk_config` (índice único por `messageId`)
  - `backend/src/services/inboundDedupe.service.ts` — claim atômico por Message-Id, retomada de claim abandonado, limite de tentativas e registro de falha
  - `backend/src/services/email-inbound.service.ts` — claim antes de criar/anexar; marca `done`/`failed`; fluxo interno extraído para `runInboundEmailFlow`
  - `backend/src/services/emailBootstrap.service.ts` — garante índice de idempotência no bootstrap
  - `backend/src/routes/inbound.routes.ts` — 503 (retry Pub/Sub) quando o `desk_config` ainda não está pronto no cold start
  - `backend/src/models/mailRule.shared.ts`, `MailIgnorado.ts`, `MailSpam.ts`, `MailPriority.ts`, `mailRules.service.ts`, `mailRules.routes.ts` — listas de e-mail ignorado/spam/prioridade
  - `frontend/src/features/config/email/EmailConfigSection.jsx` — aba E-mail na Central
  - `frontend/src/context/TicketsContext.js` — `refreshTicketsSilent` (atualização de fundo sem spinner)
  - `frontend/src/features/desk/DeskV2Root.jsx` — atualização automática do ticket aberto (15s) e das filas (60s), pausada em aba oculta e durante envio
- **Configuração de dados**: `desk_config.mail_ignorado` recebeu `info@velotax.info` (pesquisas de avaliação) — gerenciável na Central de Configurações › E-mail
- **Descrição**: O inbound Gmail entrava em livelock: ao estourar o teto de 8 mensagens por push, o `historyId` não era gravado, então cada retry do Pub/Sub reprocessava as mesmas 8 mensagens como duplicadas e a fila nunca andava (4.450 pushes entre 16:51 e 19:42 UTC de 27/07). O ciclo só quebrava quando um cold start chamava `users.watch`, que sobrescrevia o ponteiro e descartava todo o backlog — as respostas de cliente daquela janela eram perdidas. Além disso, pushes concorrentes criavam tickets duplicados para o mesmo Message-Id (63 casos no histórico). No frontend, o Desk não tinha nenhuma atualização automática, então a mensagem já gravada só aparecia quando o agente agia.
- **Status**: Concluído (push dev + main)

### GitHub Push — Desk: config inbound e-mail (ignorados, spam, prioritários)

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push (pendente autorização)
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.47.0
  - mailRules.service v1.0.1, email-inbound.service v1.5.0, inbound-email/types v1.1.0
  - mailRules.routes v1.0.0, EmailConfigSection v1.0.0, client.js v1.15.0
  - ConfigView v3.6.0, configSections v1.4.0, Sidebar v1.11.0, AppShell v2.6.0
- **Arquivos modificados**:
  - `backend/src/models/mailRule.shared.ts`, `MailIgnorado.ts`, `MailSpam.ts`, `MailPriority.ts` — collections `mail_ignorado`, `mail_spam`, `mail_priority` em `desk_config`
  - `backend/src/services/mailRules.service.ts` — CRUD, snapshot em memória, `matchMailRule` (precedência spam > ignorado > priority)
  - `backend/src/services/emailBootstrap.service.ts` — `loadMailRules()` no bootstrap
  - `backend/src/services/email-inbound.service.ts` — skip antes de reply/create; prioridade `alta` + `metadados.mailPriority`
  - `backend/src/services/inbound-email/types.ts` — action `skipped` com reason
  - `backend/src/routes/mailRules.routes.ts`, `backend/src/index.ts` — API `/api/mail-rules/:list`
  - `backend/scripts/test-mail-rules.ts` — testes de match, precedência e skip
  - `frontend/src/features/config/email/EmailConfigSection.jsx` — aba E-mail na Central
  - `frontend/src/features/config/configSections.js`, `ConfigView.jsx` — wire-up da seção
  - `frontend/src/api/client.js` — `mailRulesApi`
  - `frontend/styles.css` — estilos da seção E-mail
  - `frontend/src/components/Sidebar.jsx`, `frontend/src/layout/AppShell.jsx` — remove Assistente IA da barra lateral
- **Descrição**: Central de Configurações ganha aba E-mail com três listas persistidas em `desk_config`. O inbound aplica filtro inline (sem worker): spam/ignorados não criam ticket nem respondem thread; prioritários criam com prioridade alta. Assistente IA global removido da sidebar (mantido no compose do ticket).
- **Status**: Implementado localmente — push aguardando autorização

---

### GitHub Push — Desk: restaura histórico de alterações na aba Notas

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.6
  - DeskInternalNotesPanel v1.4.1, desk/utils v3.3.10
- **Arquivos modificados**:
  - `frontend/src/features/desk/components/DeskInternalNotesPanel.jsx` — visão de histórico por `shouldViewAllDeskTickets` (não só `profileId === gestao`); renderiza cards `registro` com alterações
  - `frontend/src/services/desk/utils.js` — feed do agente inclui histórico de alterações/status sem remover notas internas
- **Descrição**: Com mensagens e notas internas já ok, o histórico de alterações sumia porque a aba Notas só montava o feed completo quando `profileId === 'gestao'`. No RBAC atual, gestão/supervisor com `ver_todos` pode operar no portal agent e perdia as alterações. Restaura o histórico sem alterar o cache de detalhe do ticket.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: patchTicketInCache não gravava detalhe no array

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.5
  - ticketsCache v1.9.7
- **Arquivos modificados**:
  - `frontend/src/services/ticketsCache.js` — `patchTicketInCache` e update offline passam a substituir `box.tickets[index]`; `findInColumns` retorna o índice
- **Descrição**: Corrige causa raiz da UI sem conversa/notas/histórico: GET `/tickets/:id` retornava o detalhe completo, mas `entry.ticket = next` só alterava um wrapper local e o array da listagem (`listOnly` vazio) continuava sendo lido pelo Desk.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: race condition apagava conteúdo de tickets após refresh

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.4
  - ticketsCache v1.9.6, DeskV2Root v3.14.3
- **Arquivos modificados**:
  - `frontend/src/services/ticketsCache.js` — merge preserva detalhe só com conteúdo real; usa estado atual das colunas no merge (não snapshot); cache local `velodesk_boxes_cache_v2`; sanitiza `_detailLoaded` vazio
  - `frontend/src/features/desk/DeskV2Root.jsx` — recarrega detalhe após refresh de filas (`refreshKey`)
- **Descrição**: Corrige regressão em que GET `/tickets/:id` carregava o ticket completo, mas o refresh de `/boxes` sobrescrevia com cache vazio (`_detailLoaded` sem mensagens). Conversa, notas e histórico voltam a persistir na UI.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: conteúdo de tickets + Gmail Pub/Sub em lotes

- **Data/Hora**: 2026-07-27
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.3
  - index v1.9.6, tickets.routes v1.10.1, gmailInbound.service v1.1.0, inbound.routes v1.2.1
  - nginx-cloudrun.conf.template v1.0.3, env (GMAIL_INBOUND_*)
  - client.js v1.14.1, ticketsCache v1.9.5, DeskV2Root v3.14.2
- **Arquivos modificados**:
  - `backend/src/index.ts` — `etag: false` + `Cache-Control: no-store` em `/api` (evita 304 sem body no GET ticket)
  - `backend/src/routes/tickets.routes.ts` — detalhe do ticket sem cache HTTP
  - `frontend/src/api/client.js` — GET ticket sem cache; rejeita body vazio
  - `frontend/src/services/ticketsCache.js` — valida detalhe antes de `_detailLoaded`
  - `frontend/src/features/desk/DeskV2Root.jsx` — recarrega ticket vazio; fim do loop com `refreshKey`
  - `backend/src/services/gmail/gmailInbound.service.ts` — processamento em lotes (8 msg / 50s); `historyId` só avança ao concluir lote
  - `backend/src/routes/inbound.routes.ts` — 503 em backlog parcial (Pub/Sub reentrega)
  - `docker/nginx-cloudrun.conf.template` — `proxy_read_timeout 120s` em `/api/inbound/gmail/pubsub`
  - `backend/.env.example` — `GMAIL_INBOUND_MAX_MESSAGES_PER_PUSH`, `GMAIL_INBOUND_BUDGET_MS`
- **Descrição**: Corrige tickets sem conversa/notas/histórico em produção (ETag 304 + marcação prematura de `_detailLoaded`). Corrige timeout 504 do Gmail Pub/Sub com processamento em lotes e retry controlado via 503.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk: Meus Tickets, resolvidos globais e visão gestão

- **Data/Hora**: 2026-07-24
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.2
  - chamado.mapper v2.3.1, permission.service v1.6.1, workspace360.routes v1.2.1
  - responsavelSegmentation v1.5.0, desk/utils v3.3.9, ticketsCache v1.9.4
  - permissionService (FE) v1.5.1, TicketsContext v1.6.1
  - DeskV2Root v3.14.1, DeskMyTicketsTable v1.2.1
- **Arquivos modificados**:
  - `backend/src/services/chamado.mapper.ts` — resolvidos em `meus-chamados` sem filtro de responsável (visão global na sidebar)
  - `backend/src/services/permission.service.ts` — função gestão não usa fila `meus-chamados`; `canViewTicket` libera todos os tickets
  - `backend/src/routes/workspace360.routes.ts` — gestão com `ver_todos` usa visão equipe no Painel 360°
  - `frontend/src/services/desk/responsavelSegmentation.js` — `shouldViewAllDeskTickets` para gestão/supervisor/ver_todos
  - `frontend/src/services/desk/utils.js` — Meus Tickets confia backend (sem double-filter); em andamento restaurado; gestão vê todas categorias
  - `frontend/src/services/ticketsCache.js` — não re-filtra novos/em andamento após API meus-chamados
  - `frontend/src/services/permissions/permissionService.js` — gestão não usa meus-chamados; evento recarrega filas
  - `frontend/src/context/TicketsContext.js` — recarrega boxes ao carregar permissões
  - `frontend/src/features/desk/DeskV2Root.jsx` — fila vazia permanece selecionada (sem redirect automático)
  - `frontend/src/features/desk/components/DeskMyTicketsTable.jsx` — seção Em andamento com cabeçalho retrátil
- **Descrição**: Corrige regressões de filas do Desk: agentes voltam a ver em andamento em Meus Tickets (fim do double-filter), resolvidos globais na sidebar, gestão vê todos os tickets em todas as categorias, e Painel 360° de gestão usa visão equipe com `ver_todos`.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — fix build TypeScript (GCP Cloud Build)

- **Data/Hora**: 2026-07-24
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.1
  - workflowTicket.service v1.4.1, workflowDefinicao.service v1.7.1, funcaoPermissao.service v1.1.1
- **Arquivos modificados**:
  - `backend/src/services/workflowTicket.service.ts` — ticketCtx usa só `tabulacao` (IChamadoN1 sem lateralForm)
  - `backend/src/services/workflowDefinicao.service.ts` — `resolveWorkflowForTicket` aceita `lateralForm?: Record<string, unknown>`
  - `backend/src/services/funcaoPermissao.service.ts` — merge lean com `satisfies Pick<>` em vez de `IDeskFuncaoPermissao` Document
- **Descrição**: Corrige falha do `tsc` no Cloud Build (TS2345, TS2339, TS2740) que impedia deploy Docker.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Workflow RBAC, requisição, filas e comunicação

- **Data/Hora**: 2026-07-24
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev + main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.46.0
  - permission.service v1.6.0, chamado.mapper v2.3.0, boxes.routes v1.7.0, agenteDesk.service v1.3.0
  - workflowRequisicao.service v1.2.0, workflowTicket.service v1.3.0, workflowRequisicaoDefaults v1.0.0
  - permissionService (FE) v1.2.0, workflowApprovalData v1.4.0, workflowDecisionHandlers v2.2.0
  - WorkflowApprovalShell v1.2.0, WorkflowComunicacaoModal v1.2.0, WorkflowCriteriaEditor v2.3.0
  - TabulationContext v1.4.0, workflowConfigData v2.8.0, WorkflowStepEditor v1.3.0
  - DeskV2Root v3.10.0, ticketsCache v1.3.0, FuncoesPermissoesSection v2.5.0
- **Arquivos modificados (principais)**:
  - `backend/src/services/permission.service.ts` — atuação WF por overrides (`portal.workflow` + `tickets.atuar_atribuido`); escopo por `funcao:{func}` ou definição `escalonar-{func}`
  - `backend/src/services/chamado.mapper.ts` — fila workflow: `atribuido` OU `workflowId` da definição do time
  - `backend/src/routes/boxes.routes.ts` — filtro de boxes alinhado ao escopo de workflow por função
  - `backend/src/services/agenteDesk.service.ts` — GET agentes lê VeloHub ao vivo; upsert sem conflito `$set/$setOnInsert`
  - `backend/src/services/workflowRequisicao.service.ts` — form de requisição + comunicação workflow (`markModified`)
  - `backend/src/config/workflowRequisicaoDefaults.ts` — defaults de campos de requisição por gatilho
  - `backend/src/routes/tickets.routes.ts` — `POST /workflow/start`; endpoints de comunicação/requisição
  - `frontend/src/features/desk/DeskV2Root.jsx` — Iniciar Workflow manual com drawer de requisição; sem auto-ativação
  - `frontend/src/features/desk/components/WorkflowRequisicaoForm.jsx` — form dinâmico ao iniciar workflow
  - `frontend/src/features/config/workflow/` — editor de requisição, gatilho com opções de tabulação em cascata
  - `frontend/src/features/workflow/components/WorkflowComunicacaoModal.jsx` — thread “pedir informação” com carga otimista
  - `frontend/src/features/workflow/components/WorkflowApprovalShell.jsx` — fila/decisões por permissão; comunicação integrada
  - `frontend/src/context/TabulationContext.jsx` — `resolveMotivoOptions`/`resolveDetalheOptions` para gatilhos
  - `frontend/src/services/ticketsCache.js` — merge preserva `comunicacaoWorkflow`
  - `frontend/src/features/config/funcoes/` — lista de agentes ao abrir seção; removido botão sync manual
  - `frontend/velodesk-crm.css`, `velodesk-ecosystem.css`, `velodesk-dark-theme.css` — estilos workflow/requisição/comunicação
- **Descrição**: Pacote consolidado de workflow: RBAC por permissões (sem hardcode financeiro/produtos), fila de atuação corrigida para times com `escalonar-{func}`, form de requisição configurável no gatilho, Iniciar Workflow manual no Desk, comunicação “pedir informação” persistida e exibida no modal, agentes desk sincronizados do VeloHub, e gatilhos de ativação populados via tabulação.
- **Status**: Concluído (push dev + main)

---

### GitHub Push — Desk UX: Meus Tickets, preferência ao salvar e seleção manual

- **Data/Hora**: 2026-07-21
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.43.0
  - DeskV2Root v3.8.1, DeskRightPanel v1.6.2, DeskMyTicketsTable v1.1.0
  - agentDeskPreferences v1.0.0, desk/utils v3.1.0, desk/constants (Meus Tickets + termômetro off)
  - velodesk-crm.css v1.8.5, Sidebar v1.10.2
- **Arquivos modificados**:
  - `frontend/src/features/desk/DeskV2Root.jsx` — não auto-abre primeiro ticket ao trocar fila; tabs preservadas; tabela priorizada em Resolvidos/Meus Tickets
  - `frontend/src/features/desk/components/DeskRightPanel.jsx` — config agente (Fechar/Manter ao salvar) em portal; termômetro oculto
  - `frontend/src/features/desk/components/DeskMyTicketsTable.jsx` — fila virtual Meus Tickets por status/SLA
  - `frontend/src/services/desk/agentDeskPreferences.js` — preferência local `velodeskDeskAutoCloseOnSave`
  - `frontend/src/services/desk/utils.js` — filtro Meus Tickets, `pickNextTicketFromEntries`, listas visíveis
  - `frontend/src/services/desk/constants.js` — `MEUS_TICKETS_QUEUE_ID`, `DESK_THERMOMETER_UI_ENABLED=false`
  - `frontend/velodesk-crm.css` — estilos Meus Tickets, popover config agente, fila tabular
  - `frontend/src/components/Sidebar.jsx`, CSS cockpit/ecosystem — faixa retrátil 10px e ajustes visuais
- **Descrição**: Melhorias de UX no Desk v2 — seleção manual de tickets, fila Meus Tickets, comportamento configurável ao salvar, prioridade de tabela em Resolvidos/Meus Tickets sem fechar tabs.
- **Status**: Concluído (`2b8b3e5` em `dev`, push 11 commits `4518589..2b8b3e5`)

---

### GitHub Push — Pacote filas e roleta (resolvidos global, presença, cap-10)

- **Data/Hora**: 2026-07-21
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.42.0
  - chamado.mapper v1.9.1, assignmentRouter v1.2.0, agentPresence v1.0.0, AgentPresence model v1.0.0
  - agents.routes v1.2.0, tickets.routes v1.6.0, env.ts v1.20.0
  - ticketAdapter v1.4.6, desk/utils v3.0.4, AuthContext v1.8.0, AppShell v2.5.0
  - agentPresence.js v1.0.0, AgentPresenceHeartbeat v1.0.0, test-assignment-router v1.2.0
- **Arquivos modificados**:
  - `backend/src/services/chamado.mapper.ts` — coluna `meus-resolvidos` sem filtro de responsável
  - `backend/src/services/assignmentRouter.service.ts` — roleta cap-10 online, flag `atribuicaoRoleta`, backfill, claim manual
  - `backend/src/services/agentPresence.service.ts`, `backend/src/models/AgentPresence.ts` — heartbeat/offline
  - `backend/src/routes/agents.routes.ts` — `POST /presence/heartbeat` e `/offline`
  - `backend/src/routes/tickets.routes.ts` — adoção manual de órfão no PUT/messages
  - `backend/src/config/env.ts` — `ASSIGNMENT_ROUTER_MAX_OPEN`, `ASSIGNMENT_ROUTER_PRESENCE_TTL_MS`
  - `frontend/src/api/adapters/ticketAdapter.js`, `frontend/src/services/desk/utils.js` — resolvidos global na UI
  - `frontend/src/services/agentPresence.js`, `AgentPresenceHeartbeat.jsx`, `AuthContext.js`, `AppShell.jsx`
  - `backend/scripts/test-assignment-router.ts` — testes cap e claim manual
- **Descrição**: Agentes veem Resolvidos de todos os responsáveis; roleta distribui inbound com cap 10 por agente online (presença heartbeat); adoção manual de órfãos no save/mensagem fora do cap.
- **Status**: Pendente push

---

### GitHub Push — Correção rate limit 429 (5000 + isenção GET leitura)

- **Data/Hora**: 2026-07-21
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.41.0
  - index.ts v1.9.6, env.ts v1.19.0, rateLimitPolicy v1.0.0
  - ticketsCache v1.7.0, ProtectedRoute v1.3.0, apiErrors v1.0.0
  - TicketsContext v1.5.0, TabulationContext v1.3.0, WorkflowConfigContext v1.1.0
  - PermissionContext v1.1.0, NotificationContext v1.2.0
- **Arquivos modificados**:
  - `backend/src/index.ts` — limite global via `API_RATE_LIMIT_MAX` (default 5000 prod)
  - `backend/src/config/env.ts` — `apiRateLimitMax`
  - `backend/src/middleware/rateLimitPolicy.ts` — isenção GET leitura frequente
  - `frontend/src/routes/ProtectedRoute.jsx` — remove `/api/boxes` duplicado
  - `frontend/src/services/ticketsCache.js` — dedup in-flight `loadBoxesFromApi`
  - `frontend/src/utils/apiErrors.js` — mensagem 429 compartilhada
  - Contexts: Tickets, Tabulation, Workflow, Permission, Notification — tratamento 429
- **Descrição**: Corrige 429 em produção (limite 200/15min insuficiente). Aumenta cota para 5000, isenta GETs de leitura do Desk, elimina chamada duplicada a boxes e deduplica requisições concorrentes.
- **Status**: Concluído (`6058948` em `main`)

---

### GitHub Push — Redeploy Cloud Run (trigger migrado para main)

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push → Cloud Build → Cloud Run
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Projeto GCP**: velohub-471220
- **Serviço**: velodesk (us-east1)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.40.0
  - Dockerfile raiz v2.0.0 (web + API combinados)
- **Contexto**: Gatilho Cloud Build alterado de `dev` para `main`; push forçado para rebuild/deploy com estado atual (`ebab610` — merge dev→main, fix build Cloud Run, POPs removidos do git).
- **Validação pós-deploy**:
  ```powershell
  Invoke-RestMethod -Uri "https://velodesk-278491073220.us-east1.run.app/health" | ConvertTo-Json
  Invoke-RestMethod -Uri "https://velodesk-278491073220.us-east1.run.app/api/inbound/gmail/health" | ConvertTo-Json
  ```
- **Status**: Em andamento (disparado via push main)

---

### GitHub Push — Remove POPs/ do repositório remoto

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.39.0
  - `.gitignore` — ignora `POPs/` (documentos operacionais locais, fora do git)
- **Arquivos removidos do repositório**:
  - `POPs/` — 21 documentos .docx (permanecem apenas fora do controle de versão / ambiente local)
- **Descrição**: Retira POPs do GitHub; base de POPs continua na vector store OpenAI usada pela sugestão IA.
- **Status**: Concluído

---

### GitHub Push — Merge dev → main (Desk CRM, workflows, Gmail, agentes IA, POPs)

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: main
- **Versão (componentes)**:
  - DEPLOY_LOG v1.38.0
  - POPs/ (21 documentos .docx operacionais)
  - Merge de 25 commits de `dev` (c58e3a3)
- **Escopo principal incluído no merge**:
  - Desk CRM v2: workflows persistidos, stepper, pedidos de informação, Reclame Aqui, canais Especiais, encaminhamento Produtos
  - Agentes IA paralelos (atendimento, auditoria, gestão de chamados) + Workspace360
  - Gmail inbound/outbound E2E, protocolo externo, caixa suporte@, watcher de protocolo
  - Fix build Cloud Run (watcher TS, Vite 5.4, roleta ativa por padrão)
  - Remoção frontend-legacy; colaboradores Desk; tabulação e spellcheck
- **Arquivos novos neste commit**:
  - `POPs/` — POPs operacionais Velotax (CAD, Cup, EP, FIN, IDQ, IR26, SEG-CEL, SEG-PR)
- **Descrição**: Promove `dev` para `main` com o estado estável atual do Velodesk (API + SPA + POPs locais). Base para deploy produção a partir de `main`.
- **Status**: Concluído

---

### GitHub Push — Fix build Cloud Run (watcher TS + frontend Vite)

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.37.0
  - chamadoProtocoloWatcher.service v1.0.2
  - env.ts v1.18.1
  - useProdSolicTicketPrefill.js (import ticketsStorage)
- **Arquivos modificados**:
  - `backend/src/services/chamadoProtocoloWatcher.service.ts` — tipos locais no change stream (remove import mongodb v7; corrige TS2739/TS2345 no Docker)
  - `backend/src/config/env.ts`, `backend/.env.example`, `.env.docker.example` — roleta ativa por padrão no deploy (`!== 'false'`)
  - `frontend/package.json`, `frontend/package-lock.json` — Vite 5.4.21 (evita quebra do Vite 8 pós audit)
  - `frontend/src/features/cadastral/components/useProdSolicTicketPrefill.js` — import `ticketsStorage` (kanbanStorage removido)
- **Descrição**: Desbloqueia Cloud Build nos steps `npm run build` (API + SPA). Protocolo watcher compatível com mongoose; frontend build estável.
- **Status**: Concluído

---

### GitHub Push — Fix build Cloud Run (ChangeStream TS strict)

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.36.0
  - chamadoProtocoloWatcher.service v1.0.1
- **Arquivos modificados**:
  - `backend/src/services/chamadoProtocoloWatcher.service.ts` — tipagem `ChangeStream<Record<string, unknown>>` + variável local `stream` (corrige TS18047/TS2739 no `tsc` do Docker)
- **Descrição**: Desbloqueia Cloud Build que falhava no step `npm run build` após merge Reclame Aqui / protocolo watcher.
- **Status**: Concluído

---

### GitHub Push — Caixa Gmail suporte@ + script update-email-mailbox

- **Data/Hora**: 2026-07-20
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.35.0
  - update-email-mailbox.ts v1.0.0, test-gmail-inbound.ts v1.0.1
- **Arquivos modificados / incluídos**:
  - `backend/scripts/update-email-mailbox.ts` — troca `defaultFromEmail` / `delegatedUserEmail` em `desk_config.email_transport`
  - `backend/package.json` — script `npm run update:email-mailbox`
  - `backend/scripts/test-gmail-inbound.ts` — documentação de teste apontando para `suporte@velotax.com.br`
- **Alteração operacional (MongoDB, fora do git)**:
  - `desk_config.email_transport`: remetente e delegação de `atendimento@velotax.com.br` → `suporte@velotax.com.br`
  - Gmail watch reativado na caixa `suporte@` (health produção: `mailbox=suporte@velotax.com.br`)
- **Descrição**: Corrige endereço de atendimento e-mail (inbound/outbound) para `suporte@velotax.com.br`; adiciona script operacional para futuras trocas de caixa sem re-seed da SA.
- **Validação pós-deploy**:
  ```powershell
  Invoke-RestMethod -Uri "https://velodesk-278491073220.us-east1.run.app/api/inbound/gmail/health" | ConvertTo-Json
  ```
  Esperado: `mailbox: suporte@velotax.com.br`, `ready: true`
- **Status**: Concluído

---

### GitHub Push — Correção scroll vertical (conversa Desk + Config)

- **Data/Hora**: 2026-07-17
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.34.0
  - velodesk-crm.css v1.7.4, viewport-scale.css v1.0.6
- **Arquivos modificados**:
  - `frontend/velodesk-crm.css` — `.conversation`: remove `justify-content: flex-end` que bloqueava scroll; `margin-top: auto` no 1º item
  - `frontend/styles.css` — `#config`: flex chain + `overflow-y: auto` em `.config-content`
  - `frontend/velodesk-ecosystem.css` — editor workflow: `min-height: 0` e scroll em `.wf-config-panel`
  - `frontend/src/styles/viewport-scale.css` — `zoom` em vez de `transform` (scroll em filhos no Chrome)
- **Descrição**: Restaura rolagem vertical no histórico de mensagens dos tickets e nas telas de configuração (incl. editor de workflows).
- **Status**: Concluído

---

### GitHub Push — Gmail inbound, protocolo externo e workflows automáticos

- **Data/Hora**: 2026-07-17
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.33.0
  - index v1.9.5, emailBootstrap.service v1.0.0, gmailWatch.service v1.1.0
  - email-inbound.service v1.4.0, cliente.service v1.2.0, emailNotification.service v1.2.0, emailThread.service v1.1.0
  - chamadoProtocoloWatcher v1.0.0, workflowNotificacao.service v1.0.0, workflowSistemaExecutor v1.0.0
  - test-gmail-inbound.ts v1.0.0, test-gmail-watch.ts v1.0.0
- **Arquivos modificados / incluídos**:
  - **Gmail inbound**: bootstrap após `desk_config`, retry do watch, health preciso; ticket abre sem CPF; thread e-mail (root inbound + outbound); scripts `test:gmail-inbound` / `test:gmail-watch`
  - **Protocolo Tabajara**: watcher change stream + atribuição atômica para inserts externos no MongoDB
  - **Workflows**: passos automáticos/sistema, notificações internas, rotas e painel Desk; seeds e DTO sync
  - Frontend: Desk workflow panel, NotificationContext, WorkflowStepEditor, client profile bar
- **Descrição**: Habilita diálogo e-mail completo (inbound sem CPF obrigatório, respostas do cliente no ticket, agente responde pelo remetente gravado). Corrige race do watch Gmail no Cloud Run. Protocolo oficial atribuído pelo Desk em inserts diretos. Expande engine de workflow com execução automática e notificações.
- **Pré-requisito GCP**: delegação `gmail.readonly` na SA `email-service@velohub-471220.iam.gserviceaccount.com`
- **Validação pós-deploy**:
  ```powershell
  Invoke-RestMethod -Uri "https://velodesk-278491073220.us-east1.run.app/api/inbound/gmail/health" | ConvertTo-Json
  ```
  Esperado: `emailTransportReady: true`, `ready: true`, `historyId` preenchido
- **Status**: Concluído

---

## Alteração local — Protocolo atribuído pelo Desk em inserts externos

- **Data/Hora**: 2026-07-16
- **Tipo**: GitHub Push (incluído em 2026-07-17)
- **Versão (componentes)**:
  - DEPLOY_LOG v1.31.0
  - ChamadoN1 v1.5.1, protocoloUtils v1.0.0, chamadoProtocoloAssign v1.0.0, chamadoProtocoloWatcher v1.0.0
  - app-inbound.service v1.2.0, index v1.9.4
- **Arquivos modificados**:
  - `backend/src/models/ChamadoN1.ts` — `chamadoProtocolo` opcional no insert; índice sparse unique
  - `backend/src/services/protocoloUtils.ts` — detecta protocolo pendente vs numérico oficial
  - `backend/src/services/chamadoProtocoloAssign.service.ts` — atribuição atômica + reconcile
  - `backend/src/services/chamadoProtocoloWatcher.service.ts` — change stream em `chamados_n1`
  - `backend/src/services/app-inbound.service.ts` — ignora marcadores `__SIMULACAO_PENDENTE__`
  - `backend/src/index.ts` — inicia watcher após conexão MongoDB
- **Descrição**: Corrige interferência do Gerador Tabajara no número de protocolo. Inserts diretos no MongoDB (simulação) não recebem protocolo; o Desk detecta via change stream e atribui imediatamente via contador sequencial. Chamados legados com marcador pendente são reconciliados no startup.
- **Status**: Concluído (push 2026-07-17)

---

### GitHub Push — Remoção total do Kanban legado (Desk CRM / boxes)

- **Data/Hora**: 2026-07-15
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.30.0
  - ticketsStorage v1.0.0, ticketsCache v1.6.0, TicketsContext v1.4.0
  - TicketsPage v2.2.0, customQueueBoxes, ticketAdapter, boxes.routes
- **Arquivos modificados / incluídos**:
  - Removidos `kanbanStorage.js`, `KanbanBoard.jsx`
  - Novo `ticketsStorage.js` — facade tickets/boxes (`loadBoxesFromApi`, `updateTicketInCache`, etc.)
  - `TicketsPage` sempre abre Desk CRM (sem fallback kanban)
  - Renomeação em todo o frontend: sem referências a kanban
- **Descrição**: Purga definitiva do Kanban morto; Desk usa apenas cache/API de boxes e tickets.
- **Status**: Concluído

---

- **Data/Hora**: 2026-07-15
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.29.0
  - client.js v1.8.0, AuthContext v1.6.0, backendJwt v1.0.0
  - App.js v2.5.1, ticketsCache v1.5.2, DeskLoginPage v1.3.1
- **Arquivos modificados / incluídos**:
  - `frontend/src/api/client.js` — interceptor 401 limpa sessão e redireciona `/login?session=expired`
  - `frontend/src/utils/backendJwt.js` — validação local de exp/userId do JWT
  - `frontend/src/context/AuthContext.js` — não restaura sessão com token expirado
  - `frontend/src/app/App.js` — remove preload de boxes antes do login
- **Descrição**: Após queda da API, token antigo no localStorage causava 401 em boxes/workflows/tabulation/colaboradores. Agora força novo login Google.
- **Status**: Concluído

---

- **Data/Hora**: 2026-07-15
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.28.0
  - index.ts v1.9.3
- **Arquivos modificados / incluídos**:
  - `backend/src/index.ts` — import dinâmico de `mongodb-memory-server` só em dev (Docker prod faz `npm prune --omit=dev`)
- **Descrição**: Cloud Run logs: `Cannot find module 'mongodb-memory-server'` — Node não subia, nginx retornava 502 em todas as rotas `/api/*`. Corrigido com dynamic import condicional.
- **Status**: Concluído

---

- **Data/Hora**: 2026-07-15
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.27.0
  - env.ts v1.18.0, database.ts v1.8.2, index.ts v1.9.2
  - colaboradores.routes v1.0.1, colaboradoresCadastro.service v1.0.1
  - loadFonteVelodeskEnv.cjs v2.2.2, start-velodesk.sh v1.0.4
- **Arquivos modificados / incluídos**:
  - `backend/src/config/env.ts` — `getMongoHubCentralUri()` lê só `MONGO_ENV` em runtime (sem fallback para URI do Desk)
  - `backend/src/config/database.ts` — conexão `console_funcionarios` via MONGO_ENV; guard contra URI igual ao cluster Desk; `tryConnectFuncionarios()`
  - `backend/src/routes/colaboradores.routes.ts` — retry de conexão antes de 503 (evita 502 por crash)
  - `backend/src/index.ts` — health `mongoEnvConfigured`; reconexão MONGO_ENV a cada 15s; log startup
  - `docker/start-velodesk.sh` — repassa `MONGO_ENV` ao Node; aviso se ausente
  - `backend/.env.example` — documentação MONGO_ENV
- **Descrição**: Corrige 502 em `/api/colaboradores` em produção — colaboradores Desk usam cluster VeloHubCentral (`MONGO_ENV`), separado de `MONGO_URI` (desk_dev). Requer secret `MONGO_ENV` no Cloud Run além de `MONGO_URI`.
- **Status**: Concluído

---

### GitHub Push — Workflows persistidos, colaboradores Desk, VeloNews e merges dev

- **Data/Hora**: 2026-07-15
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.26.0
  - WorkflowDefinicao v1.2.0, workflowEngine v1.5.1, workflowConfigData v2.5.2
  - colaboradores.routes v1.0.0, database v1.8.0, blockNoticiarioRoutes v1.0.3
  - veloNewsApi v1.0.5, velohubApiConfig v1.3.3, useDeskColaboradores v1.0.0
  - WorkflowConfigEditor v2.5.1, WorkflowConfigStepsTimeline v2.1.2
- **Arquivos modificados / incluídos**:
  - `backend/` — API `/api/workflows`, `/api/grupos-responsabilidade`, `/api/colaboradores` (leitura `console_funcionarios` VeloHubCentral); models e seeds; bloqueio rotas noticiário; `gatilho` sem `descricao`
  - `frontend/` — Config workflows/grupos/lista agentes; runtime `workflowEngine`; VeloNews só via `/velohub-api`; auditoria IA com `tabulacaoFonte`; CSS etapas workflow
  - Merge remoto: Painel 360 status serviços, workflow Produtos, monorepo `npm start`
- **Descrição**: Consolida workflows persistidos no MongoDB com editor Config completo, colaboradores Desk via cadastro VeloHubCentral, isolamento VeloNews na API VeloHub e integração dos merges remotos (360, Produtos, CSS cockpit).
- **Status**: Concluído

---

### GitHub Push — Agentes paralelos, correções pós-merge Desk/Painel 360 e workflow config

- **Data/Hora**: 2026-07-14
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.25.0
  - agentes v1.0.0, workspace360 hook v1.0.1, viewport-scale v1.0.5
  - velodesk-crm v1.7.1, DeskRightPanel v1.4.1, GestaoPanel v3.2.1, AgentPanel v3.0.1
  - workflowTestSeed v1.0.1, ticketAdapter v1.4.5, desk/utils v3.0.1
- **Arquivos modificados / incluídos**:
  - `backend/src/services/agents/` — orquestrador Atendimento, Auditoria e Gestão; feedback e autonomia
  - `backend/src/routes/agents.routes.ts`, `backend/src/jobs/gestaoChamados.job.ts`
  - `backend/src/models/AgentFeedback.ts`, `AgentAutonomyRule.ts`, `AgentGestaoAlert.ts`, `AgentGestaoSnapshot.ts`
  - `backend/src/config/env.ts`, `agentAutonomyRules.default.json`, `docs/AGENTES-PARALELOS.md`
  - `backend/src/services/workflowTestSeed.service.ts` — corrige UTF-8 mojibake e upsert dos tickets WF-TEST
  - `frontend/src/hooks/useTicketAiSuggestions.js` — pipeline agentes (auditScore, revisão)
  - `frontend/src/features/desk/` — layout compacto notebook, responsável por sessão, modal revisão IA
  - `frontend/velodesk-crm.css`, `frontend/src/styles/viewport-scale.css` — escala ~75% e colunas estreitas
  - `frontend/src/features/workspace/GestaoPanel.jsx`, `AgentPanel.jsx` — restaura `useWorkspace360` + API
  - `frontend/src/api/adapters/ticketAdapter.js`, `desk/utils.js` — `repairUtf8Mojibake`
  - `frontend/src/features/config/workflow/` — editor/lista de workflows na config
- **Descrição**: Entrega do programa de agentes paralelos IA e correções do merge que revertia layout Desk, Painel 360 (dados mock), campo Responsável manual e textos corrompidos nos seeds de workflow.
- **Status**: Concluído

---

### GitHub Push — Cadastro cliente no header, outbound Gmail (formatação e thread)

- **Data/Hora**: 2026-07-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.23.0
  - chamado.mapper v1.8.6, cliente.service v1.1.1, clients.routes v1.0.5
  - emailNotification.service v1.1.0, emailHtml.util v1.0.0, emailThread.service v1.0.0
  - email-outbound.service v1.2.0, gmailApiSend v1.1.0, email-inbound.service v1.2.1
  - tickets.routes, test-email-send.ts, test-gmail-modules v1.1.0
  - clienteAdapter v1.0.5, ticketAdapter v1.4.4, client.js v1.6.1, DeskV2Root v3.7.6
- **Arquivos modificados / incluídos**:
  - `backend/src/services/chamado.mapper.ts` — expõe `clienteId` no ticket e `lateralForm`
  - `backend/src/services/cliente.service.ts`, `clients.routes.ts` — upsert por clienteId; GET por e-mail
  - `backend/src/services/emailNotification.service.ts` — HTML rico no e-mail; thread Gmail (Message-ID, In-Reply-To, References)
  - `backend/src/services/emailHtml.util.ts`, `emailThread.service.ts` — sanitização compose e metadados de thread em `registro.metadados`
  - `backend/src/services/gmail/gmailApiSend.ts`, `email-outbound.service.ts` — headers RFC no envio
  - `backend/scripts/test-email-send.ts` — script de teste de envio Gmail
  - `frontend/src/api/adapters/clienteAdapter.js` — persistência de contato com fallback por e-mail
  - `frontend/src/api/adapters/ticketAdapter.js`, `client.js` — preserva `clienteId`; `getByEmail`/`getById`
  - `.gitignore` — `backend/secrets/`
- **Descrição**: Corrige edição de cadastro do cliente no cabeçalho do ticket. Outbound Gmail operacional com formatação (negrito/itálico), assunto padronizado e encadeamento de thread. Inbound Gmail (Pub/Sub) permanece pendente de `GMAIL_INBOUND_ENABLED` e URL pública.
- **Status**: Concluído

### GitHub Push — Sugestão IA (nome cliente), envio por perfil e liberação ao usar sugestão

- **Data/Hora**: 2026-07-10
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Branch**: dev
- **Versão (componentes)**:
  - DEPLOY_LOG v1.22.0
  - openaiTicketSuggest.service v1.0.4, ticketSuggestPersona v1.1.1, clientResponseFormatPersona v1.0.1, ticketAi.routes v1.0.1, index (backend)
  - useTicketAiSuggestions v1.1.1, composeRichEditor v1.0.1, constants v2.2.0, desk/utils, ticketsCache
  - DeskV2Root v3.7.5, DeskComposePanel v1.12.4, DeskConversation, DeskWhatsAppChat, client.js
  - velodesk-crm.css v1.6.2
- **Arquivos modificados / incluídos**:
  - `backend/src/services/openaiTicketSuggest.service.ts` — primeiro nome do cliente no bloco do prompt; `nomeOperador`; diagnóstico de config OpenAI
  - `backend/src/services/clientResponseFormatPersona.ts`, `ticketSuggestPersona.ts` — saudação obrigatória com nome do cliente
  - `backend/src/routes/ticketAi.routes.ts`, `backend/src/index.ts` — GET `/api/ticket-ai/status`; resposta 503 com `missing`
  - `frontend/src/hooks/useTicketAiSuggestions.js` — resolve nome do cliente; logs de diagnóstico; envia `nomeOperador`
  - `frontend/src/features/desk/DeskV2Root.jsx` — usar sugestão IA libera envio (`iaSuggestionApproved`); normalização plain/HTML; status Cancelado só supervisor
  - `frontend/src/features/desk/components/DeskComposePanel.jsx` — opções de envio por perfil; labels só com status
  - `frontend/src/services/desk/constants.js` — `getSendStatusOptions(agent|supervisor)`; Cancelado exclusivo supervisor
  - `frontend/src/services/desk/utils.js` — `applySendStatus` para cancelado
  - `frontend/velodesk-crm.css` — estilo opção Cancelado no dropdown de envio
- **Descrição**: Prompt da sugestão IA passa a incluir nome do cliente na saudação. Clicar em "Usar resposta" equivale à Revisão de texto e libera o envio. Botão Enviar exibe apenas o status (sem "Enviar como:"). Agentes veem Em andamento/Pendente/Resolvido; supervisores também Cancelado.
- **Status**: Concluído

### GitHub Push — Sugestão IA de resposta e tabulação na abertura do ticket (OpenAI + POPs)

- **Data/Hora**: 2026-07-03
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.21.0
  - openaiTicketSuggest.service v1.0.1, ticketSuggestPersona v1.0.0, ticketAi.routes v1.0.0
  - env v1.12.1, index v1.6.0
  - useTicketAiSuggestions v1.0.1, client.js v1.5.0, TabulationContext v1.1.1
  - DeskV2Root v3.6.0, DeskConversation v1.3.0, DeskWhatsAppChat v1.2.0, DeskRightPanel v1.4.0
- **Arquivos modificados / incluídos**:
  - `backend/package.json`, `backend/package-lock.json` — dependência `openai`
  - `backend/src/config/env.ts`, `backend/.env.example` — OPENAI_API_KEY, OPENAI_VECTOR_STORE_ID, VECTOR_STORE_PATH (alias)
  - `backend/src/services/openaiTicketSuggest.service.ts` — Responses API + file_search na vector store de POPs; fetch nativo (Windows)
  - `backend/src/services/ticketSuggestPersona.ts` — persona sugestão resposta + tabulação
  - `backend/src/routes/ticketAi.routes.ts` — POST `/api/ticket-ai/suggest`
  - `backend/src/index.ts` — rota ticket-ai e log de startup
  - `frontend/src/hooks/useTicketAiSuggestions.js` — gatilho por canal (mensagem pública vs anotação interna telefone)
  - `frontend/src/features/desk/DeskV2Root.jsx` — integração hook; aplicar tabulação da IA
  - `frontend/src/features/desk/components/DeskConversation.jsx`, `DeskWhatsAppChat.jsx`, `DeskRightPanel.jsx` — UI sugestão IA operacional
  - `frontend/src/context/TabulationContext.jsx` — retry em 503 transitório (desk_config)
  - `frontend/src/api/client.js` — ticketAiApi
  - `frontend/src/features/desk/components/ClientThermoGauge.jsx`, `DeskClientProfileBar.jsx`, `DeskComposePanel.jsx`, `frontend/velodesk-crm.css` — termômetro cliente e estilos alinhados
- **Descrição**: v1 operacional da sugestão IA na abertura do ticket: e-mail/app usam 1ª mensagem pública; telefone usa anotação interna (≥80 chars) + hint de produto. Backend consulta vector store OpenAI com POPs Velotax e valida tabulação contra config ativa. Corrige Premature close do SDK OpenAI no Windows via fetch nativo.
- **Status**: Concluído

### GitHub Push — Notas do Desk, fila Novos e fix tabulação Tipo

- **Data/Hora**: 2026-07-03
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.20.0
  - chamado.mapper v1.8.5, boxes.routes v1.3.8
  - responsavelSegmentation v1.2.0, ticketsCache v1.5.1
  - tabulationConfig v1.3.1, ticketAdapter v1.4.2
  - desk/utils v2.9.1, DeskInternalNotesPanel v1.4.0, DeskRightPanel v1.3.2, DeskV2Root v3.5.9
- **Arquivos modificados / incluídos**:
  - `backend/src/services/chamado.mapper.ts` — tickets Novos sem responsável visíveis na fila do agente
  - `backend/src/routes/boxes.routes.ts` — versão alinhada ao filtro Novos
  - `frontend/src/services/desk/responsavelSegmentation.js` — Novos sem responsável = fila compartilhada
  - `frontend/src/services/tabulationConfig.js` — default Tipo Solicitação; mergeRightFieldsWithDefaults
  - `frontend/src/features/desk/DeskV2Root.jsx` — validação/envio com tipoChamado explícito
  - `frontend/src/api/adapters/ticketAdapter.js` — tipoChamado no payload lateralForm
  - `frontend/src/services/desk/utils.js` — aba Notas: supervisor (diff tabulação, status, internas); agente (só internas); ordem cronológica
  - `frontend/src/features/desk/components/DeskInternalNotesPanel.jsx` — UI diff alterações e status
  - `frontend/src/features/desk/components/DeskRightPanel.jsx` — select Tipo com default
  - `frontend/src/services/ticketsCache.js` — versão alinhada
- **Descrição**: Corrige fila Novos vazia para agentes (tickets sem responsável). Corrige erro "Preencha Tipo" ao salvar Em andamento. Aba Notas exibe só conteúdo relevante por perfil (sem mensagens públicas), com diff de tabulação/status e ordem do mais antigo ao mais recente.
- **Status**: Concluído

### GitHub Push — Fila meus-chamados, autor do registro e landing Painel 360°

- **Data/Hora**: 2026-07-02
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.19.0
  - boxes.routes v1.3.7, tickets.routes v1.3.7, chamado.mapper v1.8.4, ChamadoN1 v1.4.0
  - responsavelSegmentation v1.1.0, ticketsCache v1.5.0, ticketAdapter v1.4.1
  - desk/utils v2.8.2, TicketsContext v1.3.0, ProfileContext v1.4.0, profiles v1.3.0
  - DeskInternalNotesPanel v1.3.4, App v2.4.0, DefaultLandingRedirect v1.0.0
- **Arquivos modificados / incluídos**:
  - `backend/src/routes/boxes.routes.ts` — agente sempre recebe fila `meus-chamados` (filtro por tabulacao.responsavel)
  - `backend/src/services/chamado.mapper.ts` — campo `autor` no registro; executor ≠ responsavel; alteracoes[] só diff de tabulação
  - `backend/src/models/ChamadoN1.ts` — schema `registro.autor`
  - `backend/src/routes/tickets.routes.ts` — persiste autor da sessão em mensagens e updates
  - `backend/src/services/email-inbound.service.ts` — autor cliente em registro inbound
  - `frontend/src/services/desk/responsavelSegmentation.js` — segmentação meus-chamados por papel da sessão
  - `frontend/src/services/ticketsCache.js` — `fila=meus-chamados` + filtro defensivo client-side
  - `frontend/src/api/adapters/ticketAdapter.js` — adaptação colunas meus-chamados; `author` em updates
  - `frontend/src/services/desk/utils.js` — feed de notas/registro com "Realizado por" correto
  - `frontend/src/features/desk/components/DeskInternalNotesPanel.jsx` — visão supervisor com ocorrências de registro
  - `frontend/src/routes/DefaultLandingRedirect.jsx` — landing por perfil (Painel 360°)
  - `frontend/src/app/App.js`, `ProfileContext.js`, auth pages — redirect pós-login para workspace
  - `frontend/velodesk-crm.css`, `velodesk-dark-theme.css` — estilos painel notas/registro
- **Descrição**: Agentes veem apenas tickets em que são responsáveis; supervisor vê fila completa. Registro grava `origin` (cliente/agente) e `autor` (quem executou a ação). Notas internas e alterações de tabulação exibem executor real, não o responsável do chamado. Landing padrão passa a ser Painel 360°.
- **Status**: Concluído

### GitHub Push — Compose WYSIWYG e toolbar de formatação com estado ativo

- **Data/Hora**: 2026-07-02
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.18.0
  - ComposeRichEditor v1.0.2, composeRichEditor v1.0.1, ComposeFormatToolbar v1.0.3
  - DeskComposePanel v1.9.1, DeskConversation v1.2.0, DeskV2Root v3.5.8
  - useComposeSpellCheck v2.0.1, composeFormatPreview v1.0.0
- **Arquivos modificados / incluídos**:
  - `frontend/src/features/desk/components/ComposeRichEditor.jsx` — editor contenteditable WYSIWYG (sem tags visíveis na seleção)
  - `frontend/src/services/desk/composeRichEditor.js` — sanitização HTML, execCommand, readComposeFormatState
  - `frontend/src/features/desk/components/ComposeFormatToolbar.jsx` — botões destacam formatação ativa (queryCommandState)
  - `frontend/src/features/desk/components/DeskComposePanel.jsx` — compose público e anotação interna migrados para rich editor
  - `frontend/src/hooks/useComposeSpellCheck.js` — onReplaceRange preserva formatação ao corrigir ortografia
  - `frontend/src/features/desk/DeskV2Root.jsx` — gate ortográfico em texto plano; envio preserva HTML
  - `frontend/src/features/desk/components/DeskConversation.jsx` — renderização segura de HTML nas mensagens
  - `frontend/velodesk-crm.css`, `velodesk-dark-theme.css` — estilos editor rich e toolbar ativa
- **Descrição**: Substitui textarea+mirror por editor WYSIWYG; negrito/itálico/sublinhado/listas aplicam formatação visual; toolbar indica estado ativo; corretor ortográfico opera em texto plano sem destruir markup.
- **Status**: Concluído

### GitHub Push — Protocolo sequencial, Assistente IA Gemini e painel cliente

- **Data/Hora**: 2026-07-02
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.17.0
  - protocolo.service v1.0.2, geminiRefinar.service v1.0.2, compose.routes v1.0.1
  - DeskClientProfileBar v1.3.1, ComposeRefinarModal v1.0.2, DeskV2Root v3.5.7
  - clienteAdapter v1.0.4, ticketAdapter v1.3.2, env.ts v1.11.0
- **Arquivos modificados / incluídos**:
  - `backend/src/services/protocolo.service.ts` — contador atômico; exibição `0100177678` … `0999999999` → `1000000000+`
  - `backend/src/services/geminiRefinar.service.ts`, `compose.routes.ts`, `refinarRascunhoPersona.ts` — Assistente IA refinar rascunho (Gemini)
  - `backend/src/services/chamado.mapper.ts`, `email-inbound.service.ts` — protocolo numérico e regex e-mail
  - `frontend/src/features/desk/components/DeskClientProfileBar.jsx` — layout protocolo + linha cliente; persistência cadastro
  - `frontend/src/features/desk/components/ComposeRefinarModal.jsx`, `ComposeFormatToolbar.jsx` — IA com cancelamento; formatação compose
  - `frontend/src/api/adapters/clienteAdapter.js`, `client.js` — `PUT /clients/:id`, `persistClienteContact`
  - `frontend/velodesk-crm.css`, `velodesk-dark-theme.css` — estilos painel cliente e modais
- **Descrição**: Numeração de tickets continua CRM legado (floor 100177678) com zero à esquerda; painel superior redesenhado; edição de contato persiste em `b2c_cadastros.clientes`; Assistente IA Gemini no compose com fallback de modelo e cancelamento.
- **Status**: Concluído

### GitHub Push — Corretor LanguageTool self-hosted no compose

- **Data/Hora**: 2026-07-01
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.16.0
  - languagetool.service v1.0.2, spellcheckSuggestionRank v1.0.0
  - spellEngine v2.0.0, languageToolEngine v1.0.0, useComposeSpellCheck v2.0.0
  - docker-compose v1.1.0, index.ts v1.5.0, env.ts v1.10.0
- **Arquivos modificados / incluídos**:
  - `docker-compose.yml` — serviço `languagetool` (erikvl87/languagetool)
  - `backend/src/services/languagetool.service.ts` — proxy `/v2/check` pt-BR, filtro STYLE/CASING
  - `backend/src/services/spellcheckSuggestionRank.ts` — ranking atendimento (ex.: criente → cliente)
  - `backend/src/routes/spellcheck.routes.ts` — `GET /status`, `POST /check` (JWT)
  - `frontend/src/services/spellcheck/languageToolEngine.js` — adapter via API backend
  - `frontend/src/hooks/useComposeSpellCheck.js` — debounce, abort, modo degradado
  - Removido `dictionary-pt-br` do bundle frontend
- **Descrição**: Substitui Hunspell local por LanguageTool open source self-hosted; bloqueio de envio só com erros reais; fallback se LT offline; sugestões priorizadas para vocabulário de atendimento.
- **Status**: Concluído

### GCP Cloud Run — MONGODB_URI voltou para velodesk-dev (MONGO_URI)

- **Data/Hora**: 2026-06-30
- **Tipo**: GCP Cloud Run (gcloud)
- **Projeto**: velohub-471220
- **Serviço**: velodesk (us-east1)
- **Revisões**: velodesk-00018-sg2 → velodesk-00019-tzq
- **Alterações**:
  - `MONGODB_URI` ← secret **`MONGO_URI`** (cluster **velodesk-dev** — dados Desk)
  - Removido secret **`MONGO_ENV`** do container (VelohubCentral reservado ao VeloNews via `VITE_VELOHUB_API_URL`)
- **Resultado**: `/health` → `status: ok`, `cadastrosConnected: true`, `deskConfigConnected: true`, cluster `appName=velodesk-dev`
- **Status**: Concluído

### GitHub Push — Fix 502: API não morre se desk_config cair

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.14.0
  - database.ts v1.7.0, index.ts v1.4.1
  - tabulation.routes v1.2.1, boxes.routes v1.3.6
  - start-velodesk.sh v1.0.3
- **Arquivos modificados / incluídos**:
  - `backend/src/config/database.ts` — reconexão cadastros/desk_config; `isAllMongoReady()`
  - `backend/src/index.ts` — monitor Mongo 15s; uncaughtException/unhandledRejection não derrubam processo
  - `backend/src/routes/tabulation.routes.ts` — 503 em vez de crash se desk_config indisponível
  - `backend/src/routes/boxes.routes.ts` — 503 se Mongo principal indisponível
  - `docker/start-velodesk.sh` — loop auto-restart do Node se encerrar
- **Descrição**: Corrige 502 em `/api/boxes`, `/api/tabulation`, `/api/clients` quando conexão desk_config falha e derruba o Node; nginx passa a receber 503/500 em vez de connection refused.
- **Status**: Concluído

### GitHub Push — Proxy VeloHub /velohub-api + responsável com usuários logados

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.13.0
  - nginx-cloudrun v1.0.2, start-velodesk.sh v1.0.2, velohubApiConfig v1.3.0
  - useDeskAgents v1.0.0, DeskRightPanel v1.3.0, chamado.mapper v1.2.4
- **Arquivos modificados / incluídos**:
  - `docker/nginx-cloudrun.conf.template` — proxy `/velohub-api/` → VeloHub (CORS VeloNews)
  - `frontend/src/config/velohubApiConfig.js` — sempre usa proxy same-origin
  - `frontend/src/hooks/useDeskAgents.js` — lista agentes via `/api/users`
  - `frontend/src/features/desk/components/DeskRightPanel.jsx` — select Responsável + auto-atribuição
  - `backend/src/services/chamado.mapper.ts` — fila Meus Chamados reconhece prefixo do e-mail
- **Descrição**: VeloNews sem CORS em produção GCP; atribuições usam usuários Google registrados no Mongo.
- **Status**: Concluído

### GCP Cloud Run — MONGODB_URI apontado para secret MONGO_ENV (VelohubCentral)

- **Data/Hora**: 2026-06-30
- **Tipo**: GCP Cloud Run (gcloud)
- **Projeto**: velohub-471220
- **Serviço**: velodesk (us-east1)
- **Revisão**: velodesk-00013-zrf
- **Alteração**: `MONGODB_URI` ← secret `MONGO_ENV` (substitui `MONGO_URI` / cluster velodesk-dev bloqueado por IP no Atlas)
- **Resultado**: `/health` → `status: ok`, `mongo: true`
- **Status**: Concluído

### GitHub Push — Fix URI Atlas com /dbname + tabulação só após login

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.11.0
  - resolveAtlasUri v1.0.1, env.ts v1.9.1, index.ts v1.3.1
  - TabulationContext v1.1.0
- **Arquivos modificados / incluídos**:
  - `backend/src/config/resolveAtlasUri.ts` — parser `mongodb+srv://.../dbname?...` (formato Atlas)
  - `backend/src/config/env.ts` — trim de secrets (newline/aspas)
  - `backend/src/index.ts` — helmet sem COOP (Google postMessage)
  - `frontend/src/context/TabulationContext.jsx` — não chama `/api/tabulation` na tela de login
- **Descrição**: Corrige 503 no login Google quando `MONGODB_URI` Atlas inclui nome do banco no path; elimina 401 de tabulação antes de autenticar.
- **Status**: Concluído

### GitHub Push — Login limpo: remove recados e erro Mongo na tela

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.10.0
  - DeskLoginPage v1.1.0, desk-login.css v1.0.1
- **Arquivos modificados / incluídos**:
  - `frontend/src/features/auth/DeskLoginPage.jsx` — só marca Velodesk + botão Google; sem textos de fase de testes/VeloHub; 503 Mongo não exibe alerta na UI
  - `frontend/src/features/auth/desk-login.css` — estilos dos blocos removidos
- **Descrição**: Tela de login enxuta; erros técnicos de banco ficam só no backend/logs.
- **Status**: Concluído

### GitHub Push — Retry MongoDB + diagnóstico health + helmet Google OAuth

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.9.0
  - index.ts v1.3.0, start-velodesk.sh v1.0.1
- **Arquivos modificados / incluídos**:
  - `backend/src/index.ts` — retry Mongo a cada 30s em produção; `/health` expõe `mongoUriConfigured`; helmet `same-origin-allow-popups` (Google OAuth)
  - `docker/start-velodesk.sh` — log de aviso se `MONGODB_URI` / `GOOGLE_CLIENT_ID` ausentes no Cloud Run
- **Descrição**: Melhorias operacionais; login Google 503 exige `MONGODB_URI` configurada no serviço Cloud Run `velodesk` + Atlas Network Access.
- **Status**: Concluído

### GitHub Push — Container Cloud Run combinado (web + API)

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.8.0
  - Dockerfile (raiz) v2.0.0, start-velodesk.sh v1.0.0
  - runtimeEnv v1.0.0, googleAuthConfig v1.2.0, velohubApiConfig v1.2.0
- **Arquivos modificados / incluídos**:
  - `Dockerfile` — build web (Vite) + API (Node) no mesmo container; nginx :8080 + API :8081
  - `docker/start-velodesk.sh`, `docker/nginx-cloudrun.conf.template`
  - `frontend/` — `env-config.js` runtime (Cloud Run env); configs leem `window.__VELODESK_ENV__`
  - `README.md` — produção GCP Cloud Run (não Vercel)
- **Descrição**: Serviço `velodesk` passa a servir o Desk (SPA) na URL pública; `/api` proxied para Node interno. Corrige 404/Cannot GET `/` ao abrir a URL do Cloud Run.
- **Status**: Concluído

### GitHub Push — Startup Cloud Run: escuta PORT antes do MongoDB

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.7.0
  - index.ts v1.2.0, env.ts v1.9.0, database.ts v1.6.1
- **Arquivos modificados / incluídos**:
  - `backend/src/index.ts` — `app.listen` em `0.0.0.0:PORT` antes de conectar Atlas; produção não encerra se Mongo falhar (modo degradado)
  - `backend/src/config/env.ts` — produção tolera `MONGODB_URI` ausente no boot (log + degradado)
  - `backend/src/config/database.ts` — guard contra URI vazia
  - `README.md` — variáveis obrigatórias no serviço Cloud Run `velodesk`
- **Descrição**: Corrige deploy Cloud Run (`container failed to start and listen on PORT=8080`). O backend só abria a porta após MongoDB; falha de conexão ou env ausente matava o container antes do health check.
- **Status**: Concluído

### GitHub Push — Dockerfile na raiz para trigger Cloud Build GCP

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.6.0
  - Dockerfile (raiz) v1.0.1
  - cloudbuild.yaml v1.1.0
- **Arquivos modificados / incluídos**:
  - `Dockerfile` — build da API (`velodesk-api`) a partir da raiz do monorepo (contexto `backend/`)
  - `cloudbuild.yaml` — comentários sobre trigger GitHub vs build web+api
  - `README.md` — documentação do trigger na raiz
- **Descrição**: Corrige falha do Cloud Build (`lstat /workspace/Dockerfile: no such file or directory`). O trigger GCP esperava Dockerfile na raiz; o repositório só tinha `backend/Dockerfile` e `frontend/Dockerfile`.
- **Status**: Concluído

### GitHub Push — Login Google SSO, allowlist de acesso e logout

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.5.0
  - AuthContext v1.5.0, DeskLoginPage v1.0.1, auth.routes v1.1.0
  - loadFonteVelodeskEnv backend v2.1.0, vite.config v1.3.0
  - Sidebar v1.10.0, ProfileContext v1.3.0
- **Arquivos modificados / incluídos**:
  - `frontend/` — login Google (fase testes); allowlist agente/supervisor; perfil travado; logout na sidebar; hero com prefixo do e-mail; remoção do bypass admin local; injeção `VITE_GOOGLE_CLIENT_ID` via vite.config
  - `backend/` — `POST /api/auth/google`; validação token Google; allowlist server-side; loader env lê `FONTE DA VERDADE/.env-velodesk` + `backend/.env`
- **Descrição**: Controle de acessos por e-mail @velotax.com.br na fase de testes, mantendo gate VeloHub preparado para fase posterior. Backend e frontend alinhados ao `.env-velodesk` para `GOOGLE_CLIENT_ID`.
- **Status**: Concluído

### GitHub Push — VeloNews VeloHub na sidebar, proxy CORS e ajustes Desk v2

- **Data/Hora**: 2026-06-30
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - DEPLOY_LOG v1.4.0
  - VeloNewsProvider v1.0.1, veloNewsApi v1.0.1, velohubApiConfig v1.1.0
  - Sidebar v1.9.1, vite.config v1.2.0
  - tickets.routes v1.3.3, chamado.mapper v1.2.3, tabulation.service v1.2.2
- **Arquivos modificados / incluídos**:
  - `frontend/` — sininho VeloNews no rodapé da sidebar; feed real via API VeloHub (`veloNewsApi`, `VeloNewsProvider`, modais/popover/histórico); proxy Vite `/velohub-api` (CORS dev :8000); remoção de noticiário demo do Painel 360; CSS `velonews.css`; fix `contains` na sidebar
  - `backend/` — PUT ticket respeita status explícito (“Enviar como”); tabulação e mapper sem registro duplicado de status
  - `frontend/.env.example` — documentação `VITE_VELOHUB_API_URL`
- **Descrição**: Push integrando VeloNews do VeloHub (Cloud Run) no Desk, acessível em qualquer aba pela sidebar, com proxy local para evitar bloqueio CORS. Remove origem demo local. Corrige envio de status de ticket e componentes de tabulação/config.
- **Status**: Concluído

### GitHub Push — Desk v2: inbound e-mail, Docker/GCP, tabulação e auth VeloHub

- **Data/Hora**: 2026-06-29
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - root package.json v2.2.1
  - frontend package.json v2.1.1
  - backend package.json (inbound + tabulação)
  - docker-compose.yml v1.0.0
  - cloudbuild.yaml v1.0.0
  - DEPLOY_LOG v1.3.0
  - README (Docker/GCP/inbound)
- **Arquivos modificados / incluídos**:
  - `backend/` — inbound e-mail (webhook Mailgun/generic), modelo Cliente, tabulação de produtos, resolução MongoDB Atlas, middleware supervisor/inboundAuth, scripts de migração/purge demo
  - `frontend/` — auth via sessão VeloHub (loading gate), tabulação na config, spell-check no compose, cadastro de cliente, integração velohubApi, remoção LoginPage/seedDemo
  - `docker-compose.yml`, `cloudbuild.yaml`, Dockerfiles e `.dockerignore` (web + api)
  - `docs/PLANO-ENTRADA-TICKETS.md`
  - `package.json`, `run-dev.ps1`, `stop-dev.ps1`, `scripts/free-port.cjs`
  - `README.md`, `DEPLOY_LOG.md`
- **Descrição**: Push consolidando Desk v2 com entrada de tickets por e-mail, stack containerizada (local/GCP Cloud Run), tabulação configurável, cadastro de clientes unificado e gate de acesso VeloHub. Monorepo orquestrado na raiz; demo seed removido do frontend.
- **Status**: Em andamento

### GitHub Push — Frontend Cockpit v2 + legado preservado

- **Data/Hora**: 2026-06-18
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - frontend package.json v2.1.0
  - App.js v2.1.0
  - DeskV2Root v2.2.0
  - CreateTicketWorkspace v2.2.0
  - client.js v1.0.0
  - ticketAdapter v1.0.0
  - ticketsCache v1.0.0
  - kanbanStorage v1.1.0
  - AuthContext v1.0.0
  - ChatView v2.1.0
  - DashboardView v2.1.0
  - TicketLateralForm v2.1.0
  - api-contract v1.1.0
  - README v2.1.0
  - DEPLOY_LOG v1.2.0
- **Arquivos modificados / incluídos**:
  - `frontend/` — Velodesk-cockpit ativo (Desk V2, auth JWT, API boxes/tickets/dashboard/whatsapp)
  - `frontend-legacy/` — React 19/MUI/TS anterior preservado como referência
  - `backend/` — API Express/MongoDB
  - `docs/api-contract.md`
  - `README.md`
  - `.gitignore`
  - `start-backend.ps1`, `start-frontend.ps1`
  - `DEPLOY_LOG.md`
- **Descrição**: Push do frontend Cockpit integrado ao backend. Legado movido para `frontend-legacy/`. Kanban/Desk CRM persistem via `/api/boxes` e `/api/tickets`. Rota padrão `/tickets?desk=v2`.
- **Status**: Em andamento

### Migração local — Frontend Cockpit substitui frontend ativo

- **Data/Hora**: 2026-06-18
- **Tipo**: Migração local (sem push)
- **Versão (componentes)**:
  - frontend package.json v2.1.0
  - App.js v2.1.0
  - index.js v2.1.0
  - client.js v1.0.0
  - ticketAdapter v1.0.0
  - ticketsCache v1.0.0
  - kanbanStorage v1.1.0
  - AuthContext v1.0.0
  - LoginPage v1.0.0
  - ProtectedRoute v1.0.0
  - TicketsContext v1.1.0
  - DeskV2Root v2.1.0
  - CreateTicketWorkspace v2.1.0
  - ChatView v2.1.0
  - DashboardView v2.1.0
  - TicketLateralForm v2.1.0
  - QuickRegisterModal v1.1.0
  - vite.config.js v1.0.0
  - api-contract v1.1.0
  - README v2.1.0
  - DEPLOY_LOG v1.1.0
- **Arquivos modificados / incluídos**:
  - `frontend/` — Velodesk-cockpit migrado com integração API (auth JWT, boxes, tickets, dashboard, whatsapp)
  - `frontend-legacy/` — front React 19/MUI/TS anterior preservado
  - `docs/api-contract.md` — endpoints obsoletos removidos da documentação
  - `README.md` — nova estrutura do repositório
  - `DEPLOY_LOG.md`
- **Descrição**: Substituição do frontend ativo pelo Velodesk-cockpit. Legado movido para `frontend-legacy/`. Removido auto-login lab; adicionados auth JWT, proxy Vite 8000→8001, camada `api/client.js` e adapter tickets. Kanban/Desk CRM passam a persistir via `/api/boxes` e `/api/tickets`. Seed demo apenas em DEV quando API vazia. WhatsApp via `/api/whatsapp/*` do backend velodesk.
- **Status**: ✅ Concluído (incluído no push 2026-06-18)

### GitHub Push — Velodesk React: repositório inicial + rascunho local de chamado

- **Data/Hora**: 2026-06-16
- **Tipo**: GitHub Push
- **Repositório**: https://github.com/admVeloHub/velodesk
- **Versão (componentes)**:
  - draftTicket v1.0.0
  - ConfirmDiscardDraftDialog v1.0.0
  - ticketUpdateMeta v1.0.0
  - TicketsPage v1.8.0
  - TicketDetail v1.2.0
  - MessageComposer v1.2.0
  - TicketsOpenTabs v1.5.2
  - LateralForm v1.2.1
  - ticketFormStyles v1.0.2
  - ticketStatuses v1.0.2
  - types v1.3.2
  - chamado.mapper v1.0.8
  - tickets.routes v1.2.0
  - auth.routes v1.0.3
  - boxes.routes v1.3.1
  - client.ts v1.0.4
  - globals.css v1.8.5
  - DEPLOY_LOG v1.0.0
- **Arquivos modificados / incluídos**:
  - `frontend/` — portal React/MUI (tickets, kanban, composer, lateral)
  - `backend/` — API Express/MongoDB (`chamados_n1`, auth, boxes, uploads)
  - `docs/api-contract.md`
  - `README.md`
  - `.gitignore`
  - `DEPLOY_LOG.md`
- **Descrição**: Primeiro push do Velodesk React para o repositório `admVeloHub/velodesk`. Novo chamado passa a ser rascunho 100% local até Salvar/status (POST único em `chamados_n1`). Removidos endpoints de criação imediata `POST /api/register` e `POST /api/boxes`. Backend enriquece `POST /api/tickets` com protocolo informado, status inicial, mensagem/anexos e retorno 409 em protocolo duplicado.
- **Status**: ✅ Concluído com sucesso
