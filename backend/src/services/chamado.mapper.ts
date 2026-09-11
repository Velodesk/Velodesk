/** chamado.mapper v2.16.2 — buildResponsavelCandidates inclui alias/nome resolvido do colaborador */
import mongoose from 'mongoose';
import type { AuthPayload } from '../middleware/auth';
import type { IChamadoN1, IRegistro, ITabulacao, IClienteRef } from '../models/ChamadoN1';
import {
  batchLoadDadosForRefs,
  loadDadosForRef,
  normalizeCpf,
  resolveClienteRefFromBody,
  resolveDadosFromBatch,
  type ClienteDadosBatchContext,
} from './cliente.service';
import { allocateNextProtocolo } from './protocolo.service';
import type { IClienteDados } from '../models/Cliente';
import type { IWorkflowDefinicao } from '../models/WorkflowDefinicao';
import { assertTabulacaoForStatus } from './tabulation.service';
import { buildLateralWorkflowDto, loadWorkflowDefForChamado, syncLegacyWorkflowFromBody } from './workflowDto.util';
import { buildComunicacaoResumo } from './workflowRequisicao.service';
import type { IChamadoWorkflowComunicacaoResumo } from '../config/workflowRequisicaoDefaults';
import { getWorkflowsByIds } from './workflowDefinicao.service';
import { extractEmailReplyContent } from './emailReplyContent.util';
import { sanitizeResponsavel, inferResponsavelFromAgentRegistro, isRealResponsavel, resolveResponsavelDisplayNameSync, normalizeResponsavelForStorage } from './responsavel.util';
import { decodeBasicHtmlEntities } from './emailHtml.util';
import { filterRealAttachmentUrls } from './attachmentFilter.util';
import { parseInboundAttachmentStorageKeyFromApiUrl } from './inboundAttachmentStorage.service';
import { enrichTicketAttachmentScanStatuses } from './attachmentScanStatus.service';
import { excludeFusaoAbsorvidosFilter, serializeFusaoDto } from './ticketFusao.helpers';
import {
  readWhatsAppMensagens,
  WHATSAPP_THREAD_SOURCE,
} from './twilio/whatsappThread.service';
import { hasPersistedWorkflowSnapshot, markWorkflowCancelledOnTicketClose } from './workflowStatus.util';

function normalizeTicketMessageText(raw: string): string {
  return decodeBasicHtmlEntities(String(raw ?? '').trim());
}

export type RegistroOrigin = 'agente' | 'cliente';

export interface TicketMessageDto {
  id?: string;
  text: string;
  sender: string;
  origin?: RegistroOrigin;
  author?: string;
  registroIndex?: number;
  type?: string;
  channel?: string;
  deliveryStatus?: string;
  deliveryErrorMessage?: string;
  mediaContentTypes?: string[];
  transcriptionStatus?: string;
  time: Date;
  attachments?: string[];
  attachmentScanStatuses?: string[];
}

const TABULACAO_TRACKED_FIELDS: (keyof ITabulacao)[] = [
  'tipoChamado',
  'produto',
  'motivo',
  'detalhe',
  'responsavel',
  'atribuido',
];

function legacyAlteracoesObject(reg: IRegistro): Record<string, unknown> | null {
  const alt = reg.alteracoes as unknown;
  if (alt && !Array.isArray(alt) && typeof alt === 'object') {
    return alt as Record<string, unknown>;
  }
  return null;
}

function scanStatusFromMap(map: Map<string, string>, url: string): string {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/\/(?:api\/)?uploads\/sent\//i.test(u)) return 'skipped';
  if (map.has(u)) return map.get(u) || '';
  const parsed = parseInboundAttachmentStorageKeyFromApiUrl(u);
  if (parsed && map.has(`sk:${parsed}`)) return map.get(`sk:${parsed}`) || '';
  return '';
}

function scanStatusesAlignedToUrls(urls: string[], sourceUrls: string[], sourceStatuses?: string[]): string[] | undefined {
  if (!urls.length) return undefined;
  const map = new Map<string, string>();
  (sourceUrls || []).forEach((url, index) => {
    const key = String(url || '').trim();
    if (!key) return;
    const status = String(sourceStatuses?.[index] || '');
    map.set(key, status);
    const parsed = parseInboundAttachmentStorageKeyFromApiUrl(key);
    if (parsed) map.set(`sk:${parsed}`, status);
  });
  const aligned = urls.map((url) => scanStatusFromMap(map, url));
  return aligned.some(Boolean) ? aligned : undefined;
}

function scanStatusesForPublicAttachments(reg: IRegistro): string[] | undefined {
  const urls = filterRealAttachmentUrls(reg.anexosMensagemPublica);
  const meta = registroMetadados(reg);
  const items = Array.isArray(meta.emailAttachments) ? meta.emailAttachments : [];
  const map = new Map<string, string>();
  items.forEach((raw) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!item) return;
    let status = String(item.scanStatus || '').trim();
    // Mensagem do agente/sistema: pending legado → skipped (outbound sem antivírus)
    const originRaw = String(reg.origin || '').trim().toLowerCase();
    if ((originRaw === 'agente' || originRaw === 'sistema') && status === 'pending') {
      status = 'skipped';
    }
    const url = String(item.url || '').trim();
    const storageKey = String(item.storageKey || '').trim();
    if (url) map.set(url, status);
    if (storageKey) map.set(`sk:${storageKey}`, status);
  });
  const aligned = urls.map((url) => {
    const fromMeta = scanStatusFromMap(map, url);
    if (fromMeta) return fromMeta;
    const originRaw = String(reg.origin || '').trim().toLowerCase();
    if (originRaw === 'agente' || originRaw === 'sistema') return 'skipped';
    return '';
  });
  return aligned.some(Boolean) ? aligned : undefined;
}

/** E-mail automático (padrão/CSAT) — sai da aba Conversa e vira evento na aba Eventos. */
function isAutomaticEmailRegistro(reg: IRegistro, meta: Record<string, unknown>): boolean {
  return String(reg.autor || '').trim().toLowerCase() === 'e-mail padrão'
    || Boolean(meta.emailPadraoId);
}

function registroMetadados(reg: IRegistro): Record<string, unknown> {
  if (reg.metadados && typeof reg.metadados === 'object' && !Array.isArray(reg.metadados)) {
    return reg.metadados;
  }
  const legacy = legacyAlteracoesObject(reg);
  if (legacy && (legacy.emailMessageId || legacy.source === 'email-inbound')) {
    return legacy;
  }
  return {};
}

function readProconFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const pc = lf.procon;
  if (pc && typeof pc === 'object' && !Array.isArray(pc)) {
    return pc as Record<string, unknown>;
  }
  return null;
}

export function findProconFromChamado(chamado: IChamadoN1): Record<string, unknown> | null {
  for (const reg of chamado.registro ?? []) {
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '').toLowerCase() === 'procon') {
      const nested = meta.procon;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
      return meta;
    }
  }
  return null;
}

function normalizeCanalValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isProconCanalFromBody(body: Record<string, unknown>): boolean {
  if (readProconFromBody(body)) return true;
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  if (normalizeCanalValue(lf.canal).includes('procon')) return true;
  const channel = normalizeCanalValue(body.channel ?? body.source);
  return channel === 'procon';
}

export function isProconChamado(chamado: IChamadoN1): boolean {
  return Boolean(findProconFromChamado(chamado));
}

function buildMinimalProconMeta(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
): Record<string, unknown> {
  const lf = (body?.lateralForm ?? {}) as Record<string, unknown>;
  const existing = readProconFromBody(body ?? {}) || findProconFromChamado(chamado);
  if (existing) return existing;
  const tab = readTabulacaoSnapshot(chamado.tabulacao?.[0]);
  return {
    protocoloProcon: String(chamado.chamadoProtocolo ?? '').trim() || undefined,
    consumidor: String(body?.clientName ?? tab.motivo ?? chamado.chamadoTitulo ?? '').trim(),
    assunto: String(chamado.chamadoTitulo ?? body?.title ?? '').trim(),
    descricao: String(body?.text ?? body?.description ?? '').trim(),
    cpf: String(lf.cpf ?? lf.clienteCpf ?? body?.clientCPF ?? '').trim(),
    produto: tab.produto,
    tipo: tab.tipoChamado,
    motivo: tab.motivo,
    statusPc: 'nao-respondida',
  };
}

function ensureProconChannelStamp(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
  status = 'novo',
): void {
  if (findProconFromChamado(chamado)) return;
  if (body && !isProconCanalFromBody(body)) return;

  const pcMeta = buildMinimalProconMeta(chamado, body);
  const metadados: Record<string, unknown> = { source: 'procon', procon: pcMeta };
  const registro = chamado.registro ?? [];
  const targetStatus = currentStatus(chamado) || status;
  const clienteIdx = registro.findIndex((reg) => String(reg.origin ?? '').toLowerCase() === 'cliente');

  if (clienteIdx >= 0) {
    const reg = registro[clienteIdx];
    const existingMeta = registroMetadados(reg);
    if (String(existingMeta.source ?? '').toLowerCase() !== 'procon') {
      reg.metadados = { ...existingMeta, ...metadados };
    }
    return;
  }

  registro.unshift({
    data: new Date(),
    origin: 'cliente',
    autor: String(body?.clientName ?? chamado.chamadoTitulo ?? 'Consumidor').trim() || 'Consumidor',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados,
    status: targetStatus,
  });
  chamado.registro = registro;
}

function readConsumidorGovFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const gov = lf.consumidorGov;
  if (gov && typeof gov === 'object' && !Array.isArray(gov)) {
    return gov as Record<string, unknown>;
  }
  return null;
}

export function findConsumidorGovFromChamado(chamado: IChamadoN1): Record<string, unknown> | null {
  for (const reg of chamado.registro ?? []) {
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '').toLowerCase() === 'consumidor-gov') {
      const nested = meta.consumidorGov;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
      return meta;
    }
  }
  return null;
}

function isConsumidorGovCanalFromBody(body: Record<string, unknown>): boolean {
  if (readConsumidorGovFromBody(body)) return true;
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const canal = normalizeCanalValue(lf.canal);
  if (canal.includes('consumidor') && canal.includes('gov')) return true;
  const channel = normalizeCanalValue(body.channel ?? body.source);
  return channel === 'consumidor-gov' || channel === 'consumidorgov';
}

export function isConsumidorGovChamado(chamado: IChamadoN1): boolean {
  return Boolean(findConsumidorGovFromChamado(chamado));
}

export function proconChannelMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { 'registro.metadados.source': 'procon' },
      { 'registro.metadados.procon': { $exists: true, $ne: null } },
    ],
  };
}

export function consumidorGovChannelMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { 'registro.metadados.source': 'consumidor-gov' },
      { 'registro.metadados.consumidorGov': { $exists: true, $ne: null } },
    ],
  };
}

export function reclameAquiChannelMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { 'registro.metadados.source': 'reclame-aqui' },
      { 'registro.metadados.reclameAqui': { $exists: true, $ne: null } },
    ],
  };
}

/**
 * Checagem em memória (documento já carregado) equivalente a reclameAquiChannelMongoFilter —
 * usada pra decisões em runtime (ex.: suprimir e-mail de saída) sem nova query. Reclame Aqui
 * não tem outbound de e-mail — todo o contato real acontece por fora do Velodesk (plataforma RA/
 * WhatsApp); o compose desse canal só registra histórico pra acompanhamento interno.
 */
export function isReclameAquiChamado(chamado: IChamadoN1): boolean {
  return (chamado.registro ?? []).some((reg) => {
    const meta = reg.metadados;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
    const m = meta as Record<string, unknown>;
    return m.source === 'reclame-aqui' || (m.reclameAqui != null && typeof m.reclameAqui === 'object');
  });
}

export function excludeEspeciaisChannelsMongoFilter(): Record<string, unknown> {
  return {
    $nor: [
      proconChannelMongoFilter(),
      consumidorGovChannelMongoFilter(),
      reclameAquiChannelMongoFilter(),
      bacenChannelMongoFilter(),
    ],
  };
}

function buildMinimalConsumidorGovMeta(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
): Record<string, unknown> {
  const lf = (body?.lateralForm ?? {}) as Record<string, unknown>;
  const existing = readConsumidorGovFromBody(body ?? {}) || findConsumidorGovFromChamado(chamado);
  if (existing) return existing;
  const tab = readTabulacaoSnapshot(chamado.tabulacao?.[0]);
  return {
    protocoloGov: String(chamado.chamadoProtocolo ?? '').trim() || undefined,
    consumidor: String(body?.clientName ?? tab.motivo ?? chamado.chamadoTitulo ?? '').trim(),
    assunto: String(chamado.chamadoTitulo ?? body?.title ?? '').trim(),
    descricao: String(body?.text ?? body?.description ?? '').trim(),
    cpf: String(lf.cpf ?? lf.clienteCpf ?? body?.clientCPF ?? '').trim(),
    produto: tab.produto,
    tipo: tab.tipoChamado,
    motivo: tab.motivo,
    statusGov: 'nao-respondida',
  };
}

function ensureConsumidorGovChannelStamp(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
  status = 'novo',
): void {
  if (findConsumidorGovFromChamado(chamado)) return;
  if (body && !isConsumidorGovCanalFromBody(body)) return;

  const govMeta = buildMinimalConsumidorGovMeta(chamado, body);
  const metadados: Record<string, unknown> = { source: 'consumidor-gov', consumidorGov: govMeta };
  const registro = chamado.registro ?? [];
  const targetStatus = currentStatus(chamado) || status;
  const clienteIdx = registro.findIndex((reg) => String(reg.origin ?? '').toLowerCase() === 'cliente');

  if (clienteIdx >= 0) {
    const reg = registro[clienteIdx];
    const existingMeta = registroMetadados(reg);
    if (String(existingMeta.source ?? '').toLowerCase() !== 'consumidor-gov') {
      reg.metadados = { ...existingMeta, ...metadados };
    }
    return;
  }

  registro.unshift({
    data: new Date(),
    origin: 'cliente',
    autor: String(body?.clientName ?? chamado.chamadoTitulo ?? 'Consumidor').trim() || 'Consumidor',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados,
    status: targetStatus,
  });
  chamado.registro = registro;
}

function readBacenFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const bc = lf.bacen;
  if (bc && typeof bc === 'object' && !Array.isArray(bc)) {
    return bc as Record<string, unknown>;
  }
  return null;
}

export function findBacenFromChamado(chamado: IChamadoN1): Record<string, unknown> | null {
  for (const reg of chamado.registro ?? []) {
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '').toLowerCase() === 'bacen') {
      const nested = meta.bacen;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
      return meta;
    }
  }
  return null;
}

function isBacenCanalFromBody(body: Record<string, unknown>): boolean {
  if (readBacenFromBody(body)) return true;
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  if (normalizeCanalValue(lf.canal).includes('bacen')) return true;
  const channel = normalizeCanalValue(body.channel ?? body.source);
  return channel === 'bacen';
}

export function isBacenChamado(chamado: IChamadoN1): boolean {
  return Boolean(findBacenFromChamado(chamado));
}

/** Ticket de canal especial (RA, Procon, Consumidor.gov, BACEN) — sem e-mails padrão automáticos. */
export function isEspeciaisChamado(chamado: IChamadoN1): boolean {
  return isProconChamado(chamado)
    || isConsumidorGovChamado(chamado)
    || isBacenChamado(chamado)
    || Boolean(findReclameAquiFromChamado(chamado));
}

export function bacenChannelMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { 'registro.metadados.source': 'bacen' },
      { 'registro.metadados.bacen': { $exists: true, $ne: null } },
    ],
  };
}

function buildMinimalBacenMeta(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
): Record<string, unknown> {
  const lf = (body?.lateralForm ?? {}) as Record<string, unknown>;
  const existing = readBacenFromBody(body ?? {}) || findBacenFromChamado(chamado);
  if (existing) return existing;
  const tab = readTabulacaoSnapshot(chamado.tabulacao?.[0]);
  return {
    protocoloBacen: String(chamado.chamadoProtocolo ?? '').trim() || undefined,
    consumidor: String(body?.clientName ?? tab.motivo ?? chamado.chamadoTitulo ?? '').trim(),
    assunto: String(chamado.chamadoTitulo ?? body?.title ?? '').trim(),
    descricao: String(body?.text ?? body?.description ?? '').trim(),
    cpf: String(lf.cpf ?? lf.clienteCpf ?? body?.clientCPF ?? '').trim(),
    produto: tab.produto,
    tipo: tab.tipoChamado,
    motivo: tab.motivo,
    statusBc: 'nao-respondida',
  };
}

function ensureBacenChannelStamp(
  chamado: IChamadoN1,
  body?: Record<string, unknown>,
  status = 'novo',
): void {
  if (findBacenFromChamado(chamado)) return;
  if (body && !isBacenCanalFromBody(body)) return;

  const bcMeta = buildMinimalBacenMeta(chamado, body);
  const metadados: Record<string, unknown> = { source: 'bacen', bacen: bcMeta };
  const registro = chamado.registro ?? [];
  const targetStatus = currentStatus(chamado) || status;
  const clienteIdx = registro.findIndex((reg) => String(reg.origin ?? '').toLowerCase() === 'cliente');

  if (clienteIdx >= 0) {
    const reg = registro[clienteIdx];
    const existingMeta = registroMetadados(reg);
    if (String(existingMeta.source ?? '').toLowerCase() !== 'bacen') {
      reg.metadados = { ...existingMeta, ...metadados };
    }
    return;
  }

  registro.unshift({
    data: new Date(),
    origin: 'cliente',
    autor: String(body?.clientName ?? chamado.chamadoTitulo ?? 'Consumidor').trim() || 'Consumidor',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados,
    status: targetStatus,
  });
  chamado.registro = registro;
}

function readReclameAquiFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const ra = lf.reclameAqui;
  if (ra && typeof ra === 'object' && !Array.isArray(ra)) {
    return ra as Record<string, unknown>;
  }
  return null;
}

export function findReclameAquiFromChamado(chamado: IChamadoN1): Record<string, unknown> | null {
  for (const reg of chamado.registro ?? []) {
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '').toLowerCase() === 'reclame-aqui') {
      const nested = meta.reclameAqui;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
      return meta;
    }
  }
  return null;
}

/** Não reidrata lateralForm.workflow de histórico — evita bloquear novo start após interrupção. */
function findLatestWorkflowFromRegistro(_chamado: IChamadoN1): Record<string, unknown> | null {
  return null;
}

function findLatestApprovalFromRegistro(chamado: IChamadoN1): Record<string, unknown> | null {
  const registros = chamado.registro ?? [];
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    const meta = registroMetadados(registros[i]);
    const approval = meta.approval;
    if (approval && typeof approval === 'object' && !Array.isArray(approval)) {
      return approval as Record<string, unknown>;
    }
  }
  return null;
}

export function resolveRegistroOrigin(reg: IRegistro): RegistroOrigin {
  const stored = String(reg.origin ?? '').trim().toLowerCase();
  if (stored === 'agente' || stored === 'cliente') return stored;

  const meta = registroMetadados(reg);
  if (String(meta.source ?? '').toLowerCase() === 'email-inbound') return 'cliente';
  if (String(meta.source ?? '').toLowerCase() === 'reclame-aqui') return 'cliente';
  if (String(meta.source ?? '').toLowerCase() === 'procon') return 'cliente';
  if (String(meta.source ?? '').toLowerCase() === 'consumidor-gov') return 'cliente';

  const legacy = legacyAlteracoesObject(reg);
  if (legacy) {
    const sender = String(legacy.sender ?? '').toLowerCase();
    if (sender === 'them') return 'cliente';
    if (sender === 'me') return 'agente';
    if (String(legacy.source ?? '').toLowerCase() === 'email-inbound') return 'cliente';
  }

  if (reg.anotacaoInterna && !reg.mensagemPublica) return 'agente';
  return 'cliente';
}

function diffTabulacao(before: ITabulacao, after: ITabulacao): Record<string, unknown> {
  const change: Record<string, unknown> = {};
  TABULACAO_TRACKED_FIELDS.forEach((key) => {
    const prev = String(before[key] ?? '').trim();
    const next = String(after[key] ?? '').trim();
    if (prev !== next) change[key] = next;
  });
  return change;
}

export function readTabulacaoSnapshot(tab?: ITabulacao | null): ITabulacao {
  if (!tab) {
    return {
      tipoChamado: '',
      produto: '',
      motivo: '',
      detalhe: '',
      canal: '',
      responsavel: '',
      atribuido: '',
    };
  }

  const maybeSubdoc = tab as ITabulacao & { toObject?: () => ITabulacao };
  const plain = typeof maybeSubdoc.toObject === 'function'
    ? maybeSubdoc.toObject()
    : tab;

  return {
    tipoChamado: String(plain.tipoChamado ?? '').trim(),
    produto: String(plain.produto ?? '').trim(),
    motivo: String(plain.motivo ?? '').trim(),
    detalhe: String(plain.detalhe ?? '').trim(),
    canal: String(plain.canal ?? '').trim(),
    responsavel: String(plain.responsavel ?? '').trim(),
    atribuido: String(plain.atribuido ?? '').trim(),
  };
}

/** Rótulo de Canal (tabulação) a partir da origem real do ticket (registro[0].metadados.source). */
const CANAL_LABEL_BY_SOURCE: Record<string, string> = {
  'whatsapp-thread': 'WhatsApp',
  whatsapp: 'WhatsApp',
  'email-inbound': 'E-mail',
  email: 'E-mail',
  'inbound-ticket-app': 'App',
  app: 'App',
  'inbound-ticket-telefone': 'Telefone',
  telefone: 'Telefone',
  'inbound-ticket-agente-ia': 'Agente IA',
  'agente-ia': 'Agente IA',
  'inbound-ticket-chat': 'Chat',
  chat: 'Chat',
  'reclame-aqui': 'Reclame Aqui',
  procon: 'Procon',
  'consumidor-gov': 'Consumidor.Gov',
  bacen: 'Bacen',
};

export function resolveCanalLabelFromSource(source: unknown): string {
  const key = String(source ?? '').trim().toLowerCase();
  return CANAL_LABEL_BY_SOURCE[key] || '';
}

/** Origem do primeiro evento do chamado (metadados.source) — usado como fallback de Canal em tickets antigos. */
export function readChamadoOriginSource(chamado: IChamadoN1): string {
  const first = chamado.registro?.[0];
  const meta = (first?.metadados && typeof first.metadados === 'object' ? first.metadados : {}) as Record<string, unknown>;
  return String(meta.source ?? '').trim();
}

function buildAlteracoesItem(changes: Record<string, unknown>): unknown[] {
  return Object.keys(changes).length ? [changes] : [];
}

function normalizeAlteracoesArray(alt: unknown): unknown[] {
  if (Array.isArray(alt)) {
    return alt.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  }
  if (alt && typeof alt === 'object') return [alt];
  return [];
}

function isLegacyTechnicalAlteracao(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
  const row = item as Record<string, unknown>;
  if (row.emailMessageId || String(row.source ?? '').toLowerCase() === 'email-inbound') return true;
  if (row.sender) return true;
  return false;
}

function businessAlteracoesFromRegistro(reg: IRegistro): unknown[] {
  return normalizeAlteracoesArray(reg.alteracoes).filter((item) => !isLegacyTechnicalAlteracao(item));
}

function originFromSender(sender: string): RegistroOrigin {
  return sender === 'them' ? 'cliente' : 'agente';
}

function senderFromOrigin(origin: RegistroOrigin): string {
  return origin === 'cliente' ? 'them' : 'me';
}

function isGenericRegistroAutor(value: string): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || normalized === 'agente' || normalized === 'agent';
}

export function resolveRegistroAutor(
  origin: RegistroOrigin,
  options: {
    authUser?: AuthPayload | null;
    authorHint?: string;
    clientName?: string;
  } = {}
): string {
  if (origin === 'cliente') {
    return String(options.clientName ?? options.authorHint ?? '').trim() || 'Cliente';
  }

  for (const candidate of [
    options.authorHint,
    options.authUser?.name,
    options.authUser?.email,
  ]) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }

  return '';
}

function resolveStoredRegistroAutor(
  reg: IRegistro,
  origin: RegistroOrigin,
  clientName?: string
): string {
  const stored = String(reg.autor ?? '').trim();
  if (stored && !isGenericRegistroAutor(stored)) return stored;
  return resolveRegistroAutor(origin, { clientName });
}

export interface RegistroHistoricoDto {
  id: string;
  registroIndex: number;
  time: Date;
  origin: RegistroOrigin;
  autor: string;
  alteracoes: unknown[];
  status: string;
  anotacaoInterna?: string;
  metadados?: Record<string, unknown>;
}

export interface TicketDto {
  _id: string;
  chamadoProtocolo: string;
  chamadoTitulo: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  channel?: string;
  source?: string;
  boxId?: string;
  clientName?: string;
  clientCPF?: string;
  responsibleAgent?: string;
  formData?: Record<string, unknown>;
  lateralForm?: Record<string, unknown>;
  workflow?: {
    active?: boolean;
    workflowStatus?: 'active' | 'finished' | 'cancel' | null;
    workflowId?: string | null;
    step?: number;
    passoId?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    pendingDecision?: Record<string, unknown> | string | null;
    requisicao?: {
      preenchidaEm?: Date;
      preenchidaPor?: string;
      valores?: Record<string, unknown>;
      comunicacaoWorkflow?: Array<{ mensagem: string; data: Date; autor: string }>;
      comunicacaoPendente?: boolean;
      comunicacaoResumo?: {
        ultimaOrigem: 'workflow' | 'responsavel' | null;
        ultimaData?: Date | null;
        temRespostaAgente?: boolean;
        vistoResponsavelEm?: Date | null;
      };
    };
  };
  messages?: TicketMessageDto[];
  internalNotes?: TicketMessageDto[];
  registroHistorico?: RegistroHistoricoDto[];
  openedBy?: string;
  isDemo?: boolean;
  slaBreached?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  listOnly?: boolean;
  queueEntryAt?: Date;
  fusao?: {
    fundido: boolean;
    dataFundido?: Date | null;
    hierarquia?: string;
    parentId?: string | null;
    childId?: string | null;
    parentProtocolo?: string;
    childProtocolo?: string;
    childProtocolos?: string[];
    childIds?: string[];
  };
}

export interface ChamadoMapContext {
  mode: 'list' | 'full';
  clienteBatch: ClienteDadosBatchContext;
  workflowById: Map<string, IWorkflowDefinicao>;
}

export interface BoxListFindOptions {
  filter: Record<string, unknown>;
  limit: number;
  sort: { updatedAt: -1 };
}

export async function buildChamadoMapContext(
  chamados: IChamadoN1[],
  mode: 'list' | 'full' = 'list',
): Promise<ChamadoMapContext> {
  const refs = chamados.map((chamado) => chamado.cliente?.[0] as LegacyClienteEmbed | undefined);
  const clienteBatch = await batchLoadDadosForRefs(refs);

  const workflowIds = chamados
    .filter((chamado) => hasPersistedWorkflowSnapshot(chamado.workflow))
    .map((chamado) => String(chamado.workflow!.workflowId));

  const workflowById = mode === 'list'
    ? await getWorkflowsByIds(workflowIds)
    : new Map<string, IWorkflowDefinicao>();

  return { mode, clienteBatch, workflowById };
}

/**
 * Teto de itens carregados por coluna em GET /boxes. Isso é só uma limitação técnica de
 * performance (evita `find()` sem limite trazendo milhares de tickets com join de
 * cliente/workflow de uma vez, o que já causou timeout de 45s e derrubou a tela toda) —
 * nunca deve ser confundido com a CONTAGEM do badge, que é sempre o total real e nunca
 * usa esse limite (ver buildBoxCountFilter).
 */
const BOX_LIST_MAX_ITEMS = 500;

export function buildBoxListFindOptions(
  status: string,
  queue?: string,
  responsavelCandidates?: string[],
  extraFilter?: Record<string, unknown>,
): BoxListFindOptions {
  const baseFilter = buildChamadoQueryFilter(status, queue, responsavelCandidates, extraFilter);
  const excludeAbsorvidos = excludeFusaoAbsorvidosFilter();
  const filter: Record<string, unknown> = { $and: [baseFilter, excludeAbsorvidos] };

  return {
    filter,
    limit: BOX_LIST_MAX_ITEMS,
    sort: { updatedAt: -1 },
  };
}

/**
 * Filtro pra CONTAGEM total do badge de fila — nunca aplica o teto de itens que
 * buildBoxListFindOptions usa só pra limitar a lista exibida por performance.
 * Contagem tem que sempre refletir o total real (respeitando ver_todos vs
 * meus-chamados, igual buildChamadoQueryFilter já faz).
 */
export function buildBoxCountFilter(
  status: string,
  queue?: string,
  responsavelCandidates?: string[],
  extraFilter?: Record<string, unknown>,
): Record<string, unknown> {
  const baseFilter = buildChamadoQueryFilter(status, queue, responsavelCandidates, extraFilter);
  const excludeAbsorvidos = excludeFusaoAbsorvidosFilter();
  return { $and: [baseFilter, excludeAbsorvidos] };
}

export async function chamadosToTickets(
  chamados: IChamadoN1[],
  boxId: string,
  mode: 'list' | 'full' = 'full',
): Promise<TicketDto[]> {
  if (!chamados.length) return [];
  if (mode === 'full') {
    return Promise.all(chamados.map((chamado) => chamadoToTicket(chamado, boxId)));
  }

  const ctx = await buildChamadoMapContext(chamados, 'list');
  return chamados.map((chamado) => chamadoToTicketListItem(chamado, boxId, ctx));
}

function buildLateralWorkflowListDto(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
): Record<string, unknown> {
  // Mesmo payload do detalhe (passosResumo + stepHistory) — stepper não depende só do runtime
  return buildLateralWorkflowDto(chamado, definicao) || {};
}

function serializeComunicacaoResumo(
  req: NonNullable<IChamadoN1['workflow']>['requisicao'],
  comunicacao: Array<{ mensagem: string; data: Date; autor: string }>,
): IChamadoWorkflowComunicacaoResumo {
  if (req?.comunicacaoResumo?.ultimaOrigem !== undefined) {
    return {
      ultimaOrigem: req.comunicacaoResumo.ultimaOrigem ?? null,
      ultimaData: req.comunicacaoResumo.ultimaData ?? null,
      temRespostaAgente: req.comunicacaoResumo.temRespostaAgente === true,
      // Front usa isso pra esconder o badge "Aguardando resposta" quando o lado workflow já
      // abriu o ticket depois da última resposta do agente (markComunicacaoWorkflowVisto).
      vistoResponsavelEm: req.comunicacaoResumo.vistoResponsavelEm ?? null,
    };
  }
  return buildComunicacaoResumo(comunicacao);
}

function resolveQueueEntryAt(chamado: IChamadoN1): Date | undefined {
  const registros = chamado.registro ?? [];
  if (!registros.length) return chamado.createdAt ?? chamado.updatedAt;
  return registros[registros.length - 1]?.data ?? chamado.createdAt ?? chamado.updatedAt;
}

const BOX_NAME_BY_STATUS: Record<string, string> = {
  novo: 'Novos',
  'em-aberto': 'Em aberto',
  'em-andamento': 'Em Andamento',
  'em-espera': 'Em espera',
  pendente: 'Pendente',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
  fechado: 'Resolvido',
};

/** Colunas fixas da fila Meus Chamados (registro.status + tabulacao.responsavel) */
export const MEUS_CHAMADOS_COLUMNS = [
  { id: 'meus-novos', name: 'Novos', status: 'novo', order: 0 },
  { id: 'meus-em-aberto', name: 'Em Aberto', status: 'em-aberto', order: 1 },
  { id: 'meus-em-andamento', name: 'Em Andamento', status: 'em-andamento', order: 2 },
  { id: 'meus-pendente', name: 'Pendente', status: 'pendente', order: 3 },
  { id: 'meus-resolvidos', name: 'Resolvidos', status: 'resolvido', order: 4 },
] as const;

const SLA_LIMIT_HOURS: Record<string, number> = {
  'em-aberto': 4,
  'em-andamento': 8,
};

const SLA_TRACKED_STATUSES = new Set(['em-aberto', 'em-andamento']);

const STATUS_VARIANTS: Record<string, string[]> = {
  novo: ['novo'],
  'em-aberto': ['em-aberto', 'em aberto'],
  'em-andamento': ['em-andamento', 'em andamento', 'em-aberto', 'em aberto'],
  pendente: ['pendente'],
  /** Fila Resolvidos: resolvido + fechado. Cancelado nunca conta nem aparece aqui. */
  resolvido: ['resolvido', 'fechado'],
  cancelado: ['cancelado'],
  fechado: ['fechado'],
  'em-espera': ['em-espera', 'em espera'],
};

/**
 * Status imutáveis / fora do snapshot ativo do Agente 3.
 * `resolvido` permanece listável (janela 48h) e não bloqueia reabertura via inbound.
 */
export const GESTAO_TERMINAL_STATUSES = ['cancelado', 'fechado'] as const;

/** Destinos de merge e filas que não aceitam novos anexos de negócio. */
export const MERGE_TERMINAL_STATUSES = ['resolvido', 'cancelado', 'fechado'] as const;

export const RESOLVED_REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000;

export function gestaoTerminalStatusVariants(): string[] {
  return [...new Set(
    GESTAO_TERMINAL_STATUSES.flatMap((status) => STATUS_VARIANTS[status] ?? [status]),
  )];
}

export function mergeTerminalStatusVariants(): string[] {
  return [...new Set(
    MERGE_TERMINAL_STATUSES.flatMap((status) => STATUS_VARIANTS[status] ?? [status]),
  )];
}

export class ChamadoClosedError extends Error {
  status: number;

  constructor(message = 'Ticket fechado — não aceita modificações.', status = 409) {
    super(message);
    this.name = 'ChamadoClosedError';
    this.status = status;
  }
}

export function normalizeStatusValue(status: unknown): string {
  const raw = String(status ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (raw === 'resolvidos') return 'resolvido';
  return raw;
}

const INBOUND_REOPEN_STATUSES = new Set(['pendente', 'em-andamento', 'resolvido']);

export function isChamadoFechado(chamado: IChamadoN1): boolean {
  return normalizeStatusValue(currentStatus(chamado)) === 'fechado';
}

/** Data do último registro com status resolvido (para janela de reabertura 48h). */
export function getResolvedAt(chamado: IChamadoN1): Date | null {
  const registros = chamado.registro ?? [];
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    if (normalizeStatusValue(registros[i]?.status) === 'resolvido') {
      const d = registros[i]?.data;
      return d ? new Date(d) : null;
    }
  }
  return null;
}

export function isResolvedWithinReopenWindow(
  chamado: IChamadoN1,
  windowMs = RESOLVED_REOPEN_WINDOW_MS,
  now = Date.now(),
): boolean {
  if (normalizeStatusValue(currentStatus(chamado)) !== 'resolvido') return false;
  const resolvedAt = getResolvedAt(chamado);
  if (!resolvedAt) return false;
  return now - resolvedAt.getTime() < windowMs;
}

/**
 * Inbound: anexar no ticket existente vs criar novo.
 * - pendente / em-andamento / resolvido dentro da janela (48h) → anexar e ir para em-aberto
 * - resolvido fora da janela / fechado / cancelado → ticket novo (nota de origem)
 */
export function shouldSpawnNewTicketOnInbound(
  chamado: IChamadoN1,
  windowMs = RESOLVED_REOPEN_WINDOW_MS,
  now = Date.now(),
): boolean {
  const status = normalizeStatusValue(currentStatus(chamado));
  if (status === 'fechado' || status === 'cancelado') return true;
  if (status === 'resolvido') return !isResolvedWithinReopenWindow(chamado, windowMs, now);
  return false;
}

/**
 * Status gravado ao anexar resposta do cliente no ticket existente (inbound).
 * `em-aberto` alimenta a lista "Cliente respondeu" (rótulo Em andamento no Desk).
 */
export function resolveInboundClientReplyStatus(chamado: IChamadoN1): string | undefined {
  const status = normalizeStatusValue(currentStatus(chamado));
  if (INBOUND_REOPEN_STATUSES.has(status)) {
    return 'em-aberto';
  }
  return undefined;
}

export function buildInboundDerivedTicketNote(sourceProtocolo: string): string {
  const proto = String(sourceProtocolo ?? '').trim() || 'ticket anterior';
  return `Novo ticket derivado de ${proto}`;
}

/** Insere a nota de origem como primeiro registro (ticket novo derivado de fechado/expirado). */
export function prependInboundDerivedTicketNote(
  chamado: { registro?: IRegistro[] },
  sourceProtocolo: string,
  status = 'novo',
): void {
  const note: IRegistro = {
    data: new Date(),
    origin: 'agente',
    autor: 'sistema',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: buildInboundDerivedTicketNote(sourceProtocolo),
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: {
      trigger: 'inbound-derived-ticket',
      sourceProtocolo: String(sourceProtocolo ?? '').trim(),
    },
    status,
  };
  if (!chamado.registro) chamado.registro = [];
  chamado.registro.unshift(note);
}

export function assertChamadoModifiable(chamado: IChamadoN1): void {
  if (isChamadoFechado(chamado)) {
    throw new ChamadoClosedError();
  }
}

export function appendStatusTransition(
  chamado: IChamadoN1,
  nextStatus: string,
  params: {
    autor?: string;
    anotacaoInterna?: string;
    metadados?: Record<string, unknown>;
    origin?: RegistroOrigin;
  } = {},
): void {
  const status = normalizeStatusValue(nextStatus) || 'em-andamento';
  if (!chamado.registro) chamado.registro = [];
  chamado.registro.push({
    data: new Date(),
    origin: params.origin ?? 'agente',
    autor: params.autor ?? 'sistema',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: params.anotacaoInterna ?? '',
    anexosAnotacaoInterna: [],
    alteracoes: [{ status }],
    metadados: params.metadados ?? {},
    status,
  });
  markWorkflowCancelledOnTicketClose(chamado, status);
}

/** Tickets com último status diferente de resolvido/cancelado/fechado */
export function activeTicketsStatusFilter(): Record<string, unknown> {
  const terminalVariants = gestaoTerminalStatusVariants();
  return {
    $expr: {
      $not: {
        $in: [
          { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
          terminalVariants,
        ],
      },
    },
  };
}

/** Reverse lookup: nome da box → status canônico (primeiro status que mapeia para o nome). */
const STATUS_BY_BOX_NAME: Record<string, string> = {};
for (const [status, name] of Object.entries(BOX_NAME_BY_STATUS)) {
  if (STATUS_BY_BOX_NAME[name] == null) STATUS_BY_BOX_NAME[name] = status;
}

/** Campos legados embutidos em cliente[] antes da migraÃ§Ã£o v1.1.0 */
type LegacyClienteEmbed = IClienteRef & {
  clienteNome?: string;
  clienteEmail?: { lista?: string[]; resposta?: string };
  clienteTelefone?: { lista?: string[] };
};

function legacyDadosFromRef(ref?: LegacyClienteEmbed | null): IClienteDados | null {
  if (!ref?.clienteNome && !ref?.clienteCpf) return null;
  return {
    clienteCpf: ref.clienteCpf ?? '',
    clienteNome: ref.clienteNome ?? '',
    clienteEmail: {
      lista: ref.clienteEmail?.lista ?? [],
      ...(ref.clienteEmail?.resposta ? { resposta: ref.clienteEmail.resposta } : {}),
    },
    clienteTelefone: { lista: ref.clienteTelefone?.lista ?? [] },
  };
}

export function statusFromBoxName(boxName: string): string {
  if (boxName === 'Novo') return 'novo';
  // Compat de nome legado — mesmo caso já resolvido aqui pra "Em processamento": a box real
  // no Mongo (coleção `boxes`) ficou cadastrada como "Em aberto" e nunca foi renomeada pra
  // "Em Andamento" (o nome que BOX_NAME_BY_STATUS/MEUS_CHAMADOS_COLUMNS esperam pro status
  // 'em-andamento', que é o que os tickets realmente usam — 'em-aberto' não tem uso real hoje).
  // Sem isso, quem cai no board genérico (permissão ver_todos) nunca vê nenhum ticket
  // 'em-andamento': a box "Em aberto" resolve pro status errado e não existe nenhuma box
  // chamada "Em Andamento" pra pegar esses tickets.
  if (
    boxName === 'Em processamento' || boxName === 'Em Processamento'
    || boxName === 'Em aberto' || boxName === 'Em Aberto'
  ) return 'em-andamento';
  return STATUS_BY_BOX_NAME[boxName] ?? 'novo';
}

export function boxNameFromStatus(status: string): string {
  return BOX_NAME_BY_STATUS[status] ?? 'Novos';
}

export function currentStatus(chamado: IChamadoN1): string {
  const registros = chamado.registro ?? [];
  if (registros.length === 0) return 'novo';
  return registros[registros.length - 1].status || 'novo';
}

export function isSlaBreached(chamado: IChamadoN1): boolean {
  const status = currentStatus(chamado);
  if (!SLA_TRACKED_STATUSES.has(status)) return false;

  const limitHours = SLA_LIMIT_HOURS[status];
  if (!limitHours) return false;

  const registros = chamado.registro ?? [];
  const statusSince = registros[registros.length - 1]?.data ?? chamado.createdAt;
  if (!statusSince) return false;

  const elapsedMs = Date.now() - new Date(statusSince).getTime();
  return elapsedMs > limitHours * 60 * 60 * 1000;
}

export async function generateProtocolo(): Promise<string> {
  return allocateNextProtocolo();
}

function resolveChamadoTitulo(body: Record<string, unknown>, fallback = ''): string {
  return String(body.chamadoTitulo ?? body.title ?? fallback).trim();
}

function tabulacaoFromBody(body: Record<string, unknown>, fallbackTitle?: string): ITabulacao {
  const lateral = (body.lateralForm ?? {}) as Record<string, string>;
  return {
    tipoChamado: lateral.tipoChamado ?? lateral.classificacaoTipo ?? String(body.classificacaoTipo ?? ''),
    produto: lateral.produto ?? String(body.produto ?? ''),
    motivo: lateral.motivo ?? fallbackTitle ?? String(body.title ?? ''),
    detalhe: lateral.detalhe ?? String(body.description ?? ''),
    canal: String(lateral.canal ?? body.canal ?? '').trim(),
    responsavel: sanitizeResponsavel(lateral.responsavel ?? body.responsibleAgent),
    atribuido: lateral.atribuido ?? '',
  };
}

export async function createChamadoFromBody(
  body: Record<string, unknown>,
  status = 'novo',
  authUser?: AuthPayload | null
): Promise<Partial<IChamadoN1>> {
  const titulo = resolveChamadoTitulo(body);
  const tab = tabulacaoFromBody(body, titulo);
  const internal = Boolean(body.internal);
  const text = String(body.text ?? body.description ?? '');
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const protocoloInformed = String(body.chamadoProtocolo ?? '').trim();
  const cliente = await resolveClienteRefFromBody(body);

  const clientName = String(body.clientName ?? '').trim();
  const raData = readReclameAquiFromBody(body);
  const pcData = readProconFromBody(body);
  const govData = readConsumidorGovFromBody(body);
  const bacenData = readBacenFromBody(body);
  const lf = (body.lateralForm ?? {}) as Record<string, unknown>;
  const workflowMeta = lf.workflow;

  let registro: IRegistro[];

  if (raData) {
    const complaintText = String(raData.descricao ?? text ?? '').trim();
    const raMetadados: Record<string, unknown> = {
      source: 'reclame-aqui',
      reclameAqui: raData,
    };
    const clienteRegistro: IRegistro = {
      data: new Date(),
      origin: 'cliente',
      autor: clientName || String(raData.consumidor ?? '').trim() || 'Consumidor',
      mensagemPublica: internal ? '' : complaintText,
      anexosMensagemPublica: internal ? [] : attachments,
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [],
      metadados: raMetadados,
      status,
    };
    registro = [clienteRegistro];

    if (workflowMeta && typeof workflowMeta === 'object' && !Array.isArray(workflowMeta)) {
      registro.push({
        data: new Date(),
        origin: 'agente',
        autor: resolveRegistroAutor('agente', {
          authUser,
          authorHint: String(body.author ?? '').trim(),
          clientName,
        }),
        mensagemPublica: '',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: buildAlteracoesItem({ workflow: workflowMeta }),
        metadados: { workflow: workflowMeta },
        status,
      });
    }
  } else if (pcData) {
    const complaintText = String(pcData.descricao ?? text ?? '').trim();
    const pcMetadados: Record<string, unknown> = {
      source: 'procon',
      procon: pcData,
    };
    const clienteRegistro: IRegistro = {
      data: new Date(),
      origin: 'cliente',
      autor: clientName || String(pcData.consumidor ?? '').trim() || 'Consumidor',
      mensagemPublica: internal ? '' : complaintText,
      anexosMensagemPublica: internal ? [] : attachments,
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [],
      metadados: pcMetadados,
      status,
    };
    registro = [clienteRegistro];

    if (workflowMeta && typeof workflowMeta === 'object' && !Array.isArray(workflowMeta)) {
      registro.push({
        data: new Date(),
        origin: 'agente',
        autor: resolveRegistroAutor('agente', {
          authUser,
          authorHint: String(body.author ?? '').trim(),
          clientName,
        }),
        mensagemPublica: '',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: buildAlteracoesItem({ workflow: workflowMeta }),
        metadados: { workflow: workflowMeta },
        status,
      });
    }
  } else if (govData) {
    const complaintText = String(govData.descricao ?? text ?? '').trim();
    const govMetadados: Record<string, unknown> = {
      source: 'consumidor-gov',
      consumidorGov: govData,
    };
    const clienteRegistro: IRegistro = {
      data: new Date(),
      origin: 'cliente',
      autor: clientName || String(govData.consumidor ?? '').trim() || 'Consumidor',
      mensagemPublica: internal ? '' : complaintText,
      anexosMensagemPublica: internal ? [] : attachments,
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [],
      metadados: govMetadados,
      status,
    };
    registro = [clienteRegistro];

    if (workflowMeta && typeof workflowMeta === 'object' && !Array.isArray(workflowMeta)) {
      registro.push({
        data: new Date(),
        origin: 'agente',
        autor: resolveRegistroAutor('agente', {
          authUser,
          authorHint: String(body.author ?? '').trim(),
          clientName,
        }),
        mensagemPublica: '',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: buildAlteracoesItem({ workflow: workflowMeta }),
        metadados: { workflow: workflowMeta },
        status,
      });
    }
  } else if (bacenData) {
    const complaintText = String(bacenData.descricao ?? text ?? '').trim();
    const bcMetadados: Record<string, unknown> = {
      source: 'bacen',
      bacen: bacenData,
    };
    const clienteRegistro: IRegistro = {
      data: new Date(),
      origin: 'cliente',
      autor: clientName || String(bacenData.consumidor ?? '').trim() || 'Consumidor',
      mensagemPublica: internal ? '' : complaintText,
      anexosMensagemPublica: internal ? [] : attachments,
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [],
      metadados: bcMetadados,
      status,
    };
    registro = [clienteRegistro];

    if (workflowMeta && typeof workflowMeta === 'object' && !Array.isArray(workflowMeta)) {
      registro.push({
        data: new Date(),
        origin: 'agente',
        autor: resolveRegistroAutor('agente', {
          authUser,
          authorHint: String(body.author ?? '').trim(),
          clientName,
        }),
        mensagemPublica: '',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: buildAlteracoesItem({ workflow: workflowMeta }),
        metadados: { workflow: workflowMeta },
        status,
      });
    }
  } else {
    const requestedOrigin = String(body.messageOrigin ?? '').trim().toLowerCase();
    const initialOrigin: RegistroOrigin = requestedOrigin === 'cliente' || body.sender === 'them'
      ? 'cliente'
      : 'agente';
    const internalText = String(body.internalText ?? body.anotacaoInterna ?? '').trim();
    const internalAttachments = Array.isArray(body.internalAttachments)
      ? body.internalAttachments.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    registro = [{
      data: new Date(),
      origin: initialOrigin,
      autor: resolveRegistroAutor(initialOrigin, {
        authUser,
        authorHint: String(body.author ?? '').trim(),
        clientName,
      }),
      mensagemPublica: internal ? '' : text,
      anexosMensagemPublica: internal ? [] : attachments,
      anotacaoInterna: internal ? text : internalText,
      anexosAnotacaoInterna: internal ? attachments : internalAttachments,
      alteracoes: [],
      metadados: {
        source: String(body.source ?? body.channel ?? '').trim() || 'velodesk',
        sourceQuality: initialOrigin === 'cliente' ? 'direto_cliente' : 'resumo_atendente',
      },
      status,
    }];
  }

  if (!tab.canal) {
    const effectiveSource = String(
      (registro[0]?.metadados as Record<string, unknown> | undefined)?.source ?? '',
    );
    tab.canal = resolveCanalLabelFromSource(effectiveSource);
  }

  await assertTabulacaoForStatus(tab, status);

  const partial: Partial<IChamadoN1> = {
    chamadoProtocolo: protocoloInformed || await generateProtocolo(),
    chamadoTitulo: titulo,
    cliente,
    tabulacao: [tab],
    registro,
  };
  ensureProconChannelStamp(partial as IChamadoN1, body, status);
  ensureConsumidorGovChannelStamp(partial as IChamadoN1, body, status);
  ensureBacenChannelStamp(partial as IChamadoN1, body, status);
  return partial;
}

export interface PrepareChamadoBodyResult {
  pendingChanges: Record<string, unknown>;
  targetStatus: string;
}

function ensureTabulacaoOnChamado(chamado: IChamadoN1): void {
  if (!chamado.tabulacao?.length) {
    chamado.tabulacao = [readTabulacaoSnapshot(null)];
  }
}

/** Aplica tabulação/cliente/workflow em memória — sem gravar registro. */
export async function prepareChamadoFromBody(
  chamado: IChamadoN1,
  body: Record<string, unknown>,
): Promise<PrepareChamadoBodyResult> {
  ensureTabulacaoOnChamado(chamado);
  const beforeTab = readTabulacaoSnapshot(chamado.tabulacao[0]);
  const pendingChanges: Record<string, unknown> = {};

  if (
    body.clientName !== undefined ||
    body.clientCPF !== undefined ||
    body.clienteId !== undefined ||
    body.lateralForm
  ) {
    const next = await resolveClienteRefFromBody(body, chamado.cliente[0]);
    if (next.length > 0) chamado.cliente = next;
  }

  if (body.chamadoTitulo !== undefined || body.title !== undefined) {
    chamado.chamadoTitulo = resolveChamadoTitulo(body, chamado.chamadoTitulo);
  }

  if (body.lateralForm || body.title || body.chamadoTitulo || body.description || body.responsibleAgent) {
    const bodyLf = (body.lateralForm ?? {}) as Record<string, unknown>;
    const lateralFormMerged: Record<string, unknown> = {
      ...beforeTab,
      tipoChamado: beforeTab.tipoChamado,
      classificacaoTipo: beforeTab.tipoChamado,
      ...bodyLf,
    };
    // Claim/roleta preenche responsável antes do merge; o Desk envia vazio (campo readonly).
    const existingResponsavel = sanitizeResponsavel(beforeTab.responsavel);
    let incomingResponsavel = sanitizeResponsavel(bodyLf.responsavel ?? body.responsibleAgent);
    if (incomingResponsavel) {
      incomingResponsavel = await normalizeResponsavelForStorage(incomingResponsavel);
    }
    if (!incomingResponsavel && existingResponsavel) {
      lateralFormMerged.responsavel = existingResponsavel;
    } else if (incomingResponsavel) {
      lateralFormMerged.responsavel = incomingResponsavel;
    }

    const merged = readTabulacaoSnapshot(tabulacaoFromBody(
      {
        lateralForm: lateralFormMerged,
        ...body,
      },
      resolveChamadoTitulo(body, chamado.chamadoTitulo || beforeTab.motivo)
    ));
    Object.assign(pendingChanges, diffTabulacao(beforeTab, merged));
    chamado.tabulacao = [merged];
  }

  // Workflow pendente fica só no cache do Desk até o save; persistência via POST /workflow/start.

  let targetStatus = currentStatus(chamado);
  if (body.status !== undefined && String(body.status).trim()) {
    const nextStatus = normalizeStatusValue(body.status);
    if (nextStatus !== targetStatus) {
      targetStatus = nextStatus;
      pendingChanges.status = nextStatus;
    }
  }

  return { pendingChanges, targetStatus };
}

function buildAlteracoesFromPending(pendingChanges: Record<string, unknown>): {
  alteracoes: unknown[];
  workflowMeta?: Record<string, unknown>;
} {
  const alteracoesChanges = { ...pendingChanges };
  const workflowMeta = alteracoesChanges.workflow;
  delete alteracoesChanges.status;
  delete alteracoesChanges.workflow;
  return {
    alteracoes: buildAlteracoesItem(alteracoesChanges),
    workflowMeta: workflowMeta && typeof workflowMeta === 'object' && !Array.isArray(workflowMeta)
      ? workflowMeta as Record<string, unknown>
      : undefined,
  };
}

function isValidCpfDigitsForWorkflow(cpf: string): boolean {
  const digits = normalizeCpf(cpf);
  return digits.length === 11;
}

/** CPF completo no ticket — obrigatório para iniciar workflow; save de status segue sem cliente. */
export function isClientIdentifiedOnChamado(chamado: IChamadoN1): boolean {
  const ref = chamado.cliente?.[0];
  return isValidCpfDigitsForWorkflow(String(ref?.clienteCpf ?? ''));
}

export class ChamadoCommitValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ChamadoCommitValidationError';
    this.status = status;
  }
}

const TERMINAL_STATUSES_REQUIRING_RESPONSAVEL = new Set(['resolvido', 'cancelado', 'fechado']);

/** Proibido encerrar ticket sem responsável real — independente de override/perfil. */
export function assertResponsavelForTerminalStatus(
  chamado: IChamadoN1,
  targetStatus: string,
): void {
  const normalized = normalizeStatusValue(targetStatus);
  if (!TERMINAL_STATUSES_REQUIRING_RESPONSAVEL.has(normalized)) return;
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0];
  if (!isRealResponsavel(sanitizeResponsavel(tab?.responsavel))) {
    throw new ChamadoCommitValidationError(
      'Atribua um responsável real ao ticket antes de encerrá-lo.',
      400,
    );
  }
}

export interface CommitChamadoFromAgentResult {
  messageResult: AppendRegistroResult;
  publicText: string;
  publicRegistroIndex?: number;
}

/**
 * Commit atômico do Desk: mensagem pública, nota interna, tabulação, status e responsável
 * num único chamado.save() (feito na rota).
 */
export async function commitChamadoFromAgent(
  chamado: IChamadoN1,
  body: Record<string, unknown>,
  authUser?: AuthPayload | null,
): Promise<CommitChamadoFromAgentResult> {
  assertChamadoModifiable(chamado);
  const { pendingChanges, targetStatus } = await prepareChamadoFromBody(chamado, body);
  const current = currentStatus(chamado);

  const attachmentList = Array.isArray(body.attachments)
    ? body.attachments.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const internalAttachmentList = Array.isArray(body.internalAttachments)
    ? body.internalAttachments.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  const publicText = String(body.text ?? '').trim();
  const internalText = String(body.internalText ?? body.anotacaoInterna ?? '').trim();
  const hasMessage = Boolean(
    publicText
    || internalText
    || attachmentList.length
    || internalAttachmentList.length,
  );

  if (hasMessage && (!body.status || !String(body.status).trim())) {
    throw new ChamadoCommitValidationError('Status obrigatório ao enviar mensagem ao cliente.');
  }

  if (targetStatus !== current) {
    await assertTabulacaoForStatus(chamado.tabulacao[0], targetStatus);
    assertResponsavelForTerminalStatus(chamado, targetStatus);
  }

  const { alteracoes, workflowMeta } = buildAlteracoesFromPending(pendingChanges);
  const authorHint = String(body.author ?? '').trim();
  let messageResult: AppendRegistroResult = {};

  if (hasMessage) {
    messageResult = appendRegistroEntry(chamado, {
      mensagemPublica: publicText,
      anotacaoInterna: internalText,
      anexosMensagemPublica: attachmentList,
      anexosAnotacaoInterna: internalAttachmentList,
      sender: String(body.sender ?? 'me'),
      autor: authorHint || undefined,
      authUser,
      alteracoes,
      metadados: workflowMeta ? { workflow: workflowMeta } : {},
      statusOverride: targetStatus,
    });
    if (!messageResult.public && !messageResult.internal) {
      throw new ChamadoCommitValidationError('Texto da mensagem ou anotação é obrigatório.');
    }
  } else if (Object.keys(pendingChanges).length) {
    chamado.registro.push({
      data: new Date(),
      origin: 'agente',
      autor: resolveRegistroAutor('agente', { authUser, authorHint }),
      mensagemPublica: '',
      anexosMensagemPublica: [],
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes,
      metadados: workflowMeta ? { workflow: workflowMeta } : {},
      status: targetStatus,
    });
  }

  ensureProconChannelStamp(chamado, body);
  ensureConsumidorGovChannelStamp(chamado, body);
  ensureBacenChannelStamp(chamado, body);

  markWorkflowCancelledOnTicketClose(chamado, targetStatus);

  return {
    messageResult,
    publicText,
    publicRegistroIndex: messageResult.public?.registroIndex,
  };
}

export async function applyBodyToChamado(
  chamado: IChamadoN1,
  body: Record<string, unknown>,
  authUser?: AuthPayload | null
): Promise<void> {
  assertChamadoModifiable(chamado);
  const { pendingChanges, targetStatus } = await prepareChamadoFromBody(chamado, body);

  if (pendingChanges.status) {
    await assertTabulacaoForStatus(chamado.tabulacao[0], targetStatus);
    assertResponsavelForTerminalStatus(chamado, targetStatus);
  }

  if (Object.keys(pendingChanges).length) {
    const { alteracoes, workflowMeta } = buildAlteracoesFromPending(pendingChanges);
    chamado.registro.push({
      data: new Date(),
      origin: 'agente',
      autor: resolveRegistroAutor('agente', {
        authUser,
        authorHint: String(body.author ?? '').trim(),
      }),
      mensagemPublica: '',
      anexosMensagemPublica: [],
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes,
      metadados: workflowMeta ? { workflow: workflowMeta } : {},
      status: targetStatus,
    });
  }

  ensureProconChannelStamp(chamado, body);
  ensureConsumidorGovChannelStamp(chamado, body);
  ensureBacenChannelStamp(chamado, body);
  markWorkflowCancelledOnTicketClose(chamado, targetStatus);
}

export interface AppendRegistroResult {
  public?: TicketMessageDto;
  internal?: TicketMessageDto;
}

export function appendRegistroEntry(
  chamado: IChamadoN1,
  payload: {
    mensagemPublica?: string;
    anotacaoInterna?: string;
    anexosMensagemPublica?: string[];
    anexosAnotacaoInterna?: string[];
    sender?: string;
    autor?: string;
    authUser?: AuthPayload | null;
    alteracoes?: unknown[];
    metadados?: Record<string, unknown>;
    /** Status do registro — usado no commit atômico do Desk. */
    statusOverride?: string;
  }
): AppendRegistroResult {
  const publicText = String(payload.mensagemPublica ?? '').trim();
  const internalText = String(payload.anotacaoInterna ?? '').trim();
  const publicAttachments = filterRealAttachmentUrls(payload.anexosMensagemPublica);
  const internalAttachments = filterRealAttachmentUrls(payload.anexosAnotacaoInterna);
  if (!publicText && !internalText && !publicAttachments.length && !internalAttachments.length) return {};

  const sender = payload.sender ?? 'me';
  const origin = originFromSender(sender);
  const status = String(payload.statusOverride ?? currentStatus(chamado)).trim() || currentStatus(chamado);

  const regAutor = resolveRegistroAutor(origin, {
    authUser: payload.authUser,
    authorHint: payload.autor,
    clientName: undefined,
  });

  const entry: IRegistro = {
    data: new Date(),
    origin,
    autor: regAutor,
    mensagemPublica: publicText,
    anexosMensagemPublica: publicAttachments,
    anotacaoInterna: internalText,
    anexosAnotacaoInterna: internalAttachments,
    alteracoes: payload.alteracoes ?? [],
    metadados: payload.metadados ?? {},
    status,
  };
  chamado.registro.push(entry);
  const index = chamado.registro.length - 1;

  const result: AppendRegistroResult = {};
  if (publicText || publicAttachments.length) {
    result.public = {
      id: `${index}-pub`,
      text: publicText,
      sender: senderFromOrigin(origin),
      origin,
      author: regAutor || undefined,
      type: 'public',
      time: entry.data,
      registroIndex: index,
      attachments: publicAttachments,
    };
  }
  if (internalText || internalAttachments.length) {
    result.internal = {
      id: `${index}-int`,
      text: internalText,
      sender: 'me',
      origin: 'agente',
      author: regAutor || undefined,
      type: 'internal',
      time: entry.data,
      registroIndex: index,
      attachments: internalAttachments,
    };
  }
  return result;
}

export function appendMessage(
  chamado: IChamadoN1,
  text: string,
  internal: boolean,
  sender = 'me',
  attachments: string[] = [],
  metadados: Record<string, unknown> = {},
  statusOverride?: string,
): TicketMessageDto {
  const safeAttachments = attachments.map((url) => String(url).trim()).filter(Boolean);
  const result = appendRegistroEntry(chamado, {
    mensagemPublica: internal ? '' : text,
    anotacaoInterna: internal ? text : '',
    anexosMensagemPublica: internal ? [] : safeAttachments,
    anexosAnotacaoInterna: internal ? safeAttachments : [],
    sender,
    metadados,
    statusOverride,
  });
  const dto = result.public ?? result.internal;
  if (!dto) {
    return {
      id: Date.now().toString(),
      text: '',
      sender,
      origin: originFromSender(sender),
      type: internal ? 'internal' : 'public',
      time: new Date(),
      attachments: safeAttachments,
    };
  }
  return dto;
}

function currentTabulacao(chamado: IChamadoN1) {
  const tabulacao = chamado.tabulacao ?? [];
  if (tabulacao.length === 0) return undefined;
  return tabulacao[tabulacao.length - 1];
}

export async function chamadoToTicket(
  chamado: IChamadoN1,
  boxId?: string,
  ctx?: ChamadoMapContext,
): Promise<TicketDto> {
  if (ctx?.mode === 'list') {
    return chamadoToTicketListItem(chamado, boxId, ctx);
  }
  return chamadoToTicketFull(chamado, boxId);
}

export function chamadoToTicketListItem(
  chamado: IChamadoN1,
  boxId: string | undefined,
  ctx: ChamadoMapContext,
): TicketDto {
  return buildTicketDtoCore(chamado, boxId, ctx);
}

interface FullTicketExtras {
  cadastro?: IClienteDados | null;
  lateralWorkflow?: Record<string, unknown>;
  persistedApproval?: Record<string, unknown>;
  reclameAqui?: Record<string, unknown> | null;
  procon?: Record<string, unknown> | null;
  consumidorGov?: Record<string, unknown> | null;
}

async function chamadoToTicketFull(
  chamado: IChamadoN1,
  boxId?: string,
): Promise<TicketDto> {
  const ref = chamado.cliente?.[0] as LegacyClienteEmbed | undefined;
  let cadastro = await loadDadosForRef(ref);
  if (!cadastro) cadastro = legacyDadosFromRef(ref);

  let lateralWorkflow: Record<string, unknown> | undefined;
  if (hasPersistedWorkflowSnapshot(chamado.workflow)) {
    const definicao = await loadWorkflowDefForChamado(chamado);
    if (definicao) {
      lateralWorkflow = buildLateralWorkflowDto(chamado, definicao) ?? undefined;
    }
  }
  if (!lateralWorkflow) {
    lateralWorkflow = findLatestWorkflowFromRegistro(chamado) ?? undefined;
  }

  const ticket = buildTicketDtoCore(chamado, boxId, undefined, {
    cadastro,
    lateralWorkflow,
    persistedApproval: findLatestApprovalFromRegistro(chamado) ?? undefined,
    reclameAqui: findReclameAquiFromChamado(chamado),
    procon: findProconFromChamado(chamado),
    consumidorGov: findConsumidorGovFromChamado(chamado),
  });
  await enrichTicketAttachmentScanStatuses(ticket);
  return ticket;
}

function resolveTicketPriorityFromChamado(chamado: IChamadoN1): string {
  for (const reg of chamado.registro ?? []) {
    const mailPriority = String(reg.metadados?.mailPriority ?? '').trim().toLowerCase();
    if (mailPriority === 'alta' || mailPriority === 'critica') return mailPriority;
  }
  return 'media';
}

/**
 * Versão "leve" para o polling do Desk: monta as threads (pública, WhatsApp, notas internas)
 * e o histórico — que é o que muda com frequência — SEM as buscas de I/O do detalhe completo
 * (cadastro no banco e definição do workflow). Os campos ricos são derivados apenas do próprio
 * documento (ref embutida + registro), então o front mescla só as threads e preserva o painel.
 */
export async function chamadoToTicketLight(
  chamado: IChamadoN1,
  boxId?: string,
): Promise<TicketDto> {
  const ref = chamado.cliente?.[0] as LegacyClienteEmbed | undefined;
  const cadastro = legacyDadosFromRef(ref);
  const lateralWorkflow = findLatestWorkflowFromRegistro(chamado) ?? undefined;

  const ticket = buildTicketDtoCore(chamado, boxId, undefined, {
    cadastro,
    lateralWorkflow,
    persistedApproval: findLatestApprovalFromRegistro(chamado) ?? undefined,
    reclameAqui: findReclameAquiFromChamado(chamado),
    procon: findProconFromChamado(chamado),
    consumidorGov: findConsumidorGovFromChamado(chamado),
  });
  await enrichTicketAttachmentScanStatuses(ticket);
  return ticket;
}

function buildTicketDtoCore(
  chamado: IChamadoN1,
  boxId?: string,
  ctx?: ChamadoMapContext,
  extras: FullTicketExtras = {},
): TicketDto {
  const listOnly = ctx?.mode === 'list';
  const tab = currentTabulacao(chamado);
  const ref = chamado.cliente?.[0] as LegacyClienteEmbed | undefined;
  const status = currentStatus(chamado);

  let cadastro: IClienteDados | null = extras.cadastro ?? null;
  if (!cadastro && ctx?.mode === 'list') {
    cadastro = resolveDadosFromBatch(ref, ctx.clienteBatch);
    if (!cadastro) cadastro = legacyDadosFromRef(ref);
  } else if (!cadastro) {
    cadastro = legacyDadosFromRef(ref);
  }

  const clientName = cadastro?.clienteNome;

  const messages: TicketMessageDto[] = [];
  const internalNotes: TicketMessageDto[] = [];
  const registroHistorico: RegistroHistoricoDto[] = [];

  if (!listOnly) {
    chamado.registro?.forEach((reg, index) => {
      const origin = resolveRegistroOrigin(reg);
      const meta = registroMetadados(reg);
      registroHistorico.push({
        id: `${index}-reg`,
        registroIndex: index,
        time: reg.data,
        origin,
        autor: resolveStoredRegistroAutor(reg, origin, clientName),
        alteracoes: businessAlteracoesFromRegistro(reg),
        status: reg.status || 'novo',
        anotacaoInterna: String(reg.anotacaoInterna ?? '').trim() || undefined,
        metadados: meta,
      });
      const regAutor = resolveStoredRegistroAutor(reg, origin, clientName);
      const isWhatsAppThread = String(meta.source ?? '') === WHATSAPP_THREAD_SOURCE;

      if (isWhatsAppThread) {
        const waMsgs = readWhatsAppMensagens(reg);
        waMsgs.forEach((wa, waIdx) => {
          const waOrigin = wa.origin;
          messages.push({
            id: wa.twilioMessageSid || wa.id || `${index}-wa-${waIdx}`,
            text: normalizeTicketMessageText(wa.texto),
            sender: senderFromOrigin(waOrigin),
            origin: waOrigin,
            author: wa.autor || regAutor || undefined,
            type: 'public',
            channel: 'whatsapp',
            deliveryStatus: wa.deliveryStatus,
            deliveryErrorMessage: wa.deliveryErrorMessage,
            mediaContentTypes: wa.mediaContentTypes,
            transcriptionStatus: wa.transcriptionStatus,
            time: wa.data ? new Date(wa.data) : reg.data,
            registroIndex: index,
            attachments: filterRealAttachmentUrls(wa.anexos),
            attachmentScanStatuses: scanStatusesAlignedToUrls(
              filterRealAttachmentUrls(wa.anexos),
              wa.anexos,
              wa.anexosScanStatus,
            ),
          });
        });
      } else if (
        (reg.mensagemPublica || (reg.anexosMensagemPublica?.length ?? 0) > 0)
        && !isAutomaticEmailRegistro(reg, meta)
      ) {
        const isEmailInbound = String(meta.source ?? '').toLowerCase() === 'email-inbound';
        const publicText = normalizeTicketMessageText(
          isEmailInbound
            ? extractEmailReplyContent(reg.mensagemPublica)
            : reg.mensagemPublica,
        );
        const isSystemBubble = String(reg.origin || '').trim().toLowerCase() === 'sistema';
        messages.push({
          id: `${index}-pub`,
          text: publicText,
          sender: isSystemBubble ? 'system' : senderFromOrigin(origin),
          origin,
          author: regAutor || undefined,
          type: isSystemBubble ? 'system' : 'public',
          time: reg.data,
          registroIndex: index,
          attachments: filterRealAttachmentUrls(reg.anexosMensagemPublica),
          attachmentScanStatuses: scanStatusesForPublicAttachments(reg),
        });
      }
      if (reg.anotacaoInterna || (reg.anexosAnotacaoInterna?.length ?? 0) > 0) {
        internalNotes.push({
          id: `${index}-int`,
          text: normalizeTicketMessageText(reg.anotacaoInterna),
          sender: 'me',
          origin: 'agente',
          author: regAutor || undefined,
          type: 'internal',
          time: reg.data,
          registroIndex: index,
          attachments: filterRealAttachmentUrls(reg.anexosAnotacaoInterna),
        });
      }
    });
  }

  const titulo = chamado.chamadoTitulo?.trim()
    || tab?.motivo?.trim()
    || chamado.chamadoProtocolo;

  const clientCpf = ref?.clienteCpf || cadastro?.clienteCpf;

  let responsavel = sanitizeResponsavel(tab?.responsavel);
  if (!responsavel) {
    responsavel = inferResponsavelFromAgentRegistro(chamado.registro);
  }
  responsavel = resolveResponsavelDisplayNameSync(responsavel);

  let lateralWorkflow: Record<string, unknown> | undefined = extras.lateralWorkflow;
  const persistedWorkflow = chamado.workflow;
  if (
    !lateralWorkflow
    && persistedWorkflow
    && hasPersistedWorkflowSnapshot(persistedWorkflow)
    && listOnly
    && ctx
  ) {
    const definicao = ctx.workflowById.get(String(persistedWorkflow.workflowId));
    if (definicao) {
      lateralWorkflow = buildLateralWorkflowListDto(chamado, definicao);
    }
  }
  if (!lateralWorkflow && !listOnly) {
    lateralWorkflow = findLatestWorkflowFromRegistro(chamado) ?? undefined;
  }
  const persistedApproval = listOnly ? undefined : (extras.persistedApproval ?? findLatestApprovalFromRegistro(chamado) ?? undefined);
  const reclameAquiMeta = extras.reclameAqui ?? findReclameAquiFromChamado(chamado);
  const proconMeta = extras.procon ?? findProconFromChamado(chamado);
  const consumidorGovMeta = extras.consumidorGov ?? findConsumidorGovFromChamado(chamado);
  const bacenMeta = findBacenFromChamado(chamado);
  const reclameAqui = listOnly ? null : reclameAquiMeta;
  const procon = listOnly ? null : proconMeta;
  const consumidorGov = listOnly ? null : consumidorGovMeta;
  const especialChannel = reclameAquiMeta
    ? 'reclame-aqui'
    : proconMeta
      ? 'procon'
      : consumidorGovMeta
        ? 'consumidor-gov'
        : null;
  const especialSource = reclameAquiMeta
    ? 'reclame-aqui'
    : proconMeta
      ? 'procon'
      : consumidorGovMeta
        ? 'consumidor-gov'
        : 'velodesk';
  // Canal real de contato: prioriza órgão especial detectado, depois tabulacao.canal persistido
  // (a partir daqui, todo ticket novo já é criado com canal correto — ver createChamadoFromBody),
  // com fallback para tickets antigos sem canal persistido (deriva de registro[0].metadados.source).
  // Sem "Portal" como default artificial — canal vazio fica vazio, sem inventar valor.
  const canalLabel = reclameAquiMeta
    ? 'Reclame Aqui'
    : proconMeta
      ? 'Procon'
      : consumidorGovMeta
        ? 'Consumidor.Gov'
        : bacenMeta
          ? 'Bacen'
          : (tab?.canal || resolveCanalLabelFromSource(readChamadoOriginSource(chamado)));

  return {
    _id: chamado._id.toString(),
    chamadoProtocolo: chamado.chamadoProtocolo,
    chamadoTitulo: titulo,
    title: titulo,
    description: tab?.detalhe,
    status,
    priority: resolveTicketPriorityFromChamado(chamado),
    channel: especialChannel ?? 'digital',
    source: especialSource,
    boxId,
    clientName,
    clientCPF: clientCpf,
    responsibleAgent: responsavel,
    workflow: hasPersistedWorkflowSnapshot(chamado.workflow) && chamado.workflow
      ? {
        active: chamado.workflow.active,
        workflowStatus: chamado.workflow.workflowStatus
          ?? (chamado.workflow.active ? 'active' : null),
        workflowId: chamado.workflow.workflowId ? String(chamado.workflow.workflowId) : null,
        step: chamado.workflow.step ?? 0,
        passoId: chamado.workflow.passoId ? String(chamado.workflow.passoId) : null,
        startedAt: chamado.workflow.startedAt,
        completedAt: chamado.workflow.completedAt,
        pendingDecision: chamado.workflow.pendingDecision ?? null,
        requisicao: (() => {
          const req = chamado.workflow.requisicao;
          if (!req) return undefined;
          const comunicacao = Array.isArray(req.comunicacaoWorkflow) ? req.comunicacaoWorkflow : [];
          const comunicacaoPendente = comunicacao.length > 0;
          const comunicacaoResumo = serializeComunicacaoResumo(req, comunicacao);
          if (listOnly) {
            return {
              valores: req.valores || {},
              comunicacaoPendente,
              comunicacaoResumo,
            };
          }
          return {
            preenchidaEm: req.preenchidaEm,
            preenchidaPor: req.preenchidaPor,
            valores: req.valores || {},
            solicitacaoProdutos: req.solicitacaoProdutos || undefined,
            solicitacaoFinanceiro: req.solicitacaoFinanceiro || undefined,
            comunicacaoWorkflow: comunicacao.map((item) => ({
              mensagem: String(item.mensagem || ''),
              data: item.data,
              autor: String(item.autor || ''),
            })),
            comunicacaoPendente,
            comunicacaoResumo,
          };
        })(),
      }
      : undefined,
    lateralForm: {
      tipoChamado: tab?.tipoChamado,
      classificacaoTipo: tab?.tipoChamado,
      produto: tab?.produto,
      motivo: tab?.motivo,
      detalhe: tab?.detalhe,
      responsavel,
      atribuido: tab?.atribuido,
      clienteCpf: clientCpf,
      clienteNome: clientName,
      clienteEmail: listOnly ? [] : (cadastro?.clienteEmail?.lista ?? []),
      clienteEmailResposta: listOnly ? undefined : (cadastro?.clienteEmail?.resposta ?? undefined),
      clienteTelefone: listOnly ? [] : (cadastro?.clienteTelefone?.lista ?? []),
      clienteTelefoneWhatsapp: listOnly ? undefined : (cadastro?.clienteTelefone?.whatsapp ?? undefined),
      cpf: clientCpf,
      canal: canalLabel,
      reclameAqui: reclameAqui ?? undefined,
      procon: procon ?? undefined,
      consumidorGov: consumidorGov ?? undefined,
      workflow: lateralWorkflow,
      approval: persistedApproval ?? undefined,
      solicitacaoProdutos: chamado.workflow?.requisicao?.solicitacaoProdutos ?? undefined,
      solicitacaoFinanceiro: chamado.workflow?.requisicao?.solicitacaoFinanceiro ?? undefined,
    },
    messages: listOnly ? [] : messages,
    internalNotes: listOnly ? [] : internalNotes,
    registroHistorico: listOnly ? [] : registroHistorico,
    slaBreached: isSlaBreached(chamado),
    createdAt: chamado.createdAt,
    updatedAt: chamado.updatedAt,
    listOnly: listOnly || undefined,
    queueEntryAt: listOnly ? resolveQueueEntryAt(chamado) : undefined,
    fusao: serializeFusaoDto(chamado.fusao),
  };
}

export function lastStatusFilter(status: string) {
  const variants = STATUS_VARIANTS[status] ?? [status];

  if (variants.length === 1) {
    return {
      $expr: {
        $eq: [{ $arrayElemAt: ['$registro.status', -1] }, variants[0]],
      },
    };
  }

  return {
    $expr: {
      $in: [{ $arrayElemAt: ['$registro.status', -1] }, variants],
    },
  };
}

export function currentResponsavel(chamado: IChamadoN1): string {
  const tabulacao = chamado.tabulacao ?? [];
  if (tabulacao.length === 0) return '';
  return tabulacao[tabulacao.length - 1]?.responsavel ?? '';
}

export function buildResponsavelCandidates(
  authUser: AuthPayload,
  dbUser?: { name?: string; email?: string } | null,
  colaboradorNome?: string,
): string[] {
  const values: string[] = [];
  const push = (raw?: string) => {
    const value = String(raw ?? '').trim();
    if (value) values.push(value);
  };

  push(authUser.name);
  push(authUser.email);
  push(emailLocalPart(authUser.email));
  push(authUser.userId);
  push(dbUser?.name);
  push(dbUser?.email);
  push(emailLocalPart(dbUser?.email));
  push(colaboradorNome);
  // Responsável é gravado como alias/primeiro+último via cadastro de colaboradores (funcionarios) —
  // sem isso, quem tem alias configurado nunca bate no próprio filtro dos tickets que assumiu.
  push(resolveResponsavelDisplayNameSync(authUser.email));
  push(resolveResponsavelDisplayNameSync(authUser.name));
  push(resolveResponsavelDisplayNameSync(dbUser?.email));
  push(resolveResponsavelDisplayNameSync(dbUser?.name));

  return [...new Set(values.map((value) => value.toLowerCase()).filter(Boolean))];
}

function emailLocalPart(email?: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] ?? '';
}

function lastTabulacaoResponsavelExpr() {
  return {
    $toLower: {
      $ifNull: [
        {
          $let: {
            vars: { lastTab: { $arrayElemAt: ['$tabulacao', -1] } },
            in: '$$lastTab.responsavel',
          },
        },
        '',
      ],
    },
  };
}

export function meusChamadosResponsavelFilter(candidates: string[]) {
  if (candidates.length === 0) {
    return { _id: { $exists: false } };
  }

  const normalized = candidates.map((value) => value.toLowerCase());

  return {
    $expr: {
      $in: [lastTabulacaoResponsavelExpr(), normalized],
    },
  };
}

/** Atribuído individual (colaborador) — exclui funcao:/grupo: (escopo de time). */
export function meusChamadosAtribuidoColaboradorFilter(candidates: string[]) {
  if (candidates.length === 0) {
    return { _id: { $exists: false } };
  }

  const normalized = candidates.map((value) => value.toLowerCase());

  return {
    $and: [
      {
        $expr: {
          $not: {
            $regexMatch: {
              input: lastTabulacaoAtribuidoExpr(),
              regex: '^(funcao:|grupo:)',
            },
          },
        },
      },
      {
        $expr: {
          $in: [lastTabulacaoAtribuidoExpr(), normalized],
        },
      },
    ],
  };
}

/** Meus chamados: responsável OU atribuído colaborador igual ao agente logado. */
export function meusChamadosAgentScopeFilter(candidates: string[]) {
  return {
    $or: [
      meusChamadosResponsavelFilter(candidates),
      meusChamadosAtribuidoColaboradorFilter(candidates),
    ],
  };
}

/** Novos sem responsável = fila compartilhada; com responsável = só o agente dono */
export function meusChamadosNovosResponsavelFilter(candidates: string[]) {
  if (candidates.length === 0) {
    return { _id: { $exists: false } };
  }

  return {
    $or: [
      meusChamadosAgentScopeFilter(candidates),
      {
        $expr: {
          $eq: [lastTabulacaoResponsavelExpr(), ''],
        },
      },
    ],
  };
}

function lastTabulacaoAtribuidoExpr() {
  return {
    $toLower: {
      $ifNull: [
        {
          $let: {
            vars: { lastTab: { $arrayElemAt: ['$tabulacao', -1] } },
            in: '$$lastTab.atribuido',
          },
        },
        '',
      ],
    },
  };
}

export function atribuidoFuncaoFilter(funcaoSlug: string) {
  const expected = `funcao:${String(funcaoSlug || '').trim().toLowerCase()}`;
  return {
    $expr: {
      $eq: [lastTabulacaoAtribuidoExpr(), expected],
    },
  };
}

/** Filtro por atribuição: qualquer uma das funções do usuário (`funcao:{slug}`). */
export function atribuidoFuncoesFilter(funcaoSlugs: string[]) {
  const expected = [
    ...new Set(
      (funcaoSlugs || [])
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
        .map((s) => `funcao:${s}`),
    ),
  ];
  if (!expected.length) {
    return { _id: { $exists: false } };
  }
  return {
    $expr: {
      $in: [lastTabulacaoAtribuidoExpr(), expected],
    },
  };
}

/**
 * Fila do ator de Workflow: tickets com atribuído na função, workflow ativo
 * da definição do time (escalonar-{funcao} ou passo do grupo) ou solicitacaoProdutos.
 */
export function workflowActorQueueFilter(
  funcaoSlugs: string[],
  workflowDefinitionIds: Array<string | { toString(): string }>,
) {
  const atribuido = atribuidoFuncoesFilter(funcaoSlugs);
  const ids = (workflowDefinitionIds || [])
    .map((id) => {
      try {
        return new mongoose.Types.ObjectId(String(id));
      } catch {
        return null;
      }
    })
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));

  const orClauses: Record<string, unknown>[] = [atribuido];

  if (ids.length) {
    orClauses.push({
      'workflow.active': true,
      'workflow.workflowId': { $in: ids },
    });
  }

  const funcoes = new Set(
    (funcaoSlugs || [])
      .map((slug) => String(slug || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (funcoes.has('produtos')) {
    orClauses.push({
      'workflow.active': true,
      'workflow.requisicao.solicitacaoProdutos.categoria': {
        $in: ['erros-bugs', 'solicitacoes', 'liberacao-pix', 'documentos'],
      },
    });
    orClauses.push({
      'workflow.active': true,
      'workflow.requisicao.solicitacaoFinanceiro.categoria': 'documentos',
    });
  }

  if (funcoes.has('financeiro')) {
    orClauses.push({
      'workflow.active': true,
      'workflow.requisicao.solicitacaoFinanceiro.categoria': {
        $in: ['estorno', 'cobranca', 'outros'],
      },
    });
  }

  if (orClauses.length === 1) return orClauses[0];
  return { $or: orClauses };
}

/**
 * Filas dos 4 CRMs Especiais que podem reusar o board genérico (boxes.routes.ts) passando
 * ?fila=<canal> — mantém o próprio canal incluído em vez de excluí-lo. Hoje só procon/
 * consumidor-gov chegam a usar esse caminho; bacen/reclame-aqui têm serviços dedicados, mas
 * ficam aqui também para não zerar a fila se algum dia passarem a usar ?fila=bacen/reclame-aqui.
 */
const CE_QUEUE_CHANNEL_FILTERS: Record<string, () => Record<string, unknown>> = {
  procon: proconChannelMongoFilter,
  'consumidor-gov': consumidorGovChannelMongoFilter,
  bacen: bacenChannelMongoFilter,
  'reclame-aqui': reclameAquiChannelMongoFilter,
};

export function buildChamadoQueryFilter(status: string, queue?: string, responsavelCandidates?: string[], extraFilter?: Record<string, unknown>) {
  const filters: Record<string, unknown>[] = [lastStatusFilter(status)];
  const ceChannelFilter = queue ? CE_QUEUE_CHANNEL_FILTERS[queue] : undefined;
  const isCeModuleQueue = Boolean(ceChannelFilter);

  if (ceChannelFilter) {
    filters.push(ceChannelFilter());
  }

  // Módulo Tickets: CE nunca entra (ver_todos, meus-chamados, funcao-atribuido, default).
  // Filas dos CRMs Especiais (uma por canal) mantêm inclusão do próprio órgão.
  if (!isCeModuleQueue) {
    filters.push(excludeEspeciaisChannelsMongoFilter());
  }

  if (queue === 'meus-chamados' && responsavelCandidates?.length && status !== 'resolvido' && status !== 'fechado') {
    const responsavelFilter = status === 'novo'
      ? meusChamadosNovosResponsavelFilter(responsavelCandidates)
      : meusChamadosAgentScopeFilter(responsavelCandidates);
    filters.push(responsavelFilter);
  }

  if (queue === 'funcao-atribuido' && extraFilter) {
    filters.push(extraFilter);
  }

  return filters.length === 1 ? filters[0] : { $and: filters };
}

export async function resolveBoxIdForChamado(
  chamado: IChamadoN1,
  boxes: Array<{ _id: mongoose.Types.ObjectId; name: string }>
): Promise<string | undefined> {
  const name = boxNameFromStatus(currentStatus(chamado));
  const box = boxes.find((b) => b.name === name);
  return box?._id.toString();
}

