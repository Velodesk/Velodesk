/**
 * config v1.0.0 — configuração e travas de segurança do agente de QA
 *
 * Regra de ouro deste arquivo: nada roda contra produção sem a lista de
 * e-mails seguros preenchida. Se a lista estiver vazia, o agente para.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';

loadEnv({ path: path.join(__dirname, '..', '.env') });
loadEnv(); // permite variáveis vindas do ambiente (GitHub Actions)

function req(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Variável obrigatória ausente: ${name}`);
  return v;
}

function opt(name: string, fallback = ''): string {
  const v = String(process.env[name] ?? '').trim();
  return v || fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(v);
}

function lista(name: string): string[] {
  return String(process.env[name] ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

/** CPFs que o backend apaga em todo boot (seed.service.ts) — proibidos aqui. */
const CPFS_PROIBIDOS = new Set([
  '12345678901',
  '11122233300',
  '90100000001',
  '90100000002',
  '90100000003',
  '90100000004',
  '90100000005',
  '90100000006',
  '90100000007',
  '90100000008',
  '90100000009',
]);

const baseUrl = opt('QA_BASE_URL').replace(/\/+$/, '');
const emailsSeguros = lista('QA_EMAIL_ALLOWLIST');
const cpfQa = opt('QA_CLIENT_CPF').replace(/\D/g, '');

/**
 * 'oficial' (padrão) = as rodadas de sempre, 07h/17h, catálogo completo.
 * 'vigilancia' = rodada extra a cada 30 min em horário comercial, só leitura,
 * rodando um subconjunto leve do catálogo (ver `modos` em catalogo.ts) — olho
 * em lentidão/erro real, sem criar ticket, sem e-mail, sem CSAT, e sem repetir
 * as mensagens de boas notícias do Telegram (ver telegram.ts).
 */
export type ModoExecucao = 'oficial' | 'vigilancia';

function lerModoExecucao(): ModoExecucao {
  const v = opt('QA_MODO_EXECUCAO', 'oficial').toLowerCase();
  if (v === 'vigilancia') return 'vigilancia';
  if (v !== 'oficial') {
    console.warn(`[qa] QA_MODO_EXECUCAO="${v}" não reconhecido — usando "oficial".`);
  }
  return 'oficial';
}

const modoExecucao = lerModoExecucao();

export const cfg = {
  /** Origem do Velodesk (frontend + /api no mesmo host). */
  baseUrl,
  /** Origem da API, quando separada do frontend. */
  apiUrl: (opt('QA_API_URL') || baseUrl).replace(/\/+$/, ''),

  login: {
    email: opt('QA_LOGIN_EMAIL'),
    password: opt('QA_LOGIN_PASSWORD'),
  },

  /**
   * Secret da origem dedicada "qa-teste" (header x-inbound-qa-teste-secret).
   * Origem própria do QA no pipeline genérico de tickets: não popula o campo
   * canal da tabulação (tabulacao[].canal = ""), então tickets do Claudio Q.A.
   * não poluem métricas/relatórios/critérios de e-mail filtrados por canal —
   * ver docs/api-inbound-tickets-qa-teste.md e inbound-ticket/types.ts.
   */
  inboundQaTesteSecret: opt('QA_INBOUND_QA_TESTE_SECRET') || opt('QA_INBOUND_APP_SECRET'),

  /** Lista branca de e-mails que o QA pode usar. Nada fora daqui é tocado. */
  emailsSeguros,

  /** CPF fictício usado nos tickets de QA. */
  cpfQa,

  /** Nome do responsável real usado para finalizar tickets de QA. */
  responsavel: opt('QA_RESPONSAVEL', 'Agente QA'),

  mongo: {
    uri: opt('MONGODB_URI') || opt('MONGO_URI'),
    dbChamados: opt('MONGODB_DB_NAME', 'b2c_chamados'),
    dbCadastros: opt('MONGODB_CADASTROS_DB_NAME', 'b2c_cadastros'),
    dbConfig: opt('MONGODB_DESK_CONFIG_DB_NAME', 'desk_config'),
  },

  /**
   * Só leitura: nenhuma escrita, nenhum e-mail, nenhum ticket criado.
   * Sempre true em modo vigilância, mesmo sem QA_SOMENTE_LEITURA=true — a
   * rodada de vigilância nunca escreve, por definição.
   */
  somenteLeitura: bool('QA_SOMENTE_LEITURA', false) || process.argv.includes('--somente-leitura') || modoExecucao === 'vigilancia',
  /** Pula a camada de navegador (útil quando não há Playwright instalado). */
  pularUi: bool('QA_PULAR_UI', false) || process.argv.includes('--pular-ui'),

  /** 'oficial' (padrão, 07h/17h, catálogo completo) ou 'vigilancia' (a cada 30min, subconjunto leve). */
  modoExecucao,

  rodada: opt('QA_RODADA', ''),
  timezone: 'America/Sao_Paulo',
  agente: 'Claudio Q.A. (automático)',

  /** Painel do suporte (Sentinela) linkado no botão "Ver detalhes" da notificação do Telegram. */
  painelUrl: opt('QA_PAINEL_URL', 'https://sentinela-hfsqj6konq-ue.a.run.app/'),
} as const;

export type Config = typeof cfg;

/** Lançado quando uma trava de segurança é violada. */
export class TravaDeSegurancaError extends Error {
  constructor(mensagem: string) {
    super(`TRAVA DE SEGURANÇA: ${mensagem}`);
    this.name = 'TravaDeSegurancaError';
  }
}

/** Um e-mail está na lista segura? */
export function ehEmailSeguro(email: unknown): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  return cfg.emailsSeguros.includes(e);
}

/**
 * Barra qualquer endereço fora da lista. Chamado antes de QUALQUER operação
 * que possa gerar e-mail (criar ticket, responder, finalizar, mesclar, CSAT).
 */
export function exigirEmailSeguro(email: unknown, contexto: string): string {
  const e = String(email ?? '').trim().toLowerCase();
  if (!ehEmailSeguro(e)) {
    throw new TravaDeSegurancaError(
      `${contexto}: o endereço "${e || '(vazio)'}" não está na lista de e-mails seguros ` +
        `(QA_EMAIL_ALLOWLIST). Operação abortada para não atingir cliente real.`,
    );
  }
  return e;
}

/** Valida a configuração antes de a rodada começar. Lança se algo põe cliente em risco. */
export function validarConfig(): void {
  if (!cfg.baseUrl) throw new Error('Variável obrigatória ausente: QA_BASE_URL');

  if (cfg.emailsSeguros.length === 0) {
    throw new TravaDeSegurancaError(
      'QA_EMAIL_ALLOWLIST está vazia. Sem lista de e-mails seguros o agente não roda.',
    );
  }

  if (!cfg.somenteLeitura) {
    if (!cfg.cpfQa || cfg.cpfQa.length !== 11) {
      throw new TravaDeSegurancaError(
        'QA_CLIENT_CPF precisa ter 11 dígitos — é o CPF fictício dos tickets de teste.',
      );
    }
    if (CPFS_PROIBIDOS.has(cfg.cpfQa)) {
      throw new TravaDeSegurancaError(
        `QA_CLIENT_CPF ${cfg.cpfQa} é um CPF de seed que o backend apaga em todo boot. Use outro.`,
      );
    }
    if (!cfg.inboundQaTesteSecret) {
      throw new Error(
        'Variável obrigatória ausente: QA_INBOUND_QA_TESTE_SECRET (necessária para criar ticket de teste).',
      );
    }
  }
}

export { req, opt, bool };
