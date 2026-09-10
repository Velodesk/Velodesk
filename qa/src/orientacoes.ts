/**
 * orientacoes v1.0.0 — o que fazer quando cada checagem não passa
 *
 * Serve para duas coisas:
 *  1. é a devolutiva usada quando a IA não está configurada ou falha;
 *  2. entra como contexto no pedido à IA, para a sugestão dela sair no rumo
 *     certo em vez de genérica.
 *
 * Regra de escrita: uma frase, no imperativo, dizendo onde olhar primeiro.
 */

export const ORIENTACOES: Record<string, string> = {
  // Saúde do sistema
  S01: 'Confira o serviço no Cloud Run (revisão ativa, logs de inicialização e memória) antes de investigar o resto — com a API fora, todos os outros testes ficam cegos.',
  S02: 'Veja qual banco caiu no retorno de /api/health e confira a variável de conexão correspondente no Cloud Run (MONGODB_URI para o cluster do Desk, MONGO_ENV para o VeloHubCentral).',
  S03: 'Confira o documento desk_email_transport na collection email_transport (desk_config): precisa de defaultFromEmail, delegatedUserEmail e serviceAccountJson com client_email e private_key.',
  S04: 'Confira INBOUND_TICKETS_ENABLED e os secrets de entrada no Cloud Run — com o canal desligado, app, telefone e agente de IA não abrem ticket.',
  S05: 'Confira no cadastro de colaboradores se o usuário de QA existe, está com senha válida e tem acessos.Desk marcado; sem isso o Desk inteiro fica inacessível para ele.',
  S06: 'Confira a rota /api/stats e a conexão com b2c_chamados — os contadores alimentam os cards de gestão.',

  // Tickets novos
  T01: 'Confira o secret x-inbound-app-secret (35 caracteres a-z0-9) e o payload mínimo exigido: externalId, title, text, clientName e um entre CPF, telefone ou e-mail.',
  T02: 'Se o ticket foi criado mas não é encontrado, olhe a atribuição de protocolo (protocolo.service e o contador em sequence_counters) e o índice chamadoProtocolo_1.',
  T03: 'A idempotência depende de registro[].metadados.inboundTicketExternalId; confira se o externalId está sendo gravado e se a busca por ele continua indexada.',
  T04: 'Fila zerada pede olhar a roleta de atribuição (ASSIGNMENT_ROUTER_ENABLED) e os filtros de caixa antes de suspeitar da entrada de tickets.',
  T05: 'Confira o documento _id "chamadoProtocolo" em sequence_counters — sem ele os tickets nascem sem número para o cliente acompanhar.',
  T06: 'Volume muito abaixo da média costuma ser entrada quebrada, não queda real de demanda: confira as sondas de entrada (e-mail, telefonia, app) uma a uma.',

  // Mensagens e respostas
  R01: 'Confira a rota POST /api/tickets/:id/messages e a gravação em registro[].anotacaoInterna.',
  R02: 'É o bug crítico já mapeado no Compose: acompanhe a correção antes de reportar como novo. Confira o commit da resposta pública e o disparo em notifyAgentReplyAsync.',
  R03: 'Confira a árvore de motivos ativa (GET /api/tabulation) e se a sugestão de IA está preenchendo produto, tipo, motivo e detalhe antes do commit.',
  R04: 'Falta a função na tela e não existe rota de API equivalente; para entrar no monitoramento, precisa primeiro existir no produto.',

  // Finalização
  F01: 'Se um ticket foi encerrado sem responsável, a trava assertResponsavelForTerminalStatus deixou de barrar — é regressão de risco alto, porque perde a rastreabilidade de quem encerrou.',
  F02: 'Se encerrou sem tabulação, confira assertTabulacaoForStatus e a lista STATUSES_REQUIRING_TABULATION — sem isso os relatórios de motivo ficam furados.',
  F03: 'Confira a rota POST /api/tickets/:id/commit e se a transição de status está sendo empilhada em registro[] com o responsável e a tabulação preenchidos.',
  F04: 'Acúmulo de resolvidos indica a rotina horária de fechamento parada: confira os logs de startCloseResolvedTicketsJob e RESOLVED_CLOSE_INTERVAL_MS.',
  F05: 'Acúmulo de pendentes antigos indica startResolvePendenteTicketsJob parado; confira os logs do job e PENDENTE_RESOLVE_AFTER_MS.',

  // Mesclas
  M01: 'Confira POST /api/ticket-fusao: exige CPF com 11 dígitos, o mesmo cliente em todos os tickets e nenhum deles fechado ou já absorvido.',
  M02: 'Se o absorvido não ficou como inferior, ele continua aparecendo nas filas e duplica atendimento: confira a gravação de fusao.hierarquia e o filtro excludeFusaoAbsorvidosFilter.',
  M03: 'Se aceitou CPF divergente, a validação de cliente na fusão falhou — risco de misturar atendimento de clientes diferentes. Trate como prioridade.',
  M04: 'Apenas acompanhamento de volume; variação grande vale cruzar com reclamação de atendente sobre ticket duplicado.',

  // Envios de e-mail
  E01: 'Zero disparo em dia útil é quase sempre transporte de e-mail ou modelos inativos, não falta de gatilho: comece pelos casos S03 e E06.',
  E02: 'Sem o modelo "Encerramento mais satisfação" ativo em Emails de Saída, nenhuma pesquisa de satisfação é enviada — reative ou recrie o modelo com o gatilho de status.',
  E03: 'Reative o modelo "Repescagem da satisfação" para voltar a cobrar resposta de quem não avaliou.',
  E04: 'Sem registro de envio no ticket de teste, confira se há modelo com gatilho para abertura de atendimento e se o transporte de e-mail está pronto.',
  E05: 'Endereço fora da lista em ticket de QA é risco de e-mail para cliente: corrija o cadastro do CPF de teste antes da próxima rodada e confira QA_EMAIL_ALLOWLIST nos dois lados (agente e Cloud Run).',
  E06: 'Nenhum modelo ativo com gatilho significa cliente sem nenhuma comunicação automática: revise a aba Emails de Saída.',
  E07: 'Revise o texto (saudação e corpo) do(s) modelo(s) apontado(s) na observação diretamente na aba Emails de Saída — lembre que todo e-mail recebe automaticamente o convite fixo "responda este e-mail" e a assinatura "Time de Atendimento Velotax", então um modelo de pesquisa/aviso não deve pedir resposta.',
  E08: 'A observação traz o protocolo do e-mail real com problema — abra o ticket, confira a mensagem enviada na aba Conversa/Eventos e, se o problema for do modelo (não só daquele ticket), corrija na aba Emails de Saída para não repetir no próximo envio.',

  // CSAT
  C01: 'Confira POST /api/csat e a gravação do subdocumento csat (nota, respondido, respondidoEm) — é o que alimenta o painel de CSAT.',
  C02: 'Nota fora de 1 a 5 aceita contamina a média do CSAT: restaure a validação na rota.',
  C03: 'Aceitar nota sem pesquisa enviada permite avaliação forjada por link montado à mão: restaure a checagem de csat.enviado.',
  C04: 'Se a nota foi sobrescrita, a idempotência caiu e um mesmo cliente pode alterar a avaliação: restaure a checagem de csat.respondido.',
  C05: 'A página que o cliente abre para avaliar está fora: confira a rota GET /csat e a presença de assets/csat/csat.html na imagem publicada.',
  C06: 'Taxa de resposta muito baixa costuma ser problema de entrega ou de layout do e-mail, não de cliente desinteressado: teste o e-mail numa caixa da lista segura.',
  C07: 'Acúmulo de resolvidos sem pesquisa indica o job horário do CSAT parado ou o modelo inativo: confira os logs de startCsatInicialJob e o caso E02.',

  // Erros
  X01: 'Cada erro 500 tem rastro nos logs do Cloud Run pelo horário da rodada; comece pela rota citada na observação.',
  X02: 'Erro de API no console do atendente costuma aparecer antes da reclamação chegar: procure a rota que falhou nos logs do backend.',
  X03: 'Ticket sem protocolo deixa o cliente sem número para acompanhar: confira o watcher de protocolo e o contador em sequence_counters.',
  X04: 'Tickets parados em "novo" indicam fila sem tratamento ou roleta de atribuição parada; confira ASSIGNMENT_ROUTER_ENABLED e a distribuição por atendente.',
  X05: 'Módulo desligado ou em revisão pode ser intencional; confirme com quem alterou o console antes de tratar como incidente.',

  // Telas
  U01: 'Confira o deploy do frontend e a variável VITE_GOOGLE_CLIENT_ID — sem ela a tela de login cai em "Login não configurado".',
  U02: 'Se o cockpit devolve para o login, a sessão não está sendo aceita: confira o JWT e se o colaborador tem acessos.Desk no cadastro.',
  U03: 'Confira a rota /api/boxes/queue-counts e o carregamento das caixas personalizadas do atendente.',
  U04: 'Ticket que não abre é o pior sintoma para a operação: confira o console da tela e a rota GET /api/tickets/:id.',
};

/** Orientação base do caso, ou uma frase genérica quando não houver. */
export function orientacaoBase(id: string): string {
  return ORIENTACOES[id] ?? 'Confira os logs do backend no horário desta rodada e reproduza o passo manualmente.';
}
