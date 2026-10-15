/**
 * aiAutomation.service v1.0.0 — fila de aprovação humana do agente autônomo
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Máquina de estados (chamado.aiAutomation):
 *   aguardando_aprovacao --aprovar--> aprovada (resposta enviada, tabulação gravada)
 *   aguardando_aprovacao --reprovar (1ª)--> em_revisao --> aguardando_aprovacao (tentativa 2)
 *                                                     \--> encerrada_humano (2ª tentativa não passou na régua)
 *   aguardando_aprovacao --reprovar (2ª)--> encerrada_humano (bloqueadoIA = true)
 * `em_revisao` é também o estado transitório de "em processamento" (trava contra clique duplo).
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type {
  AiAutomationStatus,
  IAiAutomationTabulacao,
  IAiAutomationTentativa,
  IChamadoN1,
} from '../../models/ChamadoN1';
import { stripComposerOpening, wrapComposerOpening } from '../clientMessageEnvelope.service';
import { chamadoToTicket } from '../chamado.mapper';
import { applyAssignmentIfNeeded } from '../assignmentRouter.service';
import { resolveOperadorDisplayNameForAuthEmail } from '../colaboradoresCadastro.service';
import { AGENTE_AUTONOMO_ENVELOPE_NOME, AGENTE_AUTONOMO_RESPONSAVEL } from '../../config/agenteAutonomo';
import type { AuthPayload } from '../../middleware/auth';
import { resolveChamadoClientName } from '../placeholders.util';
import { buildTicketIaMessagesFromChamado } from '../ticketIaAdapter.service';
import { reviseAtendimento } from './atendimentoAgent.service';
import { validateAuditoria } from './auditoriaAgent.service';
import { sendAutonomousReply, validateTabulacaoForAutonomy } from './autonomousSend.service';
import { evaluateStrictGate } from './autonomyGate.util';
import { getAgentesConfig, isHidratacaoEnabled } from './autonomyRules.service';
import { hydrateForRevision, slugFromTabulacaoProduto } from '../consultaHidratacao.service';
import { buildInboundPipelineInput } from './inboundPipelineInput.util';
import type { AuditoriaResult, ConfidenceLevel, TicketAiTabulationResult } from './agentTypes';

export const MAX_TENTATIVAS = 2;

export class AiAutomationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'AiAutomationError';
  }
}

export interface EnqueueParams {
  resposta: string;
  tabulacao: TicketAiTabulationResult;
  audit: AuditoriaResult;
  confidence?: ConfidenceLevel;
  model?: string;
  ruleId?: string;
}

function tabOf(t: TicketAiTabulationResult): IAiAutomationTabulacao {
  return { tipo: t.tipo, produto: t.produto, motivo: t.motivo, detalhe: t.detalhe };
}

function newTentativa(n: number, p: EnqueueParams): IAiAutomationTentativa {
  return {
    tentativa: n,
    resposta: p.resposta,
    tabulacao: tabOf(p.tabulacao),
    auditScore: p.audit.score,
    confidence: p.confidence,
    model: p.model,
    geradaEm: new Date(),
  };
}

/** O agente só tenta quando o chamado não tem estado de automação em andamento nem bloqueio. */
export function canAttemptAutonomous(chamado: IChamadoN1): boolean {
  const a = chamado.aiAutomation;
  return !a || (!a.bloqueadoIA && !['aguardando_aprovacao', 'em_revisao', 'encerrada_humano'].includes(a.status));
}

/** 1ª tentativa: grava a resposta como pendente de auditoria humana (nada é enviado ao cliente). */
export async function enqueueForApproval(chamadoId: string, params: EnqueueParams): Promise<void> {
  const doc = await ChamadoN1.findById(chamadoId);
  if (!doc) return;
  // Quem trata o chamado é o agente autônomo: ele passa a ser o responsável (sobrepõe a roleta).
  setResponsavel(doc, AGENTE_AUTONOMO_RESPONSAVEL);
  doc.aiAutomation = {
    status: 'aguardando_aprovacao' as AiAutomationStatus,
    tentativas: 1,
    bloqueadoIA: false,
    ruleId: params.ruleId,
    pendente: newTentativa(1, params),
    historico: [],
    updatedAt: new Date(),
  };
  await doc.save();
}

function setResponsavel(doc: IChamadoN1, responsavel: string): void {
  if (!doc.tabulacao?.length) {
    doc.tabulacao = [{
      tipoChamado: '', produto: '', motivo: '', detalhe: '', canal: '', responsavel: '', atribuido: '',
    }];
  }
  doc.tabulacao[doc.tabulacao.length - 1].responsavel = responsavel;
  doc.markModified('tabulacao');
}

/** Registra um envio direto (sem fila) no estado do chamado, para métricas e para o dataset futuro. */
export async function recordDirectSend(chamadoId: string, params: EnqueueParams): Promise<void> {
  const t = { ...newTentativa(1, params), decisao: 'enviada_direto' as const, decididoPor: 'agente-ia', decididoEm: new Date() };
  await ChamadoN1.updateOne(
    { _id: chamadoId },
    {
      $set: {
        aiAutomation: {
          status: 'enviada_direto' as AiAutomationStatus,
          tentativas: 1,
          bloqueadoIA: false,
          ruleId: params.ruleId,
          historico: [t],
          updatedAt: new Date(),
        },
      },
    },
  );
}

// ───────────────────────────── consulta (fila) ─────────────────────────────

export interface ApprovalListItem {
  id: string;
  protocolo: string;
  titulo: string;
  status: AiAutomationStatus;
  tentativa: number;
  bloqueadoIA: boolean;
  ruleId?: string;
  pendente?: IAiAutomationTentativa;
  historico: IAiAutomationTentativa[];
  geradaEm?: Date;
  aguardandoMinutos?: number;
}

function toItem(doc: IChamadoN1): ApprovalListItem {
  const a = doc.aiAutomation!;
  const geradaEm = a.pendente?.geradaEm;
  return {
    id: doc._id.toString(),
    protocolo: doc.chamadoProtocolo,
    titulo: doc.chamadoTitulo,
    status: a.status,
    tentativa: a.pendente?.tentativa ?? a.tentativas,
    bloqueadoIA: a.bloqueadoIA,
    ruleId: a.ruleId,
    pendente: a.pendente,
    historico: a.historico || [],
    geradaEm,
    aguardandoMinutos: geradaEm ? Math.max(0, Math.round((Date.now() - new Date(geradaEm).getTime()) / 60000)) : undefined,
  };
}

export async function listApprovals(opts: { status?: AiAutomationStatus; page?: number; limit?: number }) {
  const status = opts.status || 'aguardando_aprovacao';
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const page = Math.max(opts.page || 1, 1);
  const filter = { 'aiAutomation.status': status };
  const [docs, total] = await Promise.all([
    ChamadoN1.find(filter)
      .select('chamadoProtocolo chamadoTitulo aiAutomation')
      .sort({ 'aiAutomation.updatedAt': 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ChamadoN1.countDocuments(filter),
  ]);
  return { items: docs.map(toItem), total, page, limit };
}

export async function getApproval(id: string) {
  const doc = await ChamadoN1.findOne({ _id: id, aiAutomation: { $exists: true } });
  if (!doc) throw new AiAutomationError('Item não encontrado', 404);
  const messages = buildTicketIaMessagesFromChamado(doc).map((m) => ({ role: m.role, text: m.text }));
  const internalTab = doc.tabulacao?.[doc.tabulacao.length - 1];
  return {
    ...toItem(doc),
    ticket: await chamadoToTicket(doc),
    messages,
    tabulacaoAtual: internalTab
      ? { tipo: internalTab.tipoChamado, produto: internalTab.produto, motivo: internalTab.motivo, detalhe: internalTab.detalhe }
      : null,
  };
}

// ───────────────────────────── decisões humanas ─────────────────────────────

async function claim(id: string): Promise<IChamadoN1> {
  const doc = await ChamadoN1.findOneAndUpdate(
    { _id: id, 'aiAutomation.status': 'aguardando_aprovacao' },
    { $set: { 'aiAutomation.status': 'em_revisao', 'aiAutomation.updatedAt': new Date() } },
    { new: true },
  );
  if (!doc || !doc.aiAutomation?.pendente) {
    throw new AiAutomationError('Item não está aguardando aprovação', 409);
  }
  return doc;
}

async function release(id: string): Promise<void> {
  await ChamadoN1.updateOne(
    { _id: id, 'aiAutomation.status': 'em_revisao' },
    { $set: { 'aiAutomation.status': 'aguardando_aprovacao', 'aiAutomation.updatedAt': new Date() } },
  );
}

/**
 * Aprova: envia ao cliente (texto da IA com saudação, ou o texto editado pelo auditor), grava a
 * tabulação, assume o ticket para quem aprovou, resolve o chamado e conta como acerto da IA.
 */
function cleanTab(raw: unknown): IAiAutomationTabulacao | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return { tipo: s(r.tipo), produto: s(r.produto), motivo: s(r.motivo), detalhe: s(r.detalhe) };
}

export async function approve(
  id: string,
  user: AuthPayload,
  textoFinal?: string,
  tabulacaoOverride?: unknown,
) {
  const by = user.email || user.userId || 'desconhecido';
  const auditorNome = user.displayName
    || (await resolveOperadorDisplayNameForAuthEmail(user.email).catch(() => ''))
    || user.name
    || by;
  const chamado = await claim(id);
  const pendente = chamado.aiAutomation!.pendente!;
  const custom = typeof textoFinal === 'string' ? textoFinal.trim().slice(0, 32_000) : '';
  let enviado = '';
  let editado = false;
  const override = cleanTab(tabulacaoOverride);
  const sameTab = (a: IAiAutomationTabulacao, b: IAiAutomationTabulacao) =>
    a.tipo === b.tipo && a.produto === b.produto && a.motivo === b.motivo && a.detalhe === b.detalhe;
  const tabFinal = override && !sameTab(override, pendente.tabulacao) ? override : null;
  try {
    const messages = buildTicketIaMessagesFromChamado(chamado).map((m) => ({ role: m.role, text: m.text }));
    const padrao = wrapComposerOpening({
      nucleo: pendente.resposta,
      clientName: await resolveChamadoClientName(chamado),
      messages,
      agentName: AGENTE_AUTONOMO_ENVELOPE_NOME,
    });
    enviado = custom || padrao;
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
    editado = Boolean(custom) && norm(stripComposerOpening(custom)) !== norm(pendente.resposta);
    await sendAutonomousReply(
      chamado,
      enviado,
      tabFinal || pendente.tabulacao,
      { aprovadoPor: by, aiAutomationTentativa: pendente.tentativa, aiAutomationEditado: editado },
      { statusFinal: 'resolvido', atribuidoPor: auditorNome },
    );
  } catch (err) {
    await release(id);
    throw err;
  }

  const decided: IAiAutomationTentativa = {
    ...pendente, decisao: 'aprovada', respostaFinal: enviado, editado, ...(tabFinal ? { tabulacaoFinal: tabFinal } : {}), decididoPor: by, decididoEm: new Date(),
  };
  await ChamadoN1.updateOne(
    { _id: id },
    {
      $set: { 'aiAutomation.status': 'aprovada', 'aiAutomation.updatedAt': new Date() },
      $unset: { 'aiAutomation.pendente': '' },
      $push: { 'aiAutomation.historico': decided },
    },
  );
  return { id, status: 'aprovada' as const, editado };
}

async function closeToHuman(id: string, extraHistorico: IAiAutomationTentativa[]) {
  await releaseToHumans(id);
  await ChamadoN1.updateOne(
    { _id: id },
    {
      $set: {
        'aiAutomation.status': 'encerrada_humano',
        'aiAutomation.bloqueadoIA': true,
        'aiAutomation.updatedAt': new Date(),
      },
      $unset: { 'aiAutomation.pendente': '' },
      $push: { 'aiAutomation.historico': { $each: extraHistorico } },
    },
  );
}

/** O agente autônomo deixa o chamado: libera o responsável e deixa a roleta atribuir a um humano. */
async function releaseToHumans(id: string): Promise<void> {
  try {
    const doc = await ChamadoN1.findById(id);
    if (!doc) return;
    const atual = doc.tabulacao?.[doc.tabulacao.length - 1]?.responsavel;
    if (atual !== AGENTE_AUTONOMO_RESPONSAVEL) return;
    setResponsavel(doc, '');
    await applyAssignmentIfNeeded(doc, { source: 'inbound-ticket' });
    await doc.save();
  } catch (err) {
    console.warn('[aiAutomation] falha ao devolver o chamado ao humano (fail-soft):', (err as Error)?.message);
  }
}

/**
 * Reprova (com ou sem feedback). 1ª reprovação ⇒ revisão automática e nova tentativa;
 * 2ª reprovação (ou nova tentativa que não passa na régua) ⇒ atendimento humano, sem mais IA.
 */
export async function reject(id: string, by: string, feedback?: string) {
  const chamado = await claim(id);
  const pendente = chamado.aiAutomation!.pendente!;
  const fb = String(feedback || '').trim().slice(0, 4000) || undefined;
  const rejected: IAiAutomationTentativa = {
    ...pendente, decisao: 'reprovada', feedback: fb, decididoPor: by, decididoEm: new Date(),
  };

  if (pendente.tentativa >= MAX_TENTATIVAS) {
    await closeToHuman(id, [rejected]);
    return { id, status: 'encerrada_humano' as const, motivo: 'segunda_reprovacao' as const };
  }

  try {
    const base = await buildInboundPipelineInput(chamado);
    if (!base) {
      await closeToHuman(id, [rejected]);
      return { id, status: 'encerrada_humano' as const, motivo: 'sem_contexto' as const };
    }

    const dadosConta = await hydrateForRevision({
      ticketId: base.ticketId,
      protocolo: base.protocolo,
      produto: pendente.tabulacao.produto,
      motivo: pendente.tabulacao.motivo,
    });
    if (!dadosConta && (await isHidratacaoEnabled()) && slugFromTabulacaoProduto(pendente.tabulacao.produto)) {
      await closeToHuman(id, [rejected]);
      return { id, status: 'encerrada_humano' as const, motivo: 'sem_dados_conta' as const };
    }

    const revised = await reviseAtendimento({
      ...base,
      dadosConta,
      respostaAnterior: pendente.resposta,
      tabulacaoAnterior: { ...pendente.tabulacao },
      origemRevisao: 'reprovada_humano',
      inputOperador: fb,
      auditScore: pendente.auditScore,
    });
    if (!revised.success || !revised.respostaSugerida || !revised.tabulacao) {
      await closeToHuman(id, [rejected]);
      return { id, status: 'encerrada_humano' as const, motivo: 'falha_revisao' as const };
    }

    const audit = await validateAuditoria({
      modo: 'auto_envio',
      protocolo: base.protocolo,
      canal: base.canal,
      status: base.status,
      contextSource: base.contextSource,
      messages: base.messages,
      internalNote: base.internalNote,
      respostaSugerida: revised.respostaSugerida,
      tabulacao: revised.tabulacao,
      dadosConta,
      produtoFixo: base.produtoFixo,
    });

    const cfg = await getAgentesConfig();
    const gate = evaluateStrictGate({
      audit,
      confidence: revised.confidence,
      tabulacao: revised.tabulacao,
      minAuditScoreEstrito: cfg.minAuditScoreEstrito,
    });
    const tabOk = gate.ok ? await validateTabulacaoForAutonomy(chamado, revised.tabulacao) : { ok: false };

    if (!gate.ok || !tabOk.ok) {
      // A tentativa reescrita não atinge a régua: não vale mostrar ao auditor humano — vai pro atendimento.
      await closeToHuman(id, [rejected]);
      return { id, status: 'encerrada_humano' as const, motivo: 'segunda_tentativa_reprovada_pela_ia' as const };
    }

    const next = newTentativa(pendente.tentativa + 1, {
      resposta: revised.respostaSugerida,
      tabulacao: revised.tabulacao,
      audit,
      confidence: revised.confidence,
      model: revised.model,
    });
    await ChamadoN1.updateOne(
      { _id: id },
      {
        $set: {
          'aiAutomation.status': 'aguardando_aprovacao',
          'aiAutomation.tentativas': next.tentativa,
          'aiAutomation.pendente': next,
          'aiAutomation.updatedAt': new Date(),
        },
        $push: { 'aiAutomation.historico': rejected },
      },
    );
    return { id, status: 'aguardando_aprovacao' as const, tentativa: next.tentativa };
  } catch (err) {
    await release(id);
    throw err;
  }
}
