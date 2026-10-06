/**
 * placeholders.util v1.0.0 — catálogo único de placeholders para e-mails de saída e
 * prompts de workflow (nome do cliente, nome do agente, número/produto do ticket, datas)
 */
import type { IChamadoN1 } from '../models/ChamadoN1';
import { resolveClientGreetingName } from './clientMessageEnvelope.service';
import { findClienteByEmail, getPrimaryDados, loadDadosForRef } from './cliente.service';
import { resolveResponsavelDisplayNameSync } from './responsavel.util';

export type PlaceholderKey =
  | 'nomeCliente'
  | 'nomeAgente'
  | 'numeroTicket'
  | 'produtoTicket'
  | 'dataAbertura'
  | 'dataAtual';

export interface PlaceholderCatalogItem {
  key: PlaceholderKey;
  /** Token canônico inserido pelo seletor de placeholders na UI. */
  token: string;
  /** Rótulo exibido no seletor. */
  label: string;
  /** Token canônico + sinônimos legados já usados em conteúdo salvo. */
  aliases: RegExp[];
}

/**
 * Gera as variantes de um mesmo nome de placeholder nos 3 formatos já vistos em conteúdo
 * salvo: {{duplo}}, [colchete] e {simples} — nessa ordem, porque {simples} bate como
 * substring dentro de {{duplo}} (a regex de chave simples casaria só o miolo e deixaria uma
 * chave sobrando de cada lado); rodando a variante de duplo/colchete primeiro, ela consome o
 * token inteiro antes que a de chave simples tenha chance de casar parcialmente.
 */
function placeholderAliases(...names: string[]): RegExp[] {
  const aliases: RegExp[] = [];
  for (const name of names) {
    aliases.push(new RegExp(`\\{\\{${name}\\}\\}`, 'gi'));
    aliases.push(new RegExp(`\\[${name}\\]`, 'gi'));
  }
  for (const name of names) {
    aliases.push(new RegExp(`\\{${name}\\}`, 'gi'));
  }
  return aliases;
}

export const PLACEHOLDER_CATALOG: PlaceholderCatalogItem[] = [
  {
    key: 'nomeCliente',
    token: '{nomeCliente}',
    label: 'Nome do cliente',
    aliases: placeholderAliases('client_name', 'nome_cliente', 'nomeCliente', 'cliente', 'nome'),
  },
  {
    key: 'nomeAgente',
    token: '{nomeAgente}',
    label: 'Nome do agente responsável',
    aliases: placeholderAliases('nomeAgente', 'nome_agente', 'agente'),
  },
  {
    key: 'numeroTicket',
    token: '{numeroTicket}',
    label: 'Número do ticket',
    aliases: placeholderAliases('numeroTicket', 'numero_ticket', 'protocolo'),
  },
  {
    key: 'produtoTicket',
    token: '{produtoTicket}',
    label: 'Produto do ticket',
    aliases: placeholderAliases('produtoTicket', 'produto_ticket', 'produto'),
  },
  {
    key: 'dataAbertura',
    token: '{dataAbertura}',
    label: 'Data de abertura do ticket',
    aliases: placeholderAliases('dataAbertura', 'data_abertura'),
  },
  {
    key: 'dataAtual',
    token: '{dataAtual}',
    label: 'Data atual',
    aliases: placeholderAliases('dataAtual', 'data_atual'),
  },
];

export type TicketPlaceholderValues = Record<PlaceholderKey, string>;

function formatBrDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(parsed);
}

function firstRegistroEmailInboundSender(chamado: IChamadoN1): string {
  const first = chamado.registro?.[0];
  const meta = (first?.metadados && typeof first.metadados === 'object' ? first.metadados : {}) as Record<string, unknown>;
  if (String(meta.source ?? '').trim().toLowerCase() !== 'email-inbound') return '';
  const from = String(meta.emailFrom ?? '').trim().toLowerCase();
  return from.includes('@') ? from : '';
}

/**
 * Nome real do cliente — única fonte aceitável é o cadastro, nunca o assunto do e-mail ou a
 * tabulação (que já causou casos como "primeira palavra do assunto virou nome do cliente" e
 * o assunto-fallback "Atendimento por e-mail" virando nome "Atendimento"). Ordem:
 * 1. Cadastro já associado ao ticket (via CPF ou qualquer outro meio) — única referência aceitável
 *    quando presente.
 * 2. Ticket aberto por e-mail sem cadastro associado — busca o cadastro pelo e-mail do remetente
 *    da primeira mensagem.
 * 3. Nada encontrado — string vazia (o chamador usa "Cliente" literal, sem tentar mais nada).
 */
export async function resolveChamadoClientName(chamado: IChamadoN1): Promise<string> {
  const ref = chamado.cliente?.[0];
  if (ref) {
    // Cadastro já associado ao ticket — única referência aceitável enquanto existir vínculo,
    // mesmo que o cadastro em si esteja sem nome preenchido (não cai pro lookup por e-mail).
    const dados = await loadDadosForRef(ref);
    return String(dados?.clienteNome || '').trim();
  }

  const senderEmail = firstRegistroEmailInboundSender(chamado);
  if (!senderEmail) return '';

  const cliente = await findClienteByEmail(senderEmail);
  const dados = getPrimaryDados(cliente);
  return String(dados?.clienteNome || '').trim();
}

export async function buildTicketPlaceholderValues(
  chamado: IChamadoN1,
  opts: { clientName?: string } = {},
): Promise<TicketPlaceholderValues> {
  const tab = Array.isArray(chamado.tabulacao) ? chamado.tabulacao[chamado.tabulacao.length - 1] : null;
  const clientName = opts.clientName ?? await resolveChamadoClientName(chamado);
  return {
    // Sem nome resolvido, o placeholder vira string vazia — nunca o título genérico "Cliente"
    // (mesma regra da saudação em resolveTicketSaudacao, mas aqui vale pro corpo do e-mail
    // também, onde o admin pode ter inserido {nomeCliente} fora da linha de saudação).
    nomeCliente: clientName ? resolveClientGreetingName(clientName, '') : '',
    // resolveResponsavelDisplayNameSync troca pelo aliasColaborador quando preenchido — sem
    // isso o nome completo do atendente (gravado cru em tabulacao.responsavel em vários pontos
    // de escrita) vazava direto pra assinatura do e-mail enviado ao cliente.
    nomeAgente: resolveResponsavelDisplayNameSync(tab?.responsavel) || 'Atendimento Velotax',
    numeroTicket: String(chamado.chamadoProtocolo || '').trim(),
    produtoTicket: String(tab?.produto || '').trim(),
    dataAbertura: formatBrDate(chamado.createdAt),
    dataAtual: formatBrDate(new Date()),
  };
}

/** Troca os placeholders do catálogo (token canônico + aliases legados) pelos dados reais do ticket. */
export async function applyTicketPlaceholders(
  text: string,
  chamado: IChamadoN1,
  opts: { clientName?: string } = {},
): Promise<string> {
  const raw = String(text ?? '');
  if (!raw) return '';
  const values = await buildTicketPlaceholderValues(chamado, opts);
  return PLACEHOLDER_CATALOG.reduce(
    (acc, item) => item.aliases.reduce((inner, re) => inner.replace(re, values[item.key]), acc),
    raw,
  );
}

const NOME_CLIENTE_ALIASES = PLACEHOLDER_CATALOG.find((item) => item.key === 'nomeCliente')!.aliases;

/** Testa presença de um alias sem herdar o estado do `lastIndex` (aliases são regex globais). */
function containsAlias(text: string, aliases: RegExp[]): boolean {
  return aliases.some((re) => {
    re.lastIndex = 0;
    const found = re.test(text);
    re.lastIndex = 0;
    return found;
  });
}

/**
 * Aplica os placeholders na linha de saudação do e-mail padrão. Quando não há nome de cliente
 * disponível (cadastro sem nome ou nenhum cadastro associado), o template configurado — que
 * normalmente é algo como "Olá, {nome}, tudo bem?" — é descartado e substituído pela saudação
 * genérica "Oi, tudo bem?", seguindo direto para o corpo. Isso evita tanto vazar o placeholder
 * cru quanto usar o título "Cliente" como se fosse um nome.
 */
export async function resolveTicketSaudacao(
  saudacaoTemplate: string,
  chamado: IChamadoN1,
  opts: { clientName?: string } = {},
): Promise<string> {
  const raw = String(saudacaoTemplate ?? '').trim();
  if (!raw) return '';

  const clientName = opts.clientName ?? (await resolveChamadoClientName(chamado));
  if (!clientName && containsAlias(raw, NOME_CLIENTE_ALIASES)) {
    return 'Oi, tudo bem?';
  }

  return applyTicketPlaceholders(raw, chamado, { clientName });
}
