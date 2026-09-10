/**
 * catalogo v1.0.0 — o que o agente testa todos os dias
 *
 * Cada item vira uma linha na planilha consolidada, com a mesma linguagem do
 * consolidado manual (Área / Objetivo / Resultado esperado / OK?).
 *
 * `conhecida: true` marca uma falha já mapeada pelo time: quando o teste falha,
 * a planilha registra "Falha conhecida" em vez de "Nao", para o alarme sobrar
 * para regressão nova.
 */

export type Situacao =
  | 'Sim' // passou
  | 'Nao' // falhou
  | 'Parcial' // passou com ressalva
  | 'Falha conhecida' // falhou, mas já era esperado
  | 'Nao testavel' // depende de ação humana / ambiente
  | 'Bloqueado' // não deu para testar por dependência quebrada
  | 'Nao testado'; // não executou nesta rodada

export type Area =
  | 'Saúde do sistema'
  | 'Tickets novos'
  | 'Mensagens e respostas'
  | 'Finalização'
  | 'Mesclas'
  | 'Envios de e-mail'
  | 'CSAT'
  | 'Erros'
  | 'Telas (navegador)';

export interface CasoCatalogo {
  id: string;
  area: Area;
  funcionalidade: string;
  objetivo: string;
  esperado: string;
  /** Falha já conhecida do time — não é regressão nova. */
  conhecida?: string;
  /** Só roda quando a rodada pode escrever (não é somente leitura). */
  escreve?: boolean;
  /** Precisa do navegador. */
  ui?: boolean;
}

export const CATALOGO: CasoCatalogo[] = [
  // ── Saúde do sistema ──────────────────────────────────────────────────────
  {
    id: 'S01',
    area: 'Saúde do sistema',
    funcionalidade: 'API do Velodesk responde',
    objetivo: 'A API principal está no ar e respondendo',
    esperado: 'GET /api/health responde em poucos segundos com status "ok"',
  },
  {
    id: 'S02',
    area: 'Saúde do sistema',
    funcionalidade: 'Bancos de dados conectados',
    objetivo: 'Todos os bancos que o CRM usa estão conectados',
    esperado: 'Chamados, cadastros, configurações e preferências aparecem como conectados',
  },
  {
    id: 'S03',
    area: 'Saúde do sistema',
    funcionalidade: 'Serviço de e-mail configurado',
    objetivo: 'O ambiente tem transporte de e-mail pronto para enviar',
    esperado: 'A sonda de e-mail responde que o transporte está pronto (emailTransportReady = true)',
  },
  {
    id: 'S04',
    area: 'Saúde do sistema',
    funcionalidade: 'Entrada de tickets por API ativa',
    objetivo: 'O canal que recebe tickets do app/telefone/IA está ligado',
    esperado: 'GET /api/inbound/tickets/health responde com enabled = true',
  },
  {
    id: 'S05',
    area: 'Saúde do sistema',
    funcionalidade: 'Login de atendente',
    objetivo: 'Um atendente consegue autenticar e receber sessão',
    esperado: 'POST /api/login devolve token válido e o cadastro do colaborador',
  },
  {
    id: 'S06',
    area: 'Saúde do sistema',
    funcionalidade: 'Contadores das filas',
    objetivo: 'As caixas e contadores das filas respondem com números',
    esperado: 'GET /api/stats devolve total, resolvidos, pendentes, caixas e agentes',
  },

  // ── Tickets novos ─────────────────────────────────────────────────────────
  {
    id: 'T01',
    area: 'Tickets novos',
    funcionalidade: 'Criar ticket pela API de entrada',
    objetivo: 'Um ticket novo é criado e recebe protocolo',
    esperado:
      'Resposta 201 com protocolo de 10 dígitos (canal fica vazio de propósito — origem "qa-teste" não popula esse campo)',
    escreve: true,
  },
  {
    id: 'T02',
    area: 'Tickets novos',
    funcionalidade: 'Ticket criado aparece na busca por protocolo',
    objetivo: 'O ticket recém-criado é encontrado pelo número de protocolo',
    esperado: 'GET /api/tickets/by-protocol/:protocolo devolve o ticket com status "novo"',
    escreve: true,
  },
  {
    id: 'T03',
    area: 'Tickets novos',
    funcionalidade: 'Proteção contra ticket duplicado',
    objetivo: 'Reenviar o mesmo pedido não cria um segundo ticket',
    esperado: 'Segunda chamada responde 200 com action = "duplicate" e o mesmo protocolo',
    escreve: true,
  },
  {
    id: 'T04',
    area: 'Tickets novos',
    funcionalidade: 'Ticket novo entra na fila',
    objetivo: 'O ticket criado aparece na contagem da fila de novos',
    esperado: 'O ticket é listado na fila com status "novo" e contador maior que zero',
    escreve: true,
  },
  {
    id: 'T05',
    area: 'Tickets novos',
    funcionalidade: 'Numeração de protocolo do dia',
    objetivo: 'O contador de protocolo está avançando normalmente',
    esperado: 'O contador do dia existe e é maior que o da rodada anterior',
  },
  {
    id: 'T06',
    area: 'Tickets novos',
    funcionalidade: 'Volume de tickets criados',
    objetivo: 'Entrada de tickets nas últimas 24h está dentro do normal',
    esperado: 'Há tickets criados no período e o número não é zero nem absurdamente fora da média',
  },

  // ── Mensagens e respostas ─────────────────────────────────────────────────
  {
    id: 'R01',
    area: 'Mensagens e respostas',
    funcionalidade: 'Anotação interna',
    objetivo: 'Atendente registra anotação interna no ticket',
    esperado: 'A anotação é gravada no histórico do ticket e fica marcada como interna',
    escreve: true,
  },
  {
    id: 'R02',
    area: 'Mensagens e respostas',
    funcionalidade: 'Resposta pública ao cliente',
    objetivo: 'Resposta pública é gravada no ticket e sai por e-mail',
    esperado: 'A mensagem aparece na conversa e o envio de e-mail é registrado',
    conhecida:
      'BUG CRÍTICO já mapeado no consolidado de 21/08: resposta pública pelo Compose não conclui o envio.',
    escreve: true,
  },
  {
    id: 'R03',
    area: 'Mensagens e respostas',
    funcionalidade: 'Tabulação (árvore de motivos)',
    objetivo: 'A tabulação escolhida é salva no ticket',
    esperado: 'Produto, tipo, motivo e detalhe ficam gravados e visíveis no ticket',
    conhecida:
      'Falha conhecida do consolidado de 21/08: árvore de motivos não é preenchida automaticamente pela sugestão de IA.',
    escreve: true,
  },
  {
    id: 'R04',
    area: 'Mensagens e respostas',
    funcionalidade: 'Encaminhar para outro grupo',
    objetivo: 'Ticket é direcionado a outra fila/grupo',
    esperado: 'Ticket sai da fila atual e aparece na fila do grupo escolhido',
    conhecida:
      'Consolidado de 21/08: a função não foi localizada na tela do ticket. Sem rota de API equivalente para automatizar.',
  },

  // ── Finalização ───────────────────────────────────────────────────────────
  {
    id: 'F01',
    area: 'Finalização',
    funcionalidade: 'Trava: finalizar sem responsável',
    objetivo: 'O sistema impede encerrar ticket sem responsável definido',
    esperado: 'A tentativa é recusada com aviso para atribuir um responsável real',
    escreve: true,
  },
  {
    id: 'F02',
    area: 'Finalização',
    funcionalidade: 'Trava: finalizar sem tabulação',
    objetivo: 'O sistema impede encerrar ticket sem a tabulação preenchida',
    esperado: 'A tentativa é recusada pedindo produto, tipo e motivo',
    escreve: true,
  },
  {
    id: 'F03',
    area: 'Finalização',
    funcionalidade: 'Finalizar ticket',
    objetivo: 'Ticket com responsável e tabulação é finalizado',
    esperado: 'O ticket passa para "resolvido" e o histórico registra a mudança',
    escreve: true,
  },
  {
    id: 'F04',
    area: 'Finalização',
    funcionalidade: 'Fechamento automático após 48h',
    objetivo: 'A rotina que fecha tickets resolvidos está rodando',
    esperado: 'Não há acúmulo de tickets resolvidos há mais de 3 dias ainda sem fechamento',
  },
  {
    id: 'F05',
    area: 'Finalização',
    funcionalidade: 'Resolução automática de pendentes',
    objetivo: 'A rotina que resolve pendentes antigos está rodando',
    esperado: 'Não há acúmulo de tickets pendentes há mais de 3 dias sem resolução',
  },

  // ── Mesclas ───────────────────────────────────────────────────────────────
  {
    id: 'M01',
    area: 'Mesclas',
    funcionalidade: 'Mesclar dois tickets do mesmo cliente',
    objetivo: 'Dois tickets do mesmo CPF são mesclados em um ativo',
    esperado: 'O ticket ativo registra a mesclagem e lista o protocolo absorvido',
    escreve: true,
  },
  {
    id: 'M02',
    area: 'Mesclas',
    funcionalidade: 'Ticket absorvido sai da fila',
    objetivo: 'O ticket inativo é resolvido e não aparece mais nas filas abertas',
    esperado: 'O absorvido fica com status "resolvido" e marcado como inferior na mesclagem',
    escreve: true,
  },
  {
    id: 'M03',
    area: 'Mesclas',
    funcionalidade: 'Trava: mesclar com CPF divergente',
    objetivo: 'O sistema recusa mesclar tickets de clientes diferentes',
    esperado: 'A tentativa é recusada com aviso de CPF inválido ou divergente',
    escreve: true,
  },
  {
    id: 'M04',
    area: 'Mesclas',
    funcionalidade: 'Mesclas do dia',
    objetivo: 'Acompanhar quantas mesclas foram feitas nas últimas 24h',
    esperado: 'O número é registrado para acompanhamento (sem alarme)',
  },

  // ── Envios de e-mail ──────────────────────────────────────────────────────
  {
    id: 'E01',
    area: 'Envios de e-mail',
    funcionalidade: 'E-mails enviados nas últimas 24h',
    objetivo: 'O CRM continuou enviando e-mails — tanto os automáticos por gatilho quanto as respostas de agente',
    esperado: 'Há envios nas duas frentes; zero nas duas em dia útil indica transporte parado',
  },
  {
    id: 'E02',
    area: 'Envios de e-mail',
    funcionalidade: 'Modelo de e-mail do CSAT ativo',
    objetivo: 'O modelo "Encerramento mais satisfação" existe e está ativo',
    esperado: 'Modelo encontrado e ativo — sem ele nenhum CSAT é enviado',
  },
  {
    id: 'E03',
    area: 'Envios de e-mail',
    funcionalidade: 'Modelo de repescagem do CSAT ativo',
    objetivo: 'O modelo "Repescagem da satisfação" existe e está ativo',
    esperado: 'Modelo encontrado e ativo',
  },
  {
    id: 'E04',
    area: 'Envios de e-mail',
    funcionalidade: 'E-mail do ticket de teste',
    objetivo: 'O ticket criado pelo QA gerou envio de e-mail ao cliente de teste',
    esperado: 'O histórico do ticket registra o e-mail enviado para um endereço da lista segura',
    escreve: true,
  },
  {
    id: 'E05',
    area: 'Envios de e-mail',
    funcionalidade: 'Auditoria da lista de e-mails seguros',
    objetivo: 'Nenhum ticket de QA tem endereço fora da lista segura',
    esperado: 'Todos os tickets marcados como QA apontam apenas para e-mails autorizados',
  },
  {
    id: 'E06',
    area: 'Envios de e-mail',
    funcionalidade: 'Modelos de e-mail com gatilho ativo',
    objetivo: 'Os modelos de disparo automático continuam ativos',
    esperado: 'A quantidade de modelos ativos com gatilho não caiu para zero',
  },
  {
    id: 'E07',
    area: 'Envios de e-mail',
    funcionalidade: 'Qualidade do texto dos e-mails automáticos',
    objetivo: 'A saudação e o corpo dos modelos ativos estão claros, consistentes e com a instrução certa',
    esperado:
      'A revisão por IA não aponta tom incoerente, instrução errada para o tipo de e-mail (ex.: pedir ' +
      'resposta num e-mail de pesquisa) nem contradição entre os modelos ativos',
  },
  {
    id: 'E08',
    area: 'Envios de e-mail',
    funcionalidade: 'Qualidade do e-mail real recebido por cliente',
    objetivo:
      'O texto que de fato saiu para um cliente real (não só o modelo cadastrado) está correto — ' +
      'nome do cliente é removido antes da revisão, nunca sai da máquina',
    esperado: 'A revisão por IA de uma amostra recente de e-mails reais não aponta tom incoerente ou instrução errada',
  },

  // ── CSAT ──────────────────────────────────────────────────────────────────
  {
    id: 'C01',
    area: 'CSAT',
    funcionalidade: 'Registrar nota do cliente',
    objetivo: 'A nota enviada pelo cliente é gravada no ticket',
    esperado: 'Nota, data da resposta e evento no histórico do ticket são gravados',
    escreve: true,
  },
  {
    id: 'C02',
    area: 'CSAT',
    funcionalidade: 'Trava: nota inválida',
    objetivo: 'Nota fora de 1 a 5 é recusada',
    esperado: 'A chamada é recusada com aviso de nota inválida',
  },
  {
    id: 'C03',
    area: 'CSAT',
    funcionalidade: 'Trava: avaliação não enviada',
    objetivo: 'Protocolo sem pesquisa enviada não aceita nota',
    esperado: 'A chamada responde "avaliação não encontrada"',
  },
  {
    id: 'C04',
    area: 'CSAT',
    funcionalidade: 'Nota não é sobrescrita',
    objetivo: 'Segunda resposta do mesmo cliente não altera a nota já dada',
    esperado: 'A nota original é mantida',
    escreve: true,
  },
  {
    id: 'C05',
    area: 'CSAT',
    funcionalidade: 'Página de avaliação do cliente',
    objetivo: 'A página que o cliente abre para avaliar está no ar',
    esperado: 'A página /csat carrega e apresenta o card de avaliação',
  },
  {
    id: 'C06',
    area: 'CSAT',
    funcionalidade: 'Números do CSAT',
    objetivo: 'Acompanhar enviados, respondidos e taxa de resposta',
    esperado: 'Os números são registrados; taxa de resposta muito abaixo do normal levanta alerta',
  },
  {
    id: 'C07',
    area: 'CSAT',
    funcionalidade: 'Rotina de envio do CSAT',
    objetivo: 'A rotina horária que dispara a pesquisa está rodando',
    esperado: 'Não há acúmulo de tickets resolvidos há mais de 4 dias sem pesquisa enviada',
  },

  // ── Erros ─────────────────────────────────────────────────────────────────
  {
    id: 'X01',
    area: 'Erros',
    funcionalidade: 'Erros de API durante a rodada',
    objetivo: 'Nenhuma chamada do agente falhou por erro de servidor ou falta de resposta',
    esperado: 'Nenhuma resposta de erro 500 e nenhuma chamada sem resposta nesta rodada',
  },
  {
    id: 'X02',
    area: 'Erros',
    funcionalidade: 'Erros no console do navegador',
    objetivo: 'As telas principais abrem sem erro no console',
    esperado: 'Nenhuma falha de API registrada no console ao abrir cockpit, fila e ticket',
    ui: true,
  },
  {
    id: 'X03',
    area: 'Erros',
    funcionalidade: 'Tickets sem protocolo',
    objetivo: 'Nenhum ticket ficou preso sem número de protocolo',
    esperado: 'Nenhum ticket com protocolo pendente de atribuição',
  },
  {
    id: 'X04',
    area: 'Erros',
    funcionalidade: 'Tickets parados como novos',
    objetivo: 'Tickets não estão travados em "novo" por tempo demais',
    esperado: 'Nenhum ticket com mais de 24h ainda em "novo"',
  },
  {
    id: 'X05',
    area: 'Erros',
    funcionalidade: 'Módulos do console',
    objetivo: 'Nenhum módulo do CRM está desligado ou em revisão',
    esperado: 'Todos os módulos aparecem com status "on"',
  },

  // ── Telas (navegador) ─────────────────────────────────────────────────────
  {
    id: 'U01',
    area: 'Telas (navegador)',
    funcionalidade: 'Tela de login',
    objetivo: 'A tela de login carrega com os campos de acesso',
    esperado: 'Campos de e-mail e senha e o botão Entrar aparecem',
    ui: true,
  },
  {
    id: 'U02',
    area: 'Telas (navegador)',
    funcionalidade: '"Meu dia" (cockpit do agente)',
    objetivo: 'O cockpit abre com os cards do dia preenchidos',
    esperado: 'Bloco "Meu dia" aparece com os indicadores do agente',
    ui: true,
  },
  {
    id: 'U03',
    area: 'Telas (navegador)',
    funcionalidade: 'Fila de atendimento',
    objetivo: 'A fila abre com as caixas e os contadores',
    esperado: 'Painel de filas lista Novos, Meus Tickets, Em andamento, Pendente e Resolvidos',
    ui: true,
  },
  {
    id: 'U04',
    area: 'Telas (navegador)',
    funcionalidade: 'Ticket aberto',
    objetivo: 'Um ticket abre com as abas de trabalho',
    esperado: 'Abas Conversa, Notas, Eventos e Consultas aparecem no ticket',
    ui: true,
  },
];

export function caso(id: string): CasoCatalogo {
  const c = CATALOGO.find((x) => x.id === id);
  if (!c) throw new Error(`Caso de teste desconhecido no catálogo: ${id}`);
  return c;
}
