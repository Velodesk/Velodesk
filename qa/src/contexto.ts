/**
 * contexto v1.0.0 — estado compartilhado da rodada
 */
import type { ApiVelodesk } from './api';
import type { Coletor } from './resultado';

export interface TicketQa {
  id: string;
  protocolo: string;
  externalId: string;
}

export interface Tabulacao {
  produto: string;
  tipoChamado: string;
  motivo: string;
  detalhe: string;
  canal: string;
  responsavel: string;
}

export interface Contexto {
  api: ApiVelodesk;
  coletor: Coletor;
  /** Identificador desta rodada — vai na marca dos tickets criados. */
  runId: string;
  /** E-mail seguro usado como cliente dos tickets de teste. */
  emailTeste: string;
  /** Nome do atendente autenticado (usado como responsável real). */
  nomeAtendente: string;
  /** Tickets criados nesta rodada. */
  criados: TicketQa[];
  /** Tabulação válida descoberta na árvore de motivos. */
  tabulacao: Tabulacao | null;
  /** Diretório dos prints. */
  dirPrints: string;
  /** Rodada pode escrever? */
  podeEscrever: boolean;
  /** Tem acesso ao banco? */
  temBanco: boolean;
  /** Sessão devolvida pelo login, usada para abrir as telas no navegador. */
  sessao: { token: string; user: unknown; colaborador: unknown } | null;
}
