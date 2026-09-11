listagem de schema de coleções do mongoDB - ESPECIFICA DESK
  <!-- VERSION: v1.18.0 | DATE: 2026-09-11 | AUTHOR: VeloHub Development Team -->
  <!-- v1.18.0: auditoria de collections (11/09) — chamados_n1 ganha emailDeliveryFailures
       (indicador de falha de entrega/bounce direto no ticket, substitui a tela separada
       "Falhas de entrega" e a collection desk_config.email_bounce_log, descontinuada);
       desk_config.grupos_responsabilidade REMOVIDA de vez (era má compreensão de atribuição
       de workflow por função — ver nota no bloco abaixo); desk_config.desk_agentes REMOVIDA
       de vez (fallback de função obsoleto = brecha de segurança; permissão agora é
       fail-closed via console_funcionarios, sem espelho local); b2c_chamados.users perdeu o
       campo role (nunca mais persistido — sempre derivado do cadastro oficial).
  v1.17.0: reclamacoes_reclameAqui ganha schema próprio (ReclamacaoReclameAqui.schema.ts),
       campos de primeira classe + fusao (mecanismo cross-collection, referência p/ Procon/Bacen/CG);
       reclame_aqui_hugme_registros descontinuada (upsert direto em reclamacoes_reclameAqui). -->

  Repositório: https://github.com/admVeloHub/velodesk
  Backend: desk/backend — Express + Mongoose

  🗄️ Databases:
    b2c_chamados       — chamados_n1, boxes, telephony_calls, ai_usage_logs, chamado_ia_analise (MONGODB_DB_NAME)
    b2c_cadastros      — clientes (MONGODB_CADASTROS_DB_NAME)
    desk_config        — desk_funcoes_permissoes, tabulacao_campos, tabulacao_opcoes, grupos_responsabilidade,
                         workflow_definicoes, workflow_notificacoes, email_transport, gmail_watch_state
                         (MONGODB_DESK_CONFIG_DB_NAME)
    chamados_reclamacoes — reclamacoes_reclameAqui, reclamacoes_procon, reclamacoes_bacen, reclamacoes_consumidorGov,
                           reclame_aqui_hugme_registros, reclame_aqui_hugme_import_batches (MONGODB_RECLAMACOES_DB_NAME)
                           — módulo Casos Especiais; conexão dedicada (getReclamacoesConnection, database.ts v1.9.0)

  Coleções desk_config eliminadas: perfis_acesso, permissoes (2026-07-20).
  CORREÇÃO 2026-08-17: desk_funcoes_permissoes NÃO foi eliminada (nota anterior estava errada —
  drift de doc, nunca refletiu o código) — segue ativa via model DeskFuncaoPermissao, ver schema
  completo abaixo. workflow_notificacoes também NÃO foi eliminada — backing store do sininho.
  desk/docs/ACCESS_CAPABILITIES.md não existe no repo — referência removida (schema canônico = este arquivo).
  CORREÇÃO 2026-09-11: desk_agentes NÃO tinha sido eliminada em 2026-07-20 (nota antiga também
  estava errada) — seguiu ativa como espelho local de console_funcionarios até esta data, quando
  foi eliminada de fato (auditoria de collections): usada como fallback de função quando o
  colaborador não tinha atuacao no cadastro oficial, o que permitia função obsoleta sobreviver a
  desligamento/afastamento não sincronizado — brecha de segurança. Modelo/service/rota deletados;
  permission.service.ts::resolveUserFuncoes agora é fail-closed, 100% console_funcionarios, sem
  fallback. grupos_responsabilidade também eliminada nesta data — ver nota no lugar do schema.

  Sem coleções: tickets, forms, users (identidade via sessão VeloHub).

  ═══════════════════════════════════════════════════════════════════════════════
  🗄️ SCHEMAS — COLEÇÕES MONGODB
  ═══════════════════════════════════════════════════════════════════════════════

  //schema b2c_chamados.chamados_n1
  //Modelo: ChamadoN1 — backend/src/models/ChamadoN1.ts v1.6.0
  //DTO API (chamado.mapper): listagem enxuta (listOnly) inclui workflow.requisicao.valores quando existir;
  //detalhe completo (GET /api/tickets/:id) inclui requisicao com preenchidaEm/preenchidaPor/valores.
    {
    _id: ObjectId,
    chamadoProtocolo: String,       // Obrigatório — unique (ex.: VD-20260623-1234)
    chamadoTitulo: String,          // Default: ''
    cliente: [{                     // Subdocumento ClienteRef (_id: false)
      clienteCpf: String,           // Default: '' — chave de busca / denormalizada
      clienteId: ObjectId           // Default: null — → b2c_cadastros.clientes._id
    }],
    tabulacao: [{                   // Subdocumento Tabulacao (_id: false)
     responsavel: String,          // Default: '' — colaboradorNome (sessão VeloHub)
     atribuido: String             // Default: '' — colaboradorNome (sessão VeloHub)  
     tipoChamado: String,          // Default: ''
      produto: String,              // Default: ''
      motivo: String,               // Default: ''
      detalhe: String,              // Default: ''
    }],
    registro: Array[{                    // Linha do tempo — histórico/mensagens (append-only)
      0 => {                            // 1º evento cronológico do chamado
       data: Date,                      // Default: Date.now — instante deste evento
       origin: String,                  // Default: '' — 'agente' | 'cliente' (papel na interação)
       autor: String,                   // Default: '' — quem executou ESTE evento (nome/e-mail sessão VeloHub)
       mensagemPublica: String,        // Default: '' — texto visível ao cliente (aba Conversa)
       anexosMensagemPublica: String[], // Default: []
       anotacaoInterna: String,        // Default: '' — nota do agente (aba Notas)
       anexosAnotacaoInterna: String[], // Default: []
       alteracoes: Array[Mixed],       // Default: [] — campos alterados neste evento (valores novos)
                                       // Ex.: [{ produto: 'TV', motivo: 'Cobrança' }]
                                       // Não gravar autor aqui — usar registro[n].autor
       metadados: Mixed,                // Default: {} — metadados técnicos / audit trail
                                       // workflow: snapshot lateralForm.workflow (runtime)
                                       // requisicao: { valores, workflowId, campoIds[] } — audit ao iniciar workflow
                                       // emailOutboundMessageId, emailThreadRootId, workflowDecision, sistemaExec, …
       status: String                  // Default: 'novo' — status vigente após este evento
                                       // Valores: novo, em-aberto, em-andamento, em-espera, pendente, resolvido, cancelado
      },
      1 => {                            // 2º evento — mesma estrutura; sucede registro[0]
       data: Date,
       origin: String,
       autor: String,
       mensagemPublica: String,
       anexosMensagemPublica: String[],
       anotacaoInterna: String,
       anexosAnotacaoInterna: String[],
       alteracoes: Array[Mixed],       // ex.: [{ status: 'em-andamento' }]
       metadados: Mixed,
       status: String
      },
      n => {                            // Padrão idêntico para cada append (POST /messages, PUT status)
       data: Date,
       origin: String,
       autor: String,
       mensagemPublica: String,
       anexosMensagemPublica: String[],
       anotacaoInterna: String,
       anexosAnotacaoInterna: String[],
       alteracoes: Array[Mixed],
       metadados: Mixed,
       status: String
      }
    }],
    workflow: {                     // Runtime workflow top-level (_id: false)
      active: Boolean,              // Default: false
      workflowStatus: String,       // 'active' | 'finished' | 'cancel' | null — estado exclusivo do workflow
                                      // cancel: ticket foi a resolvido/cancelado/fechado com WF ainda aberto
      workflowId: ObjectId,         // → desk_config.workflow_definicoes._id
      step: Number,                 // Índice 0-based em passos[]
      passoId: ObjectId,            // → passos[n]._id
      startedAt: Date,
      completedAt: Date,
      pendingDecision: String,      // 'approve' | 'reject' | null — decisão pendente na etapa aprovação
      requisicao: {                 // Form complementar + thread Pedir informação
        preenchidaEm: Date,
        preenchidaPor: String,      // colaborador da sessão VeloHub
        valores: Mixed,             // Record<campoId, valor> — chaves = slug estável derivado do RÓTULO
                                      // normalizeFieldId(label): minúsculas, espaços→_, só [a-z0-9_]
                                      // Ex.: "Aba do problema" → aba_do_problema
                                      // Definição dos campos: workflow_definicoes.requisicao.campos[]
        comunicacaoWorkflow: Array[{ // Thread WF ↔ responsável do ticket (Pedir informação)
          0 => {
            mensagem: String,
            data: Date,
            autor: String           // "WF: Nome" | "Responsavel: Nome"
          },
          n => { /* mesma estrutura */ }
        }]
      }
    },
    emailDeliveryFailures: [{       // Default: [] — subdocumento (_id: false) — NOVO 2026-09-11
      em: Date,                     // Instante em que o bounce/DSN foi recebido
      destinatario: String,         // E-mail do cliente que não recebeu (resolvido do próprio ticket)
      assunto: String,              // Assunto do e-mail original que falhou
      messageId: String             // Message-Id do e-mail original (correlação)
    }],
    createdAt: Date,
    updatedAt: Date
  }
  //emailDeliveryFailures: gravado por email-inbound.service.ts::recordEmailDeliveryFailure() quando
  //  um bounce/DSN é correlacionado a este ticket via findChamadoForEmailReply() (assunto com
  //  protocolo, ou In-Reply-To/References). Sem ticket correspondente, o bounce é descartado
  //  silenciosamente (nada é persistido). Substitui a collection desk_config.email_bounce_log
  //  (descontinuada 2026-09-11) — indicador vive permanentemente no próprio ticket, sem log à
  //  parte; UI: ícone na lista de tickets (DeskTicketList.jsx, dot --email-failed).
  //Histórico runtime: registro[].metadados.workflow, registro[].metadados.requisicao,
  //registro[].metadados.sistemaExec, registro[].alteracoes
  //metadados.requisicao (audit, append ao ativar workflow):
  //  { valores: Mixed, workflowId: String, campoIds: String[] }
  //Sininho (CTA lido/não lido): NÃO fica embutido em workflow.pendingCta/ctaAcks (nunca implementado
  //assim) — é a collection separada desk_config.workflow_notificacoes (ver schema completo abaixo),
  //via POST implícito em createWorkflowNotificacao()/createCasoEspecialNotificacao() e
  //GET/PATCH /api/workflow-notificacoes.

  //schema b2c_chamados.boxes
  //Modelo: Box — backend/src/models/Box.ts
  //Finalidade: caixas personalizadas do agente (botão Criar caixa)
  //Status: A DESENVOLVER

  A DESENVOLVER

  //schema b2c_chamados.telephony_calls
  //Modelo: TelephonyCall — backend/src/models/TelephonyCall.ts v1.1.0
  //Origem: POST /api/inbound/telephony/calls (Contact Tel / parceira IA telefônica)
  //Doc integração: desk/docs/telephony-integration.md
  //Índices: externalCallId unique; provider, direction, callType, status, endedAt, clientPhone,
  //         clientCpf, agentName; { endedAt: -1 }; text index summary+transcript+clientName
  //NÃO persistir: recording_download_url, áudio, Bearer token da parceira (sanitizado em rawPayload)
  {
    _id: ObjectId,
    externalCallId: String,         // Obrigatório — unique — id da ligação na parceira (= payload.id Contact Tel)
    provider: String,               // Default: 'contact-tel' — index
    canonicalUrl: String,           // URL de referência na parceira (opcional)
    direction: String,              // 'inbound' | 'outbound' — index
    origin: String,                 // Origem técnica informada pela parceira
    callType: String,               // ex.: 'ai_agent' — index
    status: String,                 // ex.: completed, no_answer, busy, failed — index
    initiatedAt: Date,              // Início da discagem / chamada
    answeredAt: Date,               // Atendimento atendido
    startedAt: Date,                // Alias legado / parceira
    endedAt: Date,                  // Término — index (listagem e KPIs por período)
    durationSeconds: Number,        // Duração total em segundos
    ringDuration: Number,           // Tempo de ring em segundos
    clientPhone: String,            // Default: '' — index — telefone do cliente (por direção da ligação)
    clientCpf: String,              // Default: '' — index — CPF normalizado (variables/data_collected)
    clientName: String,             // Default: '' — nome do cliente (variables/data_collected)
    isConverted: Boolean,           // Conversão informada pela parceira
    isOptout: Boolean,              // Opt-out informado pela parceira
    isMismatch: Boolean,            // Divergência de identidade informada pela parceira
    terminationOrigin: String,      // Quem encerrou / motivo técnico de término
    agentId: String,                // ID do agente IA na parceira
    agentName: String,              // Default: '' — index — ex.: "Bia Comercial"
    campaignId: String,             // ID da campanha na parceira
    campaignName: String,           // Nome da campanha
    variables: Mixed,               // Variáveis de contexto da ligação (payload.variables)
    dataCollected: Mixed,           // Dados coletados na conversa (payload.data_collected)
                                      // Contact Tel: chave → { value: Mixed } ou valor direto
    transcript: String,             // Default: '' — transcrição consolidada (texto)
    summary: String,                // Default: '' — resumo da conversa (conversation_summary)
    transcriptFull: [{              // Subdocumento (_id: false) — turnos da conversa
      role: String,                 // Obrigatório — 'agent' | 'user' | …
      message: String,              // Default: ''
      originalMessage: String,      // Default: null — texto original antes de normalização
      timeInCallSecs: Number        // Offset em segundos dentro da ligação
    }],
    transfer: {                     // Subdocumento (_id: false) — transferência para humano (opcional)
      destinationType: String,
      destinationValue: String,
      targetUserName: String,
      targetUserExtension: String,  // Ramal
      waitMs: Number,               // Espera até atendimento humano
      answeredByName: String,
      answeredAt: Date
    },
    outcome: String,                // Resultado normalizado (fallback: status)
    intent: String,                 // Intenção detectada (opcional / futuro)
    sentiment: String,              // Sentimento detectado (opcional / futuro)
    rawPayload: Mixed,              // Default: {} — payload sanitizado da parceira (sem URLs de gravação)
    chamadoId: ObjectId,            // Default: null — → chamados_n1._id (quando vinculado a ticket)
    ticketStatus: String,           // Default: 'none' — enum: 'none' | 'pending' | 'created'
                                      // v1 inbound: sempre 'none'; TELEPHONY_AUTO_CREATE_TICKET ainda não implementado
    clienteId: ObjectId,            // Default: null — → b2c_cadastros.clientes._id (match CPF/telefone)
    createdAt: Date,
    updatedAt: Date
  }
  //Inbound idempotente: retry com mesmo externalCallId → 200 duplicate (não regrava)
  //API interna JWT: GET /api/telephony/calls, GET /api/telephony/calls/:id, GET /api/telephony/calls/stats
  //UI Desk: /atendimento-ia-telefonico

  //schema b2c_chamados.ai_usage_logs
  //Modelo: AiUsageLog — backend/src/models/AiUsageLog.ts v1.0.1
  //Finalidade: telemetria de custo/uso de IA por chamada (Agentes 1-4 + features legadas)
  //Índices: { createdAt: 1 }; { provider: 1, modelName: 1, feature: 1, createdAt: 1 }
  {
    _id: ObjectId,
    provider: String,               // Obrigatório — 'openai' | 'gemini'
    modelName: String,              // Obrigatório — ex.: gpt-4.1-mini, gemini-2.5-flash
                                      // Chamado modelName (não `model`) p/ não colidir com Document.model
    feature: String,                // Obrigatório — 'atendimento' | 'auditoria' | 'gestao_chamados' | 'casos_especiais' |
                                      //   'ticket_suggest_legacy' | 'refinar_rascunho' | 'chamado_ia_analise' | 'telephony_ia_analise'
    inputTokens: Number,            // Default: 0
    outputTokens: Number,           // Default: 0
    totalTokens: Number,            // Default: 0
    estimatedCostUsd: Number,       // Default: 0
    pricingSource: String,          // Default: 'catalog' — 'catalog' | 'fallback'
    ticketId: String,               // Opcional — chamadoId como string
    protocolo: String,              // Opcional — chamadoProtocolo
    userId: String,                 // Opcional
    createdAt: Date,
    updatedAt: Date
  }
  //Escrita: cada chamada de IA das Agentes 1-4 (casosEspeciaisAgent.service.ts:97-108 p/ Agente 4)

  //schema b2c_chamados.chamado_ia_analise
  //Modelo: ChamadoIaAnalise — backend/src/models/ChamadoIaAnalise.ts v1.0.0
  //Finalidade: cache de classificação de IA por ticket (motivo/sentimento/"caso grave") — evita reclassificar
  //  quando o texto real do cliente não mudou (dedupe por hash de conteúdo), mesmo com status/tags atualizados
  //Uso casos especiais: alerta precoce de menção a Bacen/Procon/Reclame Aqui/ação judicial em tickets comuns,
  //  ANTES de chegarem formalmente a um canal especial — sinal complementar ao Agente 4 (casosEspeciaisAgent),
  //  não é o mesmo pipeline; alimenta cards de Gestão (GestaoRiscoCasoEspecialCard)
  //Índices: chamadoId unique; { 'casoGrave.tipo': 1 }; { analisadoEm: -1 }; { ticketCreatedAt: 1, motivo: 1, sentimentoClasse: 1 }
  {
    _id: ObjectId,
    chamadoId: ObjectId,            // Obrigatório — unique — → chamados_n1._id
    chamadoProtocolo: String,       // Default: ''
    ticketCreatedAt: Date,          // Obrigatório
    motivo: String,                 // Default: ''
    motivoNovo: Boolean,            // Default: false
    sentimentoClasse: String,       // Default: 'neutro' — 'positivo'|'neutro'|'irritado'|'confuso'|'critico'
    casoGrave: {                    // Default: null — subdocumento (_id: false)
      tipo: String,                 // Obrigatório
      trecho: String                // Default: ''
    },
    textoHash: String,              // Obrigatório — hash do texto real do cliente
    qualidadeFonte: String,         // Default: 'direto_cliente' — 'direto_cliente' | 'resumo_atendente'
    canal: String,                  // Default: 'velodesk'
    contextoVersao: Number,         // Default: 1
    modelo: String,                 // Default: ''
    origem: String,                 // Default: 'auto' — 'auto' | 'manual'
    needsReanalysis: Boolean,       // Default: false
    corrigidoPor: String,           // Opcional
    corrigidoEm: Date,              // Opcional
    analisadoEm: Date,              // Default: Date.now
    createdAt: Date,
    updatedAt: Date
  }

  -------------------------------------------------------------------------------------
  //schema b2c_cadastros.clientes
  //Modelo: Cliente — backend/src/models/Cliente.ts v1.2.0
  //Índice: clienteDados.clienteCpf (unique, sparse)
  //Sem índice unique em e-mail — findClienteByEmail usa findOne (duplicatas = risco de vínculo errado)
  //DTO lateralForm (API ticket, não persistido em chamados_n1):
  //  clienteEmail: String[] — lista completa
  //  clienteEmailResposta: String — e-mail marcado pelo agente para respostas outbound
  //  clienteTelefone: String[] — lista completa
  //  clienteTelefoneWhatsapp: String — telefone marcado para WhatsApp
  //Outbound e-mail: resolveClienteEmailFromChamado prioriza clienteEmail.resposta → lista[0] → registro.metadados.emailFrom
  {
    _id: ObjectId,
    clienteDados: [{                // Subdocumento ClienteDados (_id: false)
      clienteCpf: String,            // Default: ''
      clienteNome: String,           // Default: ''
      clienteEmail: {               // Subdocumento (_id: false)
        lista: String[],             // Default: [] — todos os e-mails do cliente
        resposta: String             // Default: '' — e-mail selecionado para respostas ao cliente (≥2 e-mails: obrigatório na UI)
      },
      clienteTelefone: {            // Subdocumento (_id: false)
        lista: String[],             // Default: [] — todos os telefones do cliente
        whatsapp: String             // Default: '' — telefone selecionado para WhatsApp (≥2 telefones: obrigatório na UI)
      }
    }],
    atendimentoHistorico: [{        // Subdocumento AtendimentoHistorico (_id: false)
      chamadoProtocolo: String,      // Default: '' — → chamados_n1.chamadoProtocolo
      resumo: String,                // Default: ''
      avaliacao: String              // Default: ''
    }],
    createdAt: Date,
    updatedAt: Date
  }

  -------------------------------------------------------------------------------------
  🗄️ Database: chamados_reclamacoes — módulo Casos Especiais (Bacen, Procon, Consumidor.gov, Reclame Aqui)
     Conexão dedicada: getReclamacoesConnection() — backend/src/config/database.ts v1.9.0
     API: backend/src/routes/reclamacoes.routes.ts v1.2.0, reclameAquiHugme.routes.ts v1.1.0
     Triagem IA (Agente 4): backend/src/services/agents/casosEspeciais*.ts — feature 'casos_especiais' em ai_usage_logs
     Feature flag: AGENT_CASOS_ESPECIAIS_ENABLED (default false) — triagem IA desligada até habilitar em produção
  -------------------------------------------------------------------------------------

  //schema chamados_reclamacoes.reclamacoes_procon / reclamacoes_bacen / reclamacoes_consumidorGov
  //Modelo compartilhado: ReclamacaoBaseSchema — backend/src/models/reclamacoes/ReclamacaoBase.schema.ts v1.4.0
  //Models por collection: backend/src/models/reclamacoes/reclamacaoModels.ts v1.1.0
  //  getReclamacaoProconModel | getReclamacaoBacenModel | getReclamacaoConsumidorGovModel
  //Granularidade: 1 documento por reclamação/caso especial; mesmo schema replicado em 1 collection por órgão
  //Fonte da lista do CRM de cada órgão: esta collection (não chamados_n1). O chamado operacional
  //  (mensagens, status Desk, cliente) continua em b2c_chamados.chamados_n1 — não apagar n1.
  //INALTERADO nesta leva (2026-09-08): só Reclame Aqui ganhou schema próprio — ver bloco dedicado
  //  reclamacoes_reclameAqui abaixo. Procon/Bacen/Consumidor.gov continuam neste schema genérico,
  //  incluindo o padrão "campos do órgão dentro de meta: Mixed" descrito abaixo — candidato ao
  //  mesmo tratamento de campos de primeira classe quando entrar na fila de cada órgão.
  //API: GET /api/reclamacoes/:orgao[?aberta&statusCanal&limit&skip] — limit default 50, máx 100,
  //     resposta { items, total, limit, skip } (total = countDocuments, não length da página),
  //     GET /api/reclamacoes/:orgao/by-ticket/:chamadoId,
  //     GET /api/reclamacoes/:orgao/search?q=  — busca dual n1 + reclamacoes,
  //     GET /api/reclamacoes/:orgao/:id,
  //     POST /api/reclamacoes/:orgao — body { chamadoId } (dispara runCasosEspeciaisTriagem em ticket existente)
  //       ou body { ticket | ...camposTicket } (cria chamados_n1 + roda triagem),
  //     PATCH /api/reclamacoes/:orgao/:id — scalars + meta
  //     auth: função do órgão (procon|bacen|consumidor-gov) | especiais.<orgao>_gerenciar |
  //           tickets.ver_todos | função/funcao gestao
  //Escrita automática: casosEspeciaisRouting.service.ts::upsertFromChamado() quando a triagem classifica
  //  caso_formal_real (routeCasoEspecialFormal) — ticket nasce em chamados_n1 (canal genérico: e-mail
  //  etc.) e só depois é classificado pela IA; fusão cross-collection (chamados_n1 fechado como
  //  child, ticket do órgão como parent ativo) é o mecanismo em fila pra esses 3 órgãos — ver
  //  IReclamacaoFusao no bloco reclamacoes_reclameAqui abaixo, já implementado lá como referência.
  //SEM workflow dedicado por órgão (removido 2026-08-17 — não existe mais "bacen-tratativa" etc.).
  //  Ticket segue elegível a workflow REAL via tryActivateWorkflowOnTabulation().
  //motivo: lista cadastrável por órgão em desk_config.tabulacao_opcoes (categoria motivo_*), NÃO é a
  //  árvore produto→motivo→detalhe do Desk. Grava aqui e em meta do canal; NÃO em chamados_n1.tabulacao.motivo.
  //Notificação: sininho (desk_config.workflow_notificacoes, tipo 'caso_especial') para responsável +
  //  agentes com a função do órgão.
  //Índices: chamadoId unique; chamadoProtocolo; { statusCanal: 1, prazoLegal: 1 }; cpf sparse;
  //         { aberta: 1, createdAt: -1 };
  //         idDemandaExterna unique parcial (idDemandaExterna_unique) —
  //           partialFilterExpression: { idDemandaExterna: { $exists: true, $type: 'string', $gt: '' } }
  //           (não indexa string vazia; default do campo é undefined, não '')
  {
    _id: ObjectId,
    orgao: String,                  // Obrigatório — 'procon' | 'bacen' | 'consumidor_gov'
    chamadoId: ObjectId,            // Obrigatório — unique — → b2c_chamados.chamados_n1._id
    chamadoProtocolo: String,       // Default: ''
    origemEntrada: String,          // Default: '' — ex.: 'email-inbound', 'casos-especiais'
    inboxDedicada: Boolean,         // Default: false — e-mail chegou por inbox institucional dedicada
    emailThreadRootId: String,      // Default: '' — thread raiz do e-mail inbound (quando aplicável)
    triagem: {                      // Subdocumento (_id: false) — snapshot da classificação do Agente 4
      classificacao: String,        // Obrigatório — 'caso_formal_real' | 'ameaca_vazia' | 'falso_positivo'
      orgao: String,                 // Obrigatório
      confianca: String,             // Obrigatório
      evidencia: String,            // Default: ''
      justificativa: String,        // Default: ''
      signals: String[],            // Default: []
      at: Date,                     // Obrigatório
      agenteVersao: String          // Default: 'casosEspeciaisAgent v1.0.0'
    },
    consumidor: String,             // Default: '' — nome do cliente
    cpf: String,                    // Default: '' — index sparse
    email: String[],                // Default: []
    telefoneWhatsapp: String,       // Default: ''
    assunto: String,                // Default: ''
    descricao: String,              // Default: ''
    produto: String,                // Default: ''
    tipo: String,                   // Default: ''
    motivo: String,                 // Default: '' — motivo do órgão (tabulacao_opcoes.motivo_*), não tabulacao Desk
    statusCanal: String,            // Default: 'nao-respondida'
    prazoLegal: Date,               // Default: undefined — prazo regulatório de resposta (Bacen/CG: extraído do
                                      //   assunto do e-mail quando presente — ver parseBacenRdrEmail/
                                      //   parseConsumidorGovEmail — fix 2026-09-08)
    slaPct: Number,                 // Default: undefined — % do SLA consumido
    orgaoInstituicao: String,       // Default: '' — instituição/órgão emissor quando aplicável
    cidade: String,                 // Default: ''
    uf: String,                     // Default: ''
    protocoloExterno: String,       // Default: '' — protocolo no órgão externo (ex.: RDR Bacen, extraído do
                                      //   assunto do e-mail — fix 2026-09-08)
    idDemandaExterna: String,       // Default: undefined — id da demanda no sistema do órgão — chave de dedupe
                                      // unique parcial (ver índices); omitir o campo se vazio
    atendente: String,              // Default: ''
    responsavel: String,            // Default: '' — colaboradorNome atribuído (applyFuncaoEspecialAssignment)
    workflowId: ObjectId,           // Default: undefined — → desk_config.workflow_definicoes._id (workflow REAL, se algum combinar)
    workflowSlug: String,           // Default: '' — denormalizado p/ exibição; não é mais um slug fixo por órgão
    workflowAtivo: Boolean,         // Default: false — espelha workflow.active (ver bloco workflow abaixo)
    workflow: {                     // Default: undefined — subdocumento (_id: false)
                                      // Espelha chamados_n1.workflow (IChamadoWorkflow) — snapshot denormalizado
                                      // sincronizado a cada upsertFromChamado/syncFromChamado, para consultar/agir
                                      // no workflow direto do dash do órgão sem join em chamados_n1
      active: Boolean,              // Default: false
      workflowStatus: String,       // Default: null — 'active' | 'finished'
      workflowId: ObjectId,         // Default: null — → desk_config.workflow_definicoes._id
      step: Number,                 // Default: 0 — índice 0-based em passos[] da definição
      passoId: ObjectId,            // Default: null
      startedAt: Date,              // Default: null
      completedAt: Date,            // Default: null
      pendingDecision: String,      // Default: null — 'approve' | 'reject' | null
      requisicao: {                 // Default: undefined — subdocumento (_id: false)
        preenchidaEm: Date,
        preenchidaPor: String,      // Default: ''
        valores: Mixed,             // Default: {} — Record<campoId, valor>
        comunicacaoWorkflow: Array[{ // Default: [] — subdocumento (_id: false)
          mensagem: String,         // Default: ''
          data: Date,
          autor: String             // Default: ''
        }]
      }
    },
    aberta: Boolean,                // Default: true
    meta: Mixed,                    // Default: {} — dados extras por origem (payload bruto do e-mail etc.) —
                                      //   ainda é o "campo genérico" pra esses 3 órgãos (não promovido a
                                      //   primeira classe nesta leva; ver nota RA abaixo)
    createdAt: Date,
    updatedAt: Date
  }

  //schema chamados_reclamacoes.reclamacoes_reclameAqui
  //Modelo PRÓPRIO (2026-09-08): ReclamacaoReclameAquiSchema — backend/src/models/reclamacoes/
  //  ReclamacaoReclameAqui.schema.ts v1.0.0 — NÃO usa mais ReclamacaoBaseSchema. Motivo: os campos
  //  do RA (planilha HugMe) são individualizados e não cabiam bem no schema genérico compartilhado
  //  com Procon/Bacen/Consumidor.gov — ver "meta: Mixed" no bloco acima pra comparação do "antes".
  //Model: backend/src/models/reclamacoes/reclamacaoModels.ts v1.1.0 :: getReclamacaoReclameAquiModel()
  //Granularidade: 1 documento por reclamação Reclame Aqui.
  //Identidade: único id externo é idOrigem (coluna "Id Origem" da planilha HugMe). "Id HugMe"
  //  (coluna própria da planilha) foi DESCARTADO por decisão de negócio — não é usado como
  //  identificador de nada, não é gravado em lugar nenhum (nem no bag de colunas cruas abaixo).
  //Canal: coluna A "Origem" da planilha (ex.: "ReclameAQUI") vira o campo `canal` de primeira
  //  classe — não confundir com `tipo` (classificação Reclamação/Dúvida/etc. do CRM).
  //dadosPlanilha: captura literal de TODAS as colunas da planilha (nome da coluna = chave), exceto
  //  "Id HugMe" — cobre qualquer campo sem exibição própria no ticket ainda (moderação, avaliações,
  //  réplicas, tempos de resposta etc.), pra permitir desenvolvimentos futuros sem perder dado.
  //  Substitui o antigo bag `colunasOriginais` que vivia na coleção paralela (ver nota abaixo).
  //Criação: SEMPRE direto nesta collection — nunca em chamados_n1 (diferente de Procon/Bacen/CG,
  //  que nascem em chamados_n1 porque chegam por canal genérico e só são classificados depois).
  //  RA tem o órgão conhecido já na criação (cadastro manual no módulo RA do CRM, ou import HugMe)
  //  — não há justificativa de negócio pra passar por chamados_n1 primeiro.
  //  ATENÇÃO (2026-09-08, ainda pendente): o ticket "host da conversa" (registro[], mensagens,
  //  compose, WhatsApp) continua sendo criado em chamados_n1 via reclameAquiTicketCreate.service.ts
  //  — só os campos de classificação/ocorrência (este schema) já são de primeira classe aqui.
  //  Cortar de vez a criação do host de conversa pra dentro desta collection (registro[]/
  //  tabulacao[], reaproveitando backend/src/models/shared/registro.schema.ts) exige rotas de
  //  mensagens/commit próprias + um mapeador de ticket paralelo ao chamado.mapper.ts — ainda não
  //  feito, fica pra próxima leva.
  //Workflow: mesmo formato/uso do bloco acima (Procon/Bacen/CG), agora dedicado só ao RA.
  //Fusão (fusao — NOVO): mesmo formato do IChamadoFusao (ChamadoN1.ts: fundido, dataFundido,
  //  hierarquia, parentId/childId, parentProtocolo/childProtocolo, childProtocolos/childIds), com
  //  DOIS campos extras (childCollection/parentCollection) porque a fusão aqui pode ser
  //  cross-collection (ex.: um chamados_n1 fechado como child, referenciado por protocolo — o
  //  jeito seguro de linkar entre coleções diferentes, já que ObjectId só resolve dentro da MESMA
  //  coleção). Infraestrutura pronta; hoje sem uso operacional pro RA (que não nasce em chamados_n1
  //  — ver nota de criação acima) — é o mecanismo de referência a ser copiado pra Procon/Bacen/CG
  //  quando a fusão automática pós-triagem for implementada pra eles.
  //Import HugMe: sem coleção paralela (reclame_aqui_hugme_registros foi DESCONTINUADA — ver nota
  //  na seção seguinte). hugmeImport.service.ts v2.0.0 faz upsert direto aqui por idOrigem —
  //  reimportar a mesma planilha (ou uma atualizada) ENRIQUECE o documento existente, nunca duplica.
  //Índices: chamadoId sparse (nem todo doc tem chamado host ainda — ver nota de criação);
  //         chamadoProtocolo; { statusCanal: 1, prazoLegal: 1 }; cpf sparse; { aberta: 1, createdAt: -1 };
  //         idOrigem unique (idOrigem_unique); idDemandaExterna unique parcial (idDemandaExterna_unique)
  {
    _id: ObjectId,
    orgao: String,                  // Default: 'reclame_aqui'
    chamadoId: ObjectId,            // Default: null — → b2c_chamados.chamados_n1._id (host da conversa — ver nota acima)
    chamadoProtocolo: String,       // Default: ''
    origemEntrada: String,          // Default: '' — 'reclamacoes-manual' | 'hugme-import' | 'reclamacoes-register'
    inboxDedicada: Boolean,         // Default: false
    emailThreadRootId: String,      // Default: ''
    triagem: { /* mesmo formato do bloco Procon/Bacen/CG acima */ },

    idOrigem: String,               // Obrigatório — único id externo (coluna "Id Origem" da planilha)
    idDemandaExterna: String,       // Default: undefined — mesmo valor de idOrigem — chave de dedupe legada
    protocoloExterno: String,       // Default: '' — mesmo valor de idOrigem (compat com campo genérico dos outros órgãos)

    canal: String,                  // Default: '' — coluna A "Origem" da planilha (ex.: "ReclameAQUI")

    consumidor: String,             // Default: '' — coluna "Nome"
    nomeSocial: String,             // Default: '' — coluna "Nome social do consumidor" (fallback de consumidor)
    cpf: String,                    // Default: '' — coluna "CPF/CNPJ" — index sparse
    email: String[],                // Default: [] — coluna "Email"
    telefoneWhatsapp: String,       // Default: '' — coluna "Telefones"
    cidade: String,                 // Default: '' — coluna "Cidade"
    uf: String,                     // Default: '' — coluna "Estado"

    assunto: String,                // Default: '' — coluna "Título"
    descricao: String,              // Default: '' — coluna "Texto da Reclamação" (+ "Consideração Consumidor" concatenada)
    dataReclamacao: Date,           // Default: undefined — coluna "Data Reclamação"
    dataResposta: Date,             // Default: undefined — coluna "Data de Resposta"
    respostaPublica: String,        // Default: '' — coluna "Resposta da empresa"

    produto: String,                // Default: '' — classificação CRM (Desk), normalizada contra tabulacao_campos
    tipo: String,                   // Default: '' — classificação CRM (Reclamação/Dúvida/etc.), NÃO vem da planilha
    motivo: String,                 // Default: '' — classificação CRM (tabulacao_opcoes categoria motivo_reclame_aqui)

    motivoRa: String,               // Default: '' — coluna "Motivo da Reclamação RA" (taxonomia bruta da plataforma)
    categoriaRa: String,            // Default: '' — coluna "Categoria RA"
    problemaRa: String,             // Default: '' — coluna "Problema RA"
    produtoRa: String,              // Default: '' — RESERVADO, ainda não populado pelo parser: a coluna
                                      //   "Produto RA" hoje alimenta o `produto` normalizado do CRM (mesmo
                                      //   alias em HUGME_COLUMN_MAP) — o valor bruto da coluna continua
                                      //   disponível em dadosPlanilha["Produto RA"] enquanto este campo
                                      //   não for desacoplado do `produto`
    sentimentoRa: String,           // Default: '' — coluna "Sentimento RA*"
    nota: String,                   // Default: '' — coluna "Nota"

    statusRa: String,               // Default: 'nao-respondida' — normalizado internamente (nao-respondida|
                                      //   respondida|aguard-avaliacao) a partir de statusRaLabel
    statusRaLabel: String,          // Default: '' — coluna "Status RA" (label bruto da planilha)
    statusHugme: String,            // Default: '' — coluna "Status Hugme"
    statusCanal: String,            // Default: 'nao-respondida' — espelha statusRa (compat com campo genérico)

    dadosPlanilha: Mixed,           // Default: {} — Record<coluna_planilha, valor> — TODAS as colunas, exceto
                                      //   "Id HugMe" — ver nota acima

    prazoLegal: Date,               // Default: undefined — RA não tem prazo regulatório automático hoje
    slaPct: Number,                 // Default: undefined
    orgaoInstituicao: String,       // Default: ''
    atendente: String,              // Default: ''
    responsavel: String,            // Default: '' — colaboradorNome atribuído
    workflowId: ObjectId,           // Default: undefined
    workflowSlug: String,           // Default: ''
    workflowAtivo: Boolean,         // Default: false
    workflow: { /* mesmo formato do bloco Procon/Bacen/CG acima */ },
    fusao: {                        // Default: undefined — subdocumento (_id: false) — ver nota "Fusão" acima
      fundido: Boolean,             // Default: false
      dataFundido: Date,            // Default: null
      hierarquia: String,           // Default: '' — 'superior' | 'inferior' | 'redundante' | ''
      parentId: ObjectId,           // Default: null
      childId: ObjectId,            // Default: null
      parentProtocolo: String,      // Default: ''
      childProtocolo: String,       // Default: ''
      childProtocolos: String[],    // Default: []
      childIds: ObjectId[],         // Default: []
      childCollection: String,      // Default: '' — nome da collection onde childId/childIds vivem de fato
      parentCollection: String      // Default: '' — nome da collection onde parentId vive de fato
    },
    aberta: Boolean,                // Default: true
    meta: Mixed,                    // Default: {} — só o que é genuinamente ad hoc da UI do CRM agora
                                      //   (passivelNota, tentativaContato) — NÃO é mais destino de campos
                                      //   da planilha (esses viraram primeira classe acima)

    ultimoImportBatchId: String,    // Default: '' — → reclame_aqui_hugme_import_batches.batchId
    primeiroImportEm: Date,         // Default: undefined
    ultimoImportEm: Date,           // Default: undefined

    createdAt: Date,
    updatedAt: Date
  }

  //schema chamados_reclamacoes.reclame_aqui_hugme_registros — REMOVIDA (2026-09-11)
  //Descontinuada em 2026-09-08 (hugmeImport.service.ts v2.0.0 passou a fazer upsert direto em
  //  reclamacoes_reclameAqui por idOrigem — era registro DUPLICADO da mesma ocorrência). Confirmado
  //  na auditoria de collections de 2026-09-11 que nenhum código (rota, service ou tipo) ainda
  //  referenciava o model — collection dropada (115 documentos, sem backup — dado já substituído/
  //  redundante) e removidos: model+schema (ReclameAquiHugmeRegistro.schema.ts),
  //  hugmeModels.ts::getReclameAquiHugmeRegistroModel(), e as funções mortas que ainda recebiam
  //  esse tipo (registroToRaTicketSource, buildTicketPayloadFromHugmeRegistro,
  //  createRaTicketFromHugmeRegistro, em reclameAquiTicketCreate.service.ts). O tipo
  //  HugmeOrigemImportacao (único pedaço ainda em uso) foi movido para
  //  ReclameAquiHugmeImportBatch.schema.ts. As rotas GET /api/reclame-aqui/hugme/registros[/:idOrigem]
  //  e /stats seguem consultando reclamacoes_reclameAqui diretamente, como já documentado em 2026-09-08.

  //schema chamados_reclamacoes.reclame_aqui_hugme_import_batches
  //Modelo: ReclameAquiHugmeImportBatch — backend/src/models/reclamacoes/ReclameAquiHugmeImportBatch.schema.ts v1.0.0
  //Model: backend/src/models/reclamacoes/hugmeModels.ts::getReclameAquiHugmeImportBatchModel() v1.0.0
  //Finalidade: log/auditoria de cada lote de importação da planilha Hugme
  //Índice: { importedAt: -1 }
  {
    _id: ObjectId,
    batchId: String,                // Obrigatório — unique
    modo: String,                   // Obrigatório — 'base_inicial' | 'incremental' (compat; pipeline único de upsert)
    fileName: String,               // Default: ''
    total: Number,                  // Default: 0
    inserted: Number,               // Default: 0
    updated: Number,                // Default: 0
    skipped: Number,                // Default: 0
    ticketsCreated: Number,         // Default: 0
    failed: Number,                 // Default: 0
    batchErrors: [{                 // Default: [] — subdocumento (_id: false)
      rowIndex: Number,             // Default: 0
      idOrigem: String,             // Default: ''
      message: String               // Default: ''
    }],
    importedAt: Date,               // Obrigatório
    importedBy: String,             // Default: ''
    createdAt: Date,
    updatedAt: Date
  }


  //schema desk_config.tabulacao_campos
  //Modelo: TabulacaoProduto — backend/src/models/TabulacaoProduto.ts v1.0.0
  //Granularidade: 1 documento por produto (não singleton)
  //Índices: produto unique; { ativo: 1, ordem: 1 }
  //Desk: produtos ativos alimentam selects produto → motivo → detalhe
  //Admin: desativar/excluir via Configurações → Formulários (supervisor)
  {
    _id: ObjectId,
    produto: String,                // Obrigatório — unique
    ordem: Number,                  // Default: 0
    ativo: Boolean,                 // Default: true
    motivos: [{                     // Subdocumento (_id: false)
      motivo: String,
      ordem: Number,                // Default: 0
      ativo: Boolean,               // Default: true
      detalhes: [{                  // Subdocumento (_id: false)
        detalhe: String,
        ordem: Number,              // Default: 0
        ativo: Boolean,             // Default: true
      }]
    }],
    updatedBy: String,              // Default: '' — colaborador da sessão VeloHub
    createdAt: Date,
    updatedAt: Date
  }

  //schema desk_config.tabulacao_opcoes
  //Modelo: TabulacaoOpcoes — backend/src/models/TabulacaoOpcoes.ts v1.1.0
  //Granularidade: 1 documento por categoria (unique em categoria)
  //Índice: categoria unique
  //Categorias:
  //  tipo_chamado, canal_contato — selects Tipo e Canal do painel lateral do Desk
  //  motivo_reclame_aqui, motivo_procon, motivo_consumidor_gov, motivo_bacen —
  //    lista do campo Motivo dos forms de casos especiais; NÃO entra no payload ativo da
  //    tabulação Desk (getActiveOpcoes só devolve tipoChamado + canalContato)
  //API (path inalterado): GET/POST/PATCH/DELETE /api/tabulation/opcoes/:categoria[/items/:itemId]
  //Admin: cards clicáveis em Configurações → Formulários (forms-stats-row); mesmo TabulationOpcoesModal
  //Seed: motivo_reclame_aqui — 22 itens na primeira carga se o doc estiver vazio
  //      (tabulationOpcoes.service.ts::MOTIVO_RECLAME_AQUI_SEED / ensureOrgaoMotivoCategorias).
  //      Procon / Consumidor.Gov / Bacen começam com opcoes: [].
  {
    _id: ObjectId,
    categoria: String,              // Obrigatório — unique —
                                      // 'tipo_chamado' | 'canal_contato' |
                                      // 'motivo_reclame_aqui' | 'motivo_procon' |
                                      // 'motivo_consumidor_gov' | 'motivo_bacen'
    opcoes: [{                      // Subdocumento (_id: true)
      valor: String,                // Obrigatório — rótulo exibido no desk
      ordem: Number,                // Default: 0
      ativo: Boolean,               // Default: true
    }],
    updatedBy: String,              // Default: '' — colaborador da sessão VeloHub
    createdAt: Date,
    updatedAt: Date
  }

  //schema desk_config.desk_funcoes_permissoes
  //Modelo: DeskFuncaoPermissao — backend/src/models/DeskFuncaoPermissao.ts v1.0.0
  //CORREÇÃO 2026-08-17: esta collection e o model AccessCapability documentados aqui antes NUNCA
  //  existiram no código atual — não confundir. O model real é DeskFuncaoPermissao; a nota antiga
  //  "eliminada 2026-07-20" estava errada (drift de doc, não refletia o código). Collection viva.
  //Finalidade: RBAC por função Desk — Config → Funções Desk (1 doc por função)
  //Índices: { slug: 1 } unique, { nivel: 1 }
  //Catálogo de módulos/chaves: backend/src/config/funcaoPermissaoDefaults.ts::PERMISSION_CATALOG
  //  (fonte de verdade em código — resumo abaixo pode ficar defasado se o catálogo mudar)
  //permissoes é schema-less (Mongoose strict:false) — aceita qualquer módulo/chave do catálogo,
  //  sem precisar migrar o schema Mongoose a cada novo módulo (ex.: "acesso", adicionado hoje)
  //Herança: herdaDe[] — resolveEffectivePermissoes() funde base(all-false) → pais (recursivo) →
  //  permissoes do próprio doc (maior prioridade), por módulo+chave
  //Identidade agente: console_funcionarios (acessos.Desk + atuacao) — NÃO desk_agentes
  {
    _id: ObjectId,
    slug: String,                   // Obrigatório — unique — ex.: "atendimento", "bacen", "gestao"
    nome: String,                   // Obrigatório
    nivel: Number,                  // Default: 1
    herdaDe: String[],              // Default: [] — slugs de funções pai (merge herança em runtime)
    portalVisivel: String[],        // Default: ['agent'] — derivado de permissoes.portal.* ao salvar
                                      // (derivePortalVisivelFromPermissoes) — 'agent'|'gestao'|'workflow'|'especiais'
    canalOrigem: String,            // Default: '' — ex.: "reclame-aqui" para canais especiais
    permissoes: Mixed,              // Default: {} — Record<modulo, Record<chave, Boolean>>, schema-less
                                      // Módulos do catálogo atual (PERMISSION_CATALOG):
      // portal: { agente, gestao, workflow, especiais }
      //   — Oculto no editor de overrides (Config → Funções Desk) desde 2026-08-17: fará mais
      //     sentido numa modalidade futura. Dado/lógica seguem ativos (portalVisivel, ProfileContext).
      // tickets: { ver_todos, ver_meus, atuar_responsavel, atuar_atribuido, atuar_canal_especial }
      //   — Editor de overrides mantido como está.
      // workspace: { painel_360_proprio, painel_360_equipe }
      //   — painel_360_equipe decide Workspace360 Agente vs Gestão (WorkspaceView.jsx) — antes
      //     hardcoded em profileId==='gestao', agora lê esta permissão de fato (2026-08-17).
      // workflow: { avancar, aprovar, rejeitar, interromper }
      // preferencias: { visualizar }
      //   — Sem override desde 2026-08-17: Preferências é visível para todas as funções.
      // config: { visualizar, formularios_criar/editar/excluir, automacoes_criar/editar/excluir,
      //           workflows_editar }
      //   — Oculto no editor de overrides desde 2026-08-17 (congelado nos valores atuais); a
      //     visibilidade de Configurações na barra passou a vir de acesso.config. Ação dentro da
      //     página (formularios_*/automacoes_*/workflows_editar) continua enforced nas rotas.
      // especiais: { reclame_aqui_gerenciar, bacen_gerenciar, procon_gerenciar, consumidor_gov_gerenciar }
      //   — Oculto no editor de overrides desde 2026-08-17 (congelado); API (reclamacoes.routes.ts
      //     assertCanAccessOrgao) continua checando esta permissão OU função/canalOrigem casando.
      // acesso: { <cada id de frontend/src/config/profiles.js NAV_ITEMS, exceto 'preferencias'>: Boolean }
      //   — NOVO 2026-08-17 ("Módulos de Acesso"). Um boolean por item da barra retrátil — true =
      //     a função vê aquele módulo. Substitui a antiga união fixa PROFILES[portal].nav (que
      //     misturava tudo que o portal "liberava" e causava módulos como Canais Especiais
      //     aparecendo para quem não devia). Backend: ACESSO_MODULO_IDS em funcaoPermissaoDefaults.ts.
      //     Frontend: ProfileContext.js::isNavAllowed() lê permissoes.acesso[navId] direto.
    updatedBy: String,              // Default: ''
    createdAt: Date,
    updatedAt: Date
  }
  //Backfill automático no boot (funcaoPermissao.service.ts::seedFuncoesPermissoes): preenche
  //  permissoes.preferencias.visualizar e permissoes.acesso ausentes em docs seedados antes de
  //  cada feature existir, sem sobrescrever quem já foi configurado manualmente.
  //API: GET /funcoes-permissoes, GET /funcoes-permissoes/catalog, PUT /funcoes-permissoes/:slug

  //schema desk_config.grupos_responsabilidade — ELIMINADA (2026-09-11)
  //Modelo/service deletados (backend/src/models/GrupoResponsabilidade.ts,
  //  grupoResponsabilidade.service.ts). Motivo (auditoria de collections): má compreensão de uma
  //  tarefa de atribuição de workflow — "grupo" foi implementado como lista de membros mantida à
  //  parte (colaborador/e-mail cadastrado manualmente), quando deveria ter sido tratado como
  //  função (já suportado nativamente via atribuicao.tipo:'funcao' + console_funcionarios). Antes
  //  da remoção, confirmado no banco: 0 workflows usando fonte='grupo_responsabilidade' em
  //  gatilho.criterios, 0 tickets com atribuido='grupo:*', 0 passos com CTA de grupo — apesar de
  //  5 grupos cadastrados (com membros) sem nenhum consumidor real. Rotas
  //  /api/workflows/grupos-responsabilidade* respondem 410 Gone. gatilho.criterios[].fonte e
  //  passo.atribuicao.tipo/automatica.ctaAlvo perderam a opção 'grupo'/'grupo_responsabilidade'
  //  (ver bloco workflow_definicoes abaixo — schema já atualizado, sem essas opções).
  //Antigo shape do documento (histórico, só referência):
  //  { _id, slug (unique), nome, descricao, ordem, ativo,
  //    membros: [{ tipo: 'colaborador'|'email'|'perfil_desk', valor }], updatedBy, createdAt, updatedAt }

  //schema desk_config.workflow_definicoes
  //Modelo: WorkflowDefinicao — backend/src/models/WorkflowDefinicao.ts v1.5.0
  //Config requisição: backend/src/config/workflowRequisicaoDefaults.ts v1.1.0
  //Índices: { slug: 1 } unique, { ativo: 1, ordem: 1 }
  //Notação passos[]: array indexado — passos[0], passos[1], passos[n] (0=> / n=> indicam posição)
  //Ícones de etapa: derivados em runtime por passo.acao.tipo (manual|aprovacao|automatica) — sem passo.icone
  //Critérios de ativação: apenas gatilho.criterios[] — sem passo.criterios[]
  {
    _id: ObjectId,
    slug: String,                   // unique — ex.: "reembolso-7dias"
    titulo: String,
    descricao: String,
    ordem: Number,
    ativo: Boolean,
    gatilho: {
      tipo: String,                 // 'tabulacao' (v1)
      criterios: [{                 // AND — _id: true
        fonte: String,              // 'tabulacao' | 'grupo_responsabilidade' | 'integracao'
        campo: String,              // tabulacao: tipoChamado|produto|... — integracao: statusPagamento (API)
        operador: String,           // equals|contains|not_empty|in
        valor: String
      }]
    },
    passos: Array[{
      0 => {
        _id: ObjectId,
        ordem: Number,
        passo: {                    // _id: false
          nome: String,
          descricao: String,
          slaHoras: Number,
          atribuicao: {
            tipo: String,           // 'funcao'|'colaborador'|'responsavel_ticket'|'sistema'|'grupo' (grupo legado — migrar para funcao)
            funcaoSlug: String,     // ex.: "atendimento" — preferido desde RBAC 2026-07-20
            grupoSlug: String,      // legado — migrate:grupo-to-funcao
            colaborador: String,    // colaboradorNome ou e-mail (lista Desk)
            sistema: Mixed            // @deprecated legado — preferir acao.automatica
          },
          acao: {
            tipo: String,           // 'manual'|'aprovacao'|'automatica'
            rotas: [{
              variavel: String,
              rotulo: String,
              proximoPassoId: ObjectId,
              statusTicket: String
            }],
            automatica: {           // quando tipo === 'automatica' (webhook / IA / CTA)
              modo: String,         // 'acao_sistema'|'resposta_cliente'|'call_to_action'
              webhookTipo: String,  // 'interno'|'externo'
              webhookUrl: String,
              webhookHookId: String,
              webhookMetodo: String, // 'POST'|'GET'
              webhookHeaders: Mixed,
              promptContexto: String,
              ctaTitulo: String,
              ctaMensagem: String,
              ctaAlvo: String,       // 'responsavel'|'atribuido'|'grupo'
              ctaGrupoSlug: String
            }
          }
        }
      },
      n => { /* mesma estrutura de passos[0] */ }
    }],
    passoInicialId: ObjectId,       // → passos[n]._id da etapa de entrada
    requisicao: {                   // Form complementar ao clicar Iniciar Workflow (1 doc por workflow)
      campos: [{                    // _id: false — ordem por ordem ASC
        id: String,                 // slug estável — derivado do label (normalizeFieldId) na persistência
                                      // NÃO usar campos da denylist nem gatilho.criterios[].campo
                                      // Denylist: clienteCpf, cpf, tipoChamado, classificacaoTipo, produto,
                                      // motivo, detalhe, responsavel, atribuido, canal + critérios do gatilho
        label: String,              // rótulo exibido no form e na tela de aprovação workflow
        tipo: String,               // text|textarea|number|date|select|boolean|currency
        obrigatorio: Boolean,       // Default: false
        ordem: Number,              // Default: 0
        opcoes: [{ valor: String, label: String }],  // select — valor persistido em valores[campoId]
        placeholder: String,        // opcional — UI form agente
        ajuda: String               // hint opcional abaixo do rótulo
      }]
    },
    updatedBy: String,
    createdAt: Date,
    updatedAt: Date
  }
  //Runtime integracao: lateralForm.integracao.statusPagamento (API futura — ex.: Pagar.me)
  //Runtime: tabulacao.atribuido recebe colaborador direto, "funcao:{slug}" ou legado "grupo:{slug}"
  //Fluxo requisição: agente preenche form → POST /api/tickets/:id/workflow/start { requisicao: { valores } }
  //  → grava chamados_n1.workflow.requisicao + registro[].metadados.requisicao (audit)
  //  → visão Workflow (/workflow) exibe tabulação + todos requisicao.campos[] com valores persistidos

  //schema desk_config.workflow_notificacoes
  //Modelo: WorkflowNotificacao — backend/src/models/WorkflowNotificacao.ts v1.1.0
  //Finalidade: backing store do sininho (NotificationPanel.jsx) + Painel 360 — CTA de workflow E
  //  aviso de item novo em canal especial (tipo 'caso_especial', sem workflow dedicado)
  //Índice: { destinatarioEmail: 1, lida: 1, createdAt: -1 }
  //API: GET /api/workflow-notificacoes (lista + unread do usuário logado),
  //     PATCH /api/workflow-notificacoes/:id/read
  {
    _id: ObjectId,
    tipo: String,                   // Default: 'workflow_cta' — 'workflow_cta' | 'caso_especial'
    destinatarioEmail: String,      // Obrigatório — index
    ticketId: ObjectId,             // Obrigatório — index — → b2c_chamados.chamados_n1._id
    chamadoProtocolo: String,       // Default: ''
    workflowId: ObjectId,           // Default: null — presente só quando tipo === 'workflow_cta'
    workflowSlug: String,           // Default: '' — ex.: 'telephony-inbound' p/ CTA de telefonia
    step: Number,                   // Default: 0
    passoId: ObjectId,              // Default: null
    orgao: String,                  // Default: '' — presente só quando tipo === 'caso_especial'
                                      // 'reclame-aqui'|'procon'|'bacen'|'consumidor-gov' — usado pelo
                                      // frontend p/ montar /especiais/:orgao/ticket/:ticketId
    reclamacaoId: ObjectId,         // Default: null — → chamados_reclamacoes.reclamacoes_*._id
    titulo: String,                 // Default: ''
    mensagem: String,               // Default: ''
    lida: Boolean,                  // Default: false
    createdAt: Date,
    updatedAt: Date
  }
  //Destinatários (caso_especial): responsável atribuído + agentes com a função do órgão
  //  (resolveTeamEmails em casosEspeciaisRouting.service.ts) — sem lista de e-mail de alerta.
