/**
 * chamadoExtrato.service v1.1.0 — extrato do ticket em HTML para impressão (Ctrl+P → Salvar como PDF),
 * no padrão do Octadesk. Usado em complementos judiciais, auditoria interna e envio de histórico
 * ao cliente. Filtros: Interações públicas / Anotações internas / Ações automáticas / Conversa WhatsApp
 * (cada mensagem do WhatsApp vira uma entrada própria, intercalada por data com o resto do histórico).
 * "Detalhamento das interações" e "Informações de SLA" chegam nas opções mas ainda não são renderizados (Fase 2).
 */
import { ChamadoN1 } from '../models/ChamadoN1';
import type { IChamadoN1 } from '../models/ChamadoN1';
import type { IRegistro } from '../models/shared/registro.schema';
import { getClienteModel } from '../models/Cliente';
import { htmlToPlainTextForEmail } from './emailHtml.util';
import { currentStatus } from './chamado.mapper';
import { readWhatsAppMensagens, WHATSAPP_THREAD_SOURCE } from './twilio/whatsappThread.service';

export interface ChamadoExtratoOptions {
  incluirPublicas: boolean;
  incluirInternas: boolean;
  incluirAutomaticas: boolean;
  /** Conversa do WhatsApp, mensagem a mensagem. Desligado = extrato só com as demais interações. */
  incluirWhatsapp: boolean;
  detalhamento: boolean;
  sla: boolean;
}

export class ChamadoExtratoError extends Error {
  code: 'NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'ChamadoExtratoError';
    this.code = 'NOT_FOUND';
  }
}

const TZ = 'America/Sao_Paulo';

const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  'em-andamento': 'Em andamento',
  'em-aberto': 'Em andamento',
  pendente: 'Pendente',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
  fechado: 'Fechado',
};

const AUTOMATIC_SOURCE_PREFIXES = ['workflow', 'agente_ia', 'roleta'];
/** Jobs agendados do backend (ex.: close-resolved-job) também são ações automáticas. */
const AUTOMATIC_SOURCE_SUFFIX = '-job';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCpf(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return String(value ?? '').trim();
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function toPlainText(raw: unknown): string {
  const withoutCode = String(raw ?? '').replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  return htmlToPlainTextForEmail(withoutCode).trim();
}

function attachmentName(url: string): string {
  const raw = String(url || '').split('?')[0];
  const last = raw.split('/').pop() || raw;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Regras do handoff (4.3): um registro pode ser público e interno ao mesmo tempo. */
export function classifyRegistro(reg: IRegistro) {
  const origin = String(reg.origin ?? '').trim().toLowerCase();
  const source = String((reg.metadados as Record<string, unknown> | undefined)?.source ?? '').trim().toLowerCase();
  const publica = Boolean(String(reg.mensagemPublica ?? '').trim()) && (origin === 'agente' || origin === 'cliente');
  const interna = Boolean(String(reg.anotacaoInterna ?? '').trim());
  const automatica = origin === 'sistema'
    || AUTOMATIC_SOURCE_PREFIXES.some((p) => source.startsWith(p))
    || source.endsWith(AUTOMATIC_SOURCE_SUFFIX);
  return { publica, interna, automatica };
}

interface ClienteResumo {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
}

async function loadClienteResumo(chamado: IChamadoN1): Promise<ClienteResumo> {
  const ref = chamado.cliente?.[0];
  const fallback: ClienteResumo = {
    nome: '',
    cpf: formatCpf(ref?.clienteCpf),
    email: '',
    telefone: '',
  };
  if (!ref?.clienteId) return fallback;
  try {
    const doc = await getClienteModel().findById(ref.clienteId).lean();
    const dados = doc?.clienteDados?.[0];
    if (!dados) return fallback;
    return {
      nome: String(dados.clienteNome ?? '').trim(),
      cpf: formatCpf(dados.clienteCpf || ref.clienteCpf),
      email: String(dados.clienteEmail?.resposta || dados.clienteEmail?.lista?.[0] || '').trim(),
      telefone: String(dados.clienteTelefone?.whatsapp || dados.clienteTelefone?.lista?.[0] || '').trim(),
    };
  } catch (err) {
    console.warn('[chamado-extrato] cadastro do cliente indisponível:', (err as Error).message);
    return fallback;
  }
}

function field(label: string, value: unknown): string {
  const text = String(value ?? '').trim();
  return `<div class="campo"><span class="campo__label">${escapeHtml(label)}</span><span class="campo__valor">${escapeHtml(text || '—')}</span></div>`;
}

function renderAnexos(urls: string[] | undefined): string {
  const list = (urls ?? []).filter(Boolean);
  if (!list.length) return '';
  return `<ul class="anexos">${list.map((u) => `<li>${escapeHtml(attachmentName(u))}</li>`).join('')}</ul>`;
}

function renderRegistro(reg: IRegistro, options: ChamadoExtratoOptions, clienteNome: string): string {
  const tipo = classifyRegistro(reg);
  const coveredByAutomatica = tipo.automatica && options.incluirAutomaticas;
  const hasPublicText = Boolean(String(reg.mensagemPublica ?? '').trim());
  // Ação automática mostra o que o cliente recebeu (ex.: e-mail automático de origem "sistema").
  const showPublica = hasPublicText && ((tipo.publica && options.incluirPublicas) || coveredByAutomatica);
  // Nota interna só sai com o filtro de anotações internas — nunca "de carona" numa ação automática,
  // para não vazar nota interna num extrato enviado ao cliente.
  const showInterna = tipo.interna && options.incluirInternas;
  const showAutomaticaVazia = coveredByAutomatica && !showPublica && !showInterna;
  if (!showPublica && !showInterna && !showAutomaticaVazia) return '';

  const origin = String(reg.origin ?? '').trim().toLowerCase();
  const quem = origin === 'cliente' ? 'Cliente' : origin === 'sistema' ? 'Sistema' : 'Atendente';
  // O extrato não identifica o atendente pelo nome — só o papel.
  const autor = origin === 'cliente'
    ? String(reg.autor ?? '').trim() || clienteNome || 'Cliente'
    : quem;
  // Cinza só quando o filtro de ações automáticas está ligado; senão o registro aparece pelo outro tipo.
  const kind = coveredByAutomatica ? 'automatica' : showPublica ? 'publica' : 'interna';
  const kindLabel = kind === 'automatica' ? 'Ação automática' : kind === 'publica' ? 'Interação pública' : 'Anotação interna';
  const papel = origin === 'cliente' ? ' <span class="registro__papel">(Cliente)</span>' : '';

  const partes: string[] = [];
  if (showPublica) {
    partes.push(`<div class="registro__texto">${escapeHtml(toPlainText(reg.mensagemPublica))}</div>${renderAnexos(reg.anexosMensagemPublica)}`);
  }
  if (showInterna) {
    const texto = `<div class="registro__texto">${escapeHtml(toPlainText(reg.anotacaoInterna))}</div>${renderAnexos(reg.anexosAnotacaoInterna)}`;
    partes.push(showPublica || kind === 'automatica'
      ? `<div class="registro__nota"><span class="registro__nota-label">Anotação interna</span>${texto}</div>`
      : texto);
  }
  if (showAutomaticaVazia) {
    const status = STATUS_LABELS[String(reg.status ?? '').toLowerCase()] || reg.status || '';
    partes.push(`<div class="registro__texto registro__texto--muted">${escapeHtml(status ? `Status: ${status}` : 'Ação registrada pelo sistema.')}</div>`);
  }

  return `<article class="registro registro--${kind}">
  <header class="registro__head">
    <span class="registro__tipo">${escapeHtml(kindLabel)}</span>
    <span class="registro__autor">${escapeHtml(autor)}${papel}</span>
    <time class="registro__data">${escapeHtml(formatDateTime(reg.data))}</time>
  </header>
  ${partes.join('\n')}
</article>`;
}

const WA_DELIVERY_LABELS: Record<string, string> = {
  queued: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falha na entrega',
  undelivered: 'Falha na entrega',
};

/**
 * Registro que pertence ao WhatsApp: a thread (mensagens em metadados.whatsappMensagens) ou um
 * registro avulso de formato antigo (channel whatsapp / waFrom). Fica fora do extrato quando o
 * filtro de WhatsApp está desligado — senão apareceria misturado como interação pública.
 */
function isWhatsAppRegistro(reg: IRegistro): boolean {
  const meta = (reg.metadados ?? {}) as Record<string, unknown>;
  return String(meta.source ?? '') === WHATSAPP_THREAD_SOURCE
    || String(meta.channel ?? '').toLowerCase() === 'whatsapp'
    || Boolean(String(meta.waFrom ?? '').trim());
}

interface ExtratoEntry {
  data: number;
  html: string;
}

function toTime(value: unknown): number {
  const t = new Date(value as string).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function renderWhatsAppEntry(input: {
  data: unknown;
  origin: string;
  autor: string;
  texto: string;
  anexos: string[];
  deliveryStatus?: string;
  transcriptionText?: string;
}, clienteNome: string): string {
  const isCliente = input.origin === 'cliente';
  // O extrato não identifica o atendente pelo nome — só o papel.
  const autor = isCliente ? input.autor || clienteNome || 'Cliente' : 'Atendente';
  const status = !isCliente && input.deliveryStatus ? WA_DELIVERY_LABELS[input.deliveryStatus] : '';
  const texto = input.texto
    ? `<div class="registro__texto">${escapeHtml(toPlainText(input.texto))}</div>`
    : '';
  const transcricao = input.transcriptionText
    ? `<div class="registro__nota registro__nota--wa"><span class="registro__nota-label">Transcrição do áudio</span><div class="registro__texto">${escapeHtml(input.transcriptionText)}</div></div>`
    : '';
  return `<article class="registro registro--whatsapp">
  <header class="registro__head">
    <span class="registro__tipo">WhatsApp</span>
    <span class="registro__autor">${escapeHtml(autor)}${isCliente ? ' <span class="registro__papel">(Cliente)</span>' : ''}</span>
    ${status ? `<span class="registro__papel">${escapeHtml(status)}</span>` : ''}
    <time class="registro__data">${escapeHtml(formatDateTime(input.data))}</time>
  </header>
  ${texto}${renderAnexos(input.anexos)}${transcricao}
</article>`;
}

/** Uma entrada por mensagem do WhatsApp (thread nova ou registro avulso antigo). */
function whatsAppEntries(reg: IRegistro, clienteNome: string): ExtratoEntry[] {
  const meta = (reg.metadados ?? {}) as Record<string, unknown>;
  if (String(meta.source ?? '') === WHATSAPP_THREAD_SOURCE) {
    return readWhatsAppMensagens(reg).map((msg) => ({
      data: toTime(msg.data),
      html: renderWhatsAppEntry({
        data: msg.data,
        origin: msg.origin,
        autor: msg.autor,
        texto: msg.texto,
        anexos: msg.anexos,
        deliveryStatus: msg.deliveryStatus,
        transcriptionText: msg.transcriptionText,
      }, clienteNome),
    }));
  }
  const texto = String(reg.mensagemPublica ?? '').trim();
  const anexos = (reg.anexosMensagemPublica ?? []).filter(Boolean);
  if (!texto && !anexos.length) return [];
  return [{
    data: toTime(reg.data),
    html: renderWhatsAppEntry({
      data: reg.data,
      origin: String(reg.origin ?? '').trim().toLowerCase() === 'cliente' ? 'cliente' : 'agente',
      autor: String(reg.autor ?? '').trim(),
      texto,
      anexos,
    }, clienteNome),
  }];
}

export async function findChamadoForExtrato(protocolo: string): Promise<IChamadoN1> {
  const value = String(protocolo ?? '').trim();
  if (!value) throw new ChamadoExtratoError('Protocolo não informado.');
  const chamado = await ChamadoN1.findOne({ chamadoProtocolo: value });
  if (!chamado) throw new ChamadoExtratoError(`Ticket ${value} não encontrado.`);
  return chamado;
}

export async function renderChamadoExtrato(
  chamado: IChamadoN1,
  options: ChamadoExtratoOptions,
  geradoPor: string,
): Promise<string> {
  const cliente = await loadClienteResumo(chamado);
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  const clienteNome = cliente.nome || 'Cliente';
  const status = STATUS_LABELS[currentStatus(chamado)] || currentStatus(chamado) || '—';

  const entries: ExtratoEntry[] = [];
  for (const reg of chamado.registro ?? []) {
    if (isWhatsAppRegistro(reg)) {
      if (options.incluirWhatsapp) entries.push(...whatsAppEntries(reg, clienteNome));
      continue;
    }
    const html = renderRegistro(reg, options, clienteNome);
    if (html) entries.push({ data: toTime(reg.data), html });
  }
  // sort estável: empate de horário mantém a ordem original (thread do WhatsApp já vem cronológica)
  const registros = entries.sort((a, b) => a.data - b.data).map((entry) => entry.html);

  const filtros = [
    options.incluirPublicas ? 'Interações públicas' : null,
    options.incluirInternas ? 'Anotações internas' : null,
    options.incluirAutomaticas ? 'Ações automáticas' : null,
    options.incluirWhatsapp ? 'Conversa WhatsApp' : null,
  ].filter(Boolean).join(' · ') || 'nenhum';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`Extrato do atendimento - ${clienteNome}`)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html { background: #EEF0F6; }
  body { margin: 0; font: 12px/1.5 'Poppins', 'Segoe UI', Arial, sans-serif; color: #111827; }
  .barra { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 24px; background: #000058; color: #fff; }
  .barra strong { font-size: 13px; }
  .barra small { display: block; font-size: 12px; opacity: .85; }
  .barra kbd { padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,.16); font: inherit; }
  .barra button { padding: 8px 14px; border: 0; border-radius: 6px; background: #fff; color: #000058; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .folha { max-width: 210mm; margin: 24px auto; padding: 18mm 16mm; background: #fff; box-shadow: 0 2px 14px rgba(0,0,88,.1); overflow-wrap: anywhere; }
  .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #000058; }
  .cabecalho h1 { margin: 0; font-size: 18px; color: #000058; }
  .cabecalho p { margin: 2px 0 0; color: #4b5563; }
  .cabecalho .marca { font-weight: 700; color: #000058; white-space: nowrap; }
  h2 { margin: 18px 0 8px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #000058; }
  .dados { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; }
  .campo { display: flex; flex-direction: column; min-width: 0; }
  .campo__label { font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #6b7280; }
  .campo__valor { word-break: break-word; }
  .filtros { margin: 0 0 10px; font-size: 10.5px; color: #6b7280; }
  .registro { margin-bottom: 8px; padding: 8px 10px; border: 1px solid #E5E7EB; border-radius: 6px; page-break-inside: avoid; break-inside: avoid; }
  .registro--publica { border-left: 3px solid #8A9BD6; }
  .registro--interna { border-left: 3px solid #E5B700; background: #FFFBEB; }
  .registro--automatica { border-left: 3px solid #9CA3AF; background: #F3F4F6; color: #374151; }
  .registro--whatsapp { border-left: 3px solid #25D366; background: #F0FBF4; }
  .registro__nota--wa { background: #fff; border-color: #A7E8BF; }
  .registro__nota--wa .registro__nota-label { color: #166534; }
  .registro__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 4px; font-size: 10.5px; }
  .registro__tipo { padding: 0 6px; border-radius: 3px; background: rgba(0,0,0,.06); font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #4b5563; }
  .registro__autor { font-weight: 600; color: #111827; }
  .registro__papel { font-weight: 400; color: #6b7280; }
  .registro__data { margin-left: auto; color: #6b7280; font-variant-numeric: tabular-nums; }
  .registro__texto { white-space: pre-wrap; word-break: break-word; }
  .registro__texto--muted { color: #6b7280; font-style: italic; }
  .registro__nota { margin-top: 6px; padding: 6px 8px; border-radius: 4px; background: #FFFBEB; border: 1px dashed #F5D565; }
  .registro__nota-label { display: block; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #92400E; }
  .anexos { margin: 6px 0 0; padding-left: 16px; font-size: 10.5px; color: #4b5563; }
  .vazio { color: #6b7280; }
  .rodape { margin-top: 18px; padding-top: 8px; border-top: 1px solid #E5E7EB; font-size: 10px; color: #6b7280; }
  @media print {
    html { background: #fff; }
    .barra { display: none; }
    .folha { max-width: none; margin: 0; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="barra" role="region" aria-label="Ações do extrato">
    <div><strong>Extrato do atendimento</strong><small>Para gerar o PDF: <kbd>Ctrl</kbd> + <kbd>P</kbd> → destino "Salvar como PDF".</small></div>
    <button type="button" onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>
  <main class="folha">
    <header class="cabecalho">
      <div>
        <h1>Extrato do atendimento</h1>
        <p>${escapeHtml(chamado.chamadoTitulo || '')}</p>
      </div>
      <span class="marca">Velotax · VeloDesk</span>
    </header>

    <h2>Dados do chamado</h2>
    <section class="dados">
      ${field('Cliente', clienteNome)}
      ${field('CPF', cliente.cpf)}
      ${field('E-mail', cliente.email)}
      ${field('Telefone', cliente.telefone)}
      ${field('Status', status)}
      ${field('Aberto em', formatDateTime(chamado.createdAt))}
      ${field('Canal', tab?.canal)}
      ${field('Tipo', tab?.tipoChamado)}
      ${field('Produto', tab?.produto)}
      ${field('Motivo', tab?.motivo)}
      ${field('Detalhe', tab?.detalhe)}
    </section>

    <h2>Histórico</h2>
    <p class="filtros">Filtros: ${escapeHtml(filtros)}</p>
    ${registros.length ? registros.join('\n') : '<p class="vazio">Nenhum registro para os filtros selecionados.</p>'}

    <footer class="rodape">Extrato gerado em ${escapeHtml(formatDateTime(new Date()))} por ${escapeHtml(geradoPor || '—')} · ${registros.length} registro(s)</footer>
  </main>
</body>
</html>`;
}
