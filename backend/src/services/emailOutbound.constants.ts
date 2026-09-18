/** emailOutbound.constants v1.1.0 — textos da despedida injetada */
export const EMAIL_FAREWELL_REPLY_HINT =
  'É só responder este e-mail. A sua mensagem chega direto para quem está cuidando do seu caso.';
export const EMAIL_FAREWELL_TEXT = 'Estou por aqui para o que você precisar.';
export const EMAIL_FAREWELL_SIGN_OFF = 'Time de Atendimento Velotax';

export const EMAIL_CANAL_OPCOES = [
  'WhatsApp',
  'Telefone',
  'E-mail',
  'App',
  'Agente IA',
  'Reclame Aqui',
  'Procon',
  'Consumidor.Gov',
  'Bacen',
] as const;

export const EMAIL_STATUS_OPCOES = [
  { value: 'novo', label: 'Novo' },
  { value: 'em-andamento', label: 'Em andamento' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'resolvido', label: 'Resolvido' },
  { value: 'fechado', label: 'Fechado' },
] as const;

export const EMAIL_SLA_OPCOES = [
  { value: 'metade', label: 'Metade' },
  { value: 'estourado', label: 'Estourado' },
  { value: 'personalizado', label: 'Personalizado' },
] as const;

export const EMAIL_SLA_LIMIT_HOURS: Record<string, number> = {
  'em-aberto': 4,
  'em-andamento': 8,
};

/** Prazo (campo do gatilho de Status): valor numérico permitido, em horas úteis. */
export const EMAIL_STATUS_PRAZO_MIN_HORAS = 1;
export const EMAIL_STATUS_PRAZO_MAX_HORAS = 48;

/** Janela de horário útil (America/Sao_Paulo) usada por todos os contadores de prazo. */
export const BUSINESS_HOURS_START = 8;
export const BUSINESS_HOURS_END = 21;

export const EMAIL_CONTEUDO_SEED = [
  {
    nome: 'Abertura de ticket',
    ativo: true,
    saudacao: 'Olá,',
    corpo: 'Seu chamado foi registrado com sucesso.\n\nPara responder, utilize este e-mail mantendo o protocolo no assunto.',
    gatilho: {
      criterios: [
        { tipo: 'canal' as const, valores: ['E-mail', 'App', 'WhatsApp', 'Agente IA'] },
        { tipo: 'status' as const, valores: ['novo'] },
      ],
    },
  },
  {
    nome: 'Abertura por telefone',
    ativo: true,
    saudacao: 'Olá,',
    corpo: 'Registramos o seu atendimento por telefone.\n\nPara responder, utilize este e-mail mantendo o protocolo no assunto.',
    gatilho: {
      criterios: [
        { tipo: 'canal' as const, valores: ['Telefone'] },
        { tipo: 'status' as const, valores: ['novo'] },
      ],
    },
  },
  { nome: 'Atualização de meio prazo', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Atraso no prazo', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Empréstimo não disponível', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  {
    nome: 'Encerramento mais satisfação',
    ativo: true,
    saudacao: 'Olá, {nome}, tudo bem?',
    corpo: 'Como o seu atendimento foi encerrado, gostaria muito de saber a sua opinião.\nÉ bem rápido, um clique já ajuda demais a melhorar.',
    gatilho: {
      criterios: [{
        tipo: 'gatilho_interno' as const,
        valores: ['resolvido'],
        prazoTipo: 'horas' as const,
        prazoHoras: 48,
      }],
    },
  },
  {
    nome: 'Repescagem da satisfação',
    ativo: true,
    saudacao: 'Olá, {nome}, tudo bem?',
    corpo: 'Há alguns dias o seu atendimento foi encerrado e ainda não recebi a sua avaliação.\nAntes de fechar de vez, gostaria muito de saber como foi a sua experiência. É bem rápido, um clique já ajuda demais.',
    gatilho: {
      criterios: [{
        tipo: 'gatilho_interno' as const,
        valores: [],
        prazoTipo: 'horas' as const,
        prazoHoras: 48,
      }],
    },
  },
  { nome: 'Aviso de inatividade', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Status emitido', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Renovação pós-quitação', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Como contratar', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Renegociação e cobrança', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Conta Selcoin e RPF', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Portabilidade da chave PIX', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
  { nome: 'Pagamento não baixou', ativo: false, saudacao: '', corpo: '', gatilho: { criterios: [] } },
] as const;
