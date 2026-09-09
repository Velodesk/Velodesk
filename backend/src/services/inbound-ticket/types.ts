/** inbound-ticket/types v1.0.0 — contrato canônico POST /api/inbound/tickets */

export type InboundTicketOrigin = 'app' | 'telefone' | 'agente-ia' | 'chat';

export interface InboundTicketOriginConfig {
  canal: string;
  channel: string;
  source: string;
  assignmentSource: 'inbound-ticket';
}

export interface InboundTicketPayload {
  externalId: string;
  title: string;
  text: string;
  clientName: string;
  chamadoProtocolo?: string;
  clientCPF?: string;
  clientPhone?: string;
  clientEmail?: string;
  attachments?: string[];
  priority?: string;
  produto?: string;
  motivo?: string;
  detalhe?: string;
  tipoChamado?: string;
  classificacaoTipo?: string;
  responsavel?: string;
  metadata?: Record<string, unknown>;
}

export interface InboundTicketResult {
  action: 'created' | 'duplicate' | 'replied';
  ticketId: string;
  chamadoProtocolo: string;
  canal: string;
}

export const INBOUND_TICKET_SECRET_PATTERN = /^[a-z0-9]{35}$/;

export const INBOUND_TICKET_SECRET_LENGTH = 35;

export const INBOUND_TICKET_ORIGIN_HEADERS: Record<InboundTicketOrigin, string> = {
  app: 'x-inbound-app-secret',
  telefone: 'x-inbound-telefone-secret',
  'agente-ia': 'x-inbound-agente-ia-secret',
  chat: 'x-inbound-chat-secret',
};

export const ORIGIN_CANAL_CONFIG: Record<InboundTicketOrigin, InboundTicketOriginConfig> = {
  app: {
    canal: 'App',
    channel: 'app',
    source: 'inbound-ticket-app',
    assignmentSource: 'inbound-ticket',
  },
  telefone: {
    canal: 'Telefone',
    channel: 'telefone',
    source: 'inbound-ticket-telefone',
    assignmentSource: 'inbound-ticket',
  },
  'agente-ia': {
    canal: 'Agente IA',
    channel: 'agente-ia',
    source: 'inbound-ticket-agente-ia',
    assignmentSource: 'inbound-ticket',
  },
  chat: {
    canal: 'Chat',
    channel: 'chat',
    source: 'inbound-ticket-chat',
    assignmentSource: 'inbound-ticket',
  },
};
