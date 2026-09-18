/**
 * tickets.routes v1.27.0 — limpa aiSuggestionCache (sugestão pré-gerada) quando a resposta real
 * é enviada ao cliente (e-mail e WhatsApp)
 * VERSION: v1.27.0 | DATE: 2026-09-02
 */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { ChamadoN1 } from '../models/ChamadoN1';
import { ChamadoIaAnalise } from '../models/ChamadoIaAnalise';
import { Box } from '../models/Box';
import {
  applyManualResponsavelClaim,
  applySessionResponsavelIfNeeded,
} from '../services/assignmentRouter.service';
import {
  appendRegistroEntry,
  applyBodyToChamado,
  assertChamadoModifiable,
  ChamadoClosedError,
  ChamadoCommitValidationError,
  assertResponsavelForTerminalStatus,
  chamadoToTicket,
  chamadoToTicketLight,
  commitChamadoFromAgent,
  createChamadoFromBody,
  currentStatus,
  excludeEspeciaisChannelsMongoFilter,
  isReclameAquiChamado,
  lastStatusFilter,
  normalizeStatusValue,
  resolveBoxIdForChamado,
  statusFromBoxName,
} from '../services/chamado.mapper';
import { TabulacaoValidationError } from '../services/tabulation.service';
import { notifyAgentReplyAsync, notifyChamadoCreatedAsync } from '../services/emailNotification.service';
import { evaluateEmailTriggers } from '../services/emailTrigger.service';
import { publishTicketEvent } from '../services/presence/ticketEventsBroadcast.service';
import { reconcileChamadoAttachmentScanStatuses } from '../services/attachmentScanReconcile.service';
import { getCachedBoxes } from '../services/boxesCache.service';
import { runInboundAgentPipeline, runInboundPostCreateHooks } from '../services/agents/inboundAgentPipeline.service';
import { clearAiSuggestionCache } from '../services/agents/agentSuggestionCache.util';
import { hasMeaningfulClientContextInChamado } from '../services/ticketIaAdapter.service';
import {
  advanceWorkflowManual,
  advanceWorkflowWithDecision,
  cancelWorkflowForChamado,
  finishWorkflowAfterPublicReply,
  setWorkflowPendingDecision,
  startWorkflowForChamado,
  WorkflowAdvanceError,
} from '../services/workflowTicket.service';
import {
  appendComunicacaoWorkflow,
  markComunicacaoWorkflowVisto,
  WorkflowRequisicaoError,
} from '../services/workflowRequisicao.service';
import {
  assertCanActOnTicket,
  assertCanCommitTicket,
  assertCanInterruptWorkflow,
  assertCanPostTicketMessage,
  assertCanResolveTicketWithOpenWorkflow,
  assertCanWorkflowComunicacao,
  canApproveWorkflow,
  canClaimTicketResponsavel,
  isResponsavelSelfClaimBody,
  PermissionDeniedError,
  resolveUserPermissions,
} from '../services/permission.service';
import {
  mergeTicketInto,
  TicketMergeError,
} from '../services/ticketMerge.service';
import {
  appendWhatsAppMensagemToChamado,
  hasPriorAgentWhatsAppMessage,
  readWhatsAppMensagens,
  resolveWaChatIdFromChamado,
  updateWhatsAppMensagemDeliveryBySid,
} from '../services/twilio/whatsappThread.service';
import {
  sendWhatsAppForChamado,
  type WhatsAppChamadoOutboundResult,
} from '../services/twilio/whatsappActiveOutbound.service';
import {
  deactivateWaActiveConversationsForTicket,
  upsertWaActiveConversation,
} from '../services/twilio/waActiveConversation.service';
import { requestWhatsAppAudioTranscription } from '../services/twilio/whatsappAudioTranscription.service';
import { resolveSentAttachmentSendMeta } from '../services/sentAttachmentStorage.service';
import {
  markNotificacoesLidasForTicket,
  notifyAgentReplyToWorkflowResponsavel,
  notifyWorkflowMensagemToResponsavel,
} from '../services/workflowNotificacao.service';
import { isDraftTicketId } from '../utils/persistedTicketId';
import { deleteReclamacoesByChamadoId, syncFromChamado } from '../services/reclamacoes/reclamacao.service';

const router = Router();

async function loadBoxes() {
  // Cache TTL curto — boxes mudam raramente e são resolvidas muitas vezes por requisição.
  return getCachedBoxes();
}

function handleTicketMutationError(err: unknown, res: Response): boolean {
  if (err instanceof ChamadoClosedError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  if (err instanceof PermissionDeniedError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  if (err instanceof TabulacaoValidationError) {
    res.status(400).json({ message: err.message });
    return true;
  }
  if (err instanceof ChamadoCommitValidationError) {
    res.status(400).json({ message: err.message });
    return true;
  }
  if (err instanceof WorkflowAdvanceError || err instanceof WorkflowRequisicaoError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  if (err instanceof TicketMergeError) {
    res.status(err.status).json({ message: err.message });
    return true;
  }
  return false;
}

router.get('/', authMiddleware, async (req, res: Response) => {
  const boxes = await loadBoxes();
  // CE (Procon/Bacen/Consumidor.gov/Reclame Aqui) nunca entra no módulo Tickets — mesma
  // regra já aplicada em GET /boxes via buildChamadoQueryFilter.
  const filter: Record<string, unknown> = { $and: [excludeEspeciaisChannelsMongoFilter()] };

  if (req.query.boxId) {
    const box = boxes.find((b) => b._id.toString() === String(req.query.boxId));
    if (box) Object.assign(filter, lastStatusFilter(statusFromBoxName(box.name)));
  } else if (req.query.status) {
    Object.assign(filter, lastStatusFilter(String(req.query.status)));
  }

  const chamados = await ChamadoN1.find(filter).sort({ updatedAt: -1 });
  const tickets = await Promise.all(
    chamados.map(async (chamado) =>
      chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes))
    )
  );
  res.json(tickets);
});

router.get('/by-protocol/:protocolo', authMiddleware, async (req, res: Response) => {
  const protocolo = String(req.params.protocolo ?? '').trim();
  if (!protocolo) return res.status(400).json({ message: 'Protocolo inválido' });

  try {
    let chamado = await ChamadoN1.findOne({ chamadoProtocolo: protocolo });
    if (!chamado) return res.status(404).json({ message: 'Chamado não encontrado' });

    await reconcileChamadoAttachmentScanStatuses(String(chamado._id));
    chamado = await ChamadoN1.findOne({ chamadoProtocolo: protocolo });
    if (!chamado) return res.status(404).json({ message: 'Chamado não encontrado' });

    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    // Express 4 não encaminha rejeições de handler async para o error middleware —
    // sem este catch, uma falha aqui (ex.: reconcile de anexo, workflow ref quebrada)
    // deixa a requisição pendurada pra sempre (sem resposta), e a busca "falha" sem erro visível.
    console.error('[tickets] by-protocol falhou:', protocolo, (err as Error).message);
    res.status(500).json({ message: 'Erro ao buscar chamado por protocolo' });
  }
});

router.post('/:sourceId/merge-into/:targetId', authMiddleware, async (req, res: Response) => {
  try {
    const result = await mergeTicketInto(
      String(req.params.sourceId),
      String(req.params.targetId),
      req.user!,
    );
    res.json(result);
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.get('/:id', authMiddleware, async (req, res: Response) => {
  if (isDraftTicketId(req.params.id)) {
    return res.status(404).json({ message: 'Ticket não encontrado' });
  }
  let chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });
  await reconcileChamadoAttachmentScanStatuses(String(chamado._id));
  chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });
  const boxes = await loadBoxes();
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const boxId = await resolveBoxIdForChamado(chamado, boxes);
  // view=light: usado pelo polling do Desk — devolve as threads/histórico atualizados sem
  // as buscas de I/O do detalhe completo (cadastro/workflow). Marca `light: true`.
  if (String(req.query.view ?? '') === 'light') {
    const lightDto = await chamadoToTicketLight(chamado, boxId);
    return res.json({ ...lightDto, light: true });
  }
  // Abertura real do ticket (não o polling `view=light`) — marca lido no sininho o que
  // o front já trata como resolvido localmente (ex.: pedido de informação do workflow).
  if (req.user?.email) {
    void markNotificacoesLidasForTicket(String(chamado._id), req.user.email).catch((err: Error) => {
      console.warn('[tickets.routes] markNotificacoesLidasForTicket fail-soft:', err.message);
    });
  }
  // Quem pode aprovar workflow abriu o ticket depois da resposta do agente — some o badge
  // "Aguardando resposta" da fila de aprovação sem exigir uma nova mensagem enviada.
  if (req.user) {
    try {
      const resolved = await resolveUserPermissions(req.user);
      if (canApproveWorkflow(resolved) && markComunicacaoWorkflowVisto(chamado)) {
        await chamado.save();
      }
    } catch (err) {
      console.warn('[tickets.routes] markComunicacaoWorkflowVisto fail-soft:', (err as Error).message);
    }
  }
  res.json(await chamadoToTicket(chamado, boxId));
});

router.post('/', authMiddleware, async (req, res: Response) => {
  const boxes = await loadBoxes();
  let status = 'novo';

  if (req.body.status !== undefined && String(req.body.status).trim()) {
    status = String(req.body.status);
  } else if (req.body.boxId) {
    const box = boxes.find((b) => b._id.toString() === String(req.body.boxId));
    if (box) status = statusFromBoxName(box.name);
  } else if (boxes[0]) {
    status = statusFromBoxName(boxes[0].name);
  }

  const protocolo = String(req.body.chamadoProtocolo ?? '').trim();
  if (protocolo) {
    const exists = await ChamadoN1.findOne({ chamadoProtocolo: protocolo });
    if (exists) {
      return res.status(409).json({ message: 'Protocolo já cadastrado' });
    }
  }

  try {
    const partial = await createChamadoFromBody(req.body, status, req.user);
    applySessionResponsavelIfNeeded(partial, req.user);
    const chamado = await ChamadoN1.create(partial);
    await notifyChamadoCreatedAsync(chamado);
    void runInboundPostCreateHooks(chamado, { source: 'manual' }).catch((err: Error) => {
      console.warn('[tickets.routes] runInboundPostCreateHooks fail-soft:', err.message);
    });
    const ticket = await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes));
    res.status(201).json(ticket);
  } catch (err) {
    if (err instanceof TabulacaoValidationError) {
      return res.status(400).json({ message: err.message });
    }
    throw err;
  }
});

router.put('/:id', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });
  const titleBefore = chamado.chamadoTitulo;
  const statusBefore = currentStatus(chamado);

  try {
    assertChamadoModifiable(chamado);
    const isClaim = isResponsavelSelfClaimBody(req.body, req.user!, chamado);
    if (isClaim) {
      const resolved = await resolveUserPermissions(req.user!);
      if (!canClaimTicketResponsavel(resolved, chamado)) {
        throw new PermissionDeniedError('Sem permissão para assumir este ticket');
      }
    } else {
      await assertCanActOnTicket(req.user!, chamado);
    }
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }

  if (req.body.boxId && (req.body.status === undefined || String(req.body.status).trim() === '')) {
    const box = await Box.findById(req.body.boxId);
    if (box) req.body.status = statusFromBoxName(box.name);
  }

  if (!String(req.body.author ?? '').trim() && req.user) {
    req.body.author = req.user.name || req.user.email || '';
  }

  try {
    if (req.body.status != null && String(req.body.status).trim()) {
      assertResponsavelForTerminalStatus(chamado, String(req.body.status));
      if (normalizeStatusValue(String(req.body.status)) === 'resolvido') {
        await assertCanResolveTicketWithOpenWorkflow(req.user!, chamado);
      }
    }
    applyManualResponsavelClaim(chamado, req.user);
    await applyBodyToChamado(chamado, req.body, req.user);
    applyManualResponsavelClaim(chamado, req.user);
    await chamado.save();
    if (chamado.chamadoTitulo !== titleBefore) {
      await ChamadoIaAnalise.updateOne(
        { chamadoId: chamado._id, origem: { $ne: 'manual' } },
        { $set: { needsReanalysis: true } },
      );
    }
    // Gatilhos de e-mail por status "imediato" (ex.: Encerramento s/CSAT) só avaliam na
    // abertura do ticket ou no job de SLA (que ignora "imediato" de propósito) — sem isso,
    // um template configurado pra disparar assim que o status vira X nunca dispara de fato.
    if (currentStatus(chamado) !== statusBefore) {
      evaluateEmailTriggers(chamado, 'event').catch((err) => {
        console.warn('[tickets.routes] evaluateEmailTriggers (PUT status change) fail-soft:', (err as Error).message);
      });
    }

    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.delete('/:id', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });
  try {
    assertChamadoModifiable(chamado);
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
  await chamado.deleteOne();
  await deleteReclamacoesByChamadoId(String(chamado._id)).catch((err: Error) => {
    console.warn('[tickets.routes] deleteReclamacoesByChamadoId fail-soft:', err.message);
  });
  res.json({ success: true });
});

/** Commit atômico: mensagem + nota + tabulação + status + responsável em um save. */
router.post('/:id/commit', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  try {
    assertChamadoModifiable(chamado);
    await assertCanCommitTicket(req.user!, chamado, req.body);
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }

  if (req.body.boxId && (req.body.status === undefined || String(req.body.status).trim() === '')) {
    const box = await Box.findById(req.body.boxId);
    if (box) req.body.status = statusFromBoxName(box.name);
  }

  if (!String(req.body.author ?? '').trim() && req.user) {
    req.body.author = req.user.name || req.user.email || '';
  }

  /** Ticket sem 1ª msg do cliente e sem nota interna prévia: esta será a nota que dá contexto ao Agente 1. */
  const isFirstContextNote = !String(req.body.text ?? '').trim()
    && Boolean(String(req.body.internalText ?? req.body.anotacaoInterna ?? '').trim())
    && !hasMeaningfulClientContextInChamado(chamado)
    && !(chamado.registro || []).some((r) => String(r.anotacaoInterna || '').trim());

  try {
    const targetStatus = req.body.status != null && String(req.body.status).trim()
      ? normalizeStatusValue(req.body.status)
      : currentStatus(chamado);
    const statusChanged = targetStatus !== normalizeStatusValue(currentStatus(chamado));
    if (statusChanged) {
      assertResponsavelForTerminalStatus(chamado, targetStatus);
      if (targetStatus === 'resolvido') {
        await assertCanResolveTicketWithOpenWorkflow(req.user!, chamado);
      }
    }
    applyManualResponsavelClaim(chamado, req.user);
    const commitResult = await commitChamadoFromAgent(chamado, req.body, req.user);
    applyManualResponsavelClaim(chamado, req.user);
    if (commitResult.messageResult.public) {
      const sentPublicContent = Boolean(
        commitResult.publicText.trim()
        || (commitResult.messageResult.public.attachments ?? []).length,
      );
      if (sentPublicContent) {
        await finishWorkflowAfterPublicReply(
          chamado,
          req.user?.name || req.user?.email || 'Agente',
        );
      }
    }
    await chamado.save();

    // Reflete tabulação/status atuais em reclamacoes_* (Procon/Bacen/Consumidor.gov/Reclame Aqui)
    // sempre que o ticket é salvo — sem isto, produto/motivo editados na tabulação "somem" ao
    // reabrir o item na fila do canal especial (a tela lê de reclamacoes_*, não do ticket).
    // No-op fail-soft para tickets sem reclamação vinculada (imensa maioria).
    syncFromChamado(chamado).catch((err: Error) => {
      console.warn('[tickets.routes] syncFromChamado (commit) fail-soft:', err.message);
    });

    // Gatilhos de e-mail por status "imediato" (ex.: Encerramento s/CSAT) só avaliam na
    // abertura do ticket ou no job de SLA (que ignora "imediato" de propósito) — sem isso,
    // um template configurado pra disparar assim que o status vira X nunca dispara de fato.
    if (statusChanged) {
      evaluateEmailTriggers(chamado, 'event').catch((err) => {
        console.warn('[tickets.routes] evaluateEmailTriggers (commit status change) fail-soft:', (err as Error).message);
      });
    }

    // fechado/cancelado nunca reabrem via WhatsApp — desativa o ponteiro já aqui (proativo);
    // resolvido fica ativo até o fim da janela de reabertura, verificado sob demanda no
    // próximo inbound (resolveChamadoViaActivePointer em whatsappInbound.service.ts).
    if (targetStatus === 'fechado' || targetStatus === 'cancelado') {
      void deactivateWaActiveConversationsForTicket(chamado._id.toString(), 'chamados_n1');
    }

    if (isFirstContextNote) {
      void runInboundAgentPipeline(chamado, { source: 'nota-interna-inicial' }).catch((err: Error) => {
        console.warn('[tickets.routes] runInboundAgentPipeline (nota inicial) fail-soft:', err.message);
      });
    }

    if (commitResult.messageResult.public) {
      const publicAttachments = (commitResult.messageResult.public.attachments ?? [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
      const shouldNotifyClient = Boolean(
        commitResult.publicText.trim() || publicAttachments.length,
      );
      // Reclame Aqui não tem outbound de e-mail — "Mensagem Agente"/"Mensagem Cliente" só
      // registram histórico interno, nunca disparam contato real ao cliente por este canal.
      if (shouldNotifyClient && !isReclameAquiChamado(chamado)) {
        await notifyAgentReplyAsync(
          chamado,
          commitResult.publicText,
          undefined,
          commitResult.publicRegistroIndex,
          publicAttachments,
        );
        await chamado.save();
      }
    }

    const boxes = await loadBoxes();
    void publishTicketEvent(chamado._id.toString(), 'commit');
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.post('/:id/messages', authMiddleware, async (req, res: Response) => {
  const { text, sender, internal, attachments, internalText, anotacaoInterna, author } = req.body;
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  try {
    assertChamadoModifiable(chamado);
    await assertCanPostTicketMessage(req.user!, chamado, Boolean(internal));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }

  const attachmentList = Array.isArray(attachments)
    ? attachments.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
    : [];

  const isInternalOnly = Boolean(internal);
  const publicText = isInternalOnly ? '' : String(text ?? '');
  const noteText = isInternalOnly
    ? String(text ?? '')
    : String(internalText ?? anotacaoInterna ?? '');

  /** Ticket sem 1ª msg do cliente e sem nota interna prévia: esta será a nota que dá contexto ao Agente 1. */
  const isFirstContextNote = isInternalOnly
    && noteText.trim().length > 0
    && !hasMeaningfulClientContextInChamado(chamado)
    && !(chamado.registro || []).some((r) => String(r.anotacaoInterna || '').trim());

  applyManualResponsavelClaim(chamado, req.user);

  const result = appendRegistroEntry(chamado, {
    mensagemPublica: publicText,
    anotacaoInterna: noteText,
    anexosMensagemPublica: isInternalOnly ? [] : attachmentList,
    anexosAnotacaoInterna: isInternalOnly ? attachmentList : [],
    sender: sender || 'me',
    autor: String(author ?? req.user?.name ?? req.user?.email ?? '').trim() || undefined,
    authUser: req.user,
  });

  if (!result.public && !result.internal) {
    return res.status(400).json({ message: 'Texto da mensagem ou anotação é obrigatório' });
  }

  const isAgentPublicReply = !isInternalOnly
    && String(sender ?? 'me') !== 'them'
    && Boolean(publicText.trim() || attachmentList.length);
  if (isAgentPublicReply) {
    await finishWorkflowAfterPublicReply(
      chamado,
      req.user?.name || req.user?.email || 'Agente',
    );
  }

  await chamado.save();
  if (!isInternalOnly && publicText.trim() && String(sender ?? 'me') === 'them') {
    await ChamadoIaAnalise.updateOne(
      { chamadoId: chamado._id, origem: { $ne: 'manual' } },
      { $set: { needsReanalysis: true } },
    );
  }

  if (isFirstContextNote) {
    void runInboundAgentPipeline(chamado, { source: 'nota-interna-inicial' }).catch((err: Error) => {
      console.warn('[tickets.routes] runInboundAgentPipeline (nota inicial) fail-soft:', err.message);
    });
  }

  // Reclame Aqui não tem outbound de e-mail — inclui a "Mensagem Cliente" (sender='them',
  // origin='cliente'), que é sempre uma transcrição feita pelo agente, nunca um e-mail real
  // de/para o cliente.
  if (!isInternalOnly && (publicText.trim() || attachmentList.length) && !isReclameAquiChamado(chamado)) {
    await notifyAgentReplyAsync(
      chamado,
      publicText,
      undefined,
      result.public?.registroIndex,
      attachmentList,
    );
    await chamado.save();
    void clearAiSuggestionCache(chamado._id.toString()).catch((err: Error) => {
      console.warn('[tickets.routes] clearAiSuggestionCache fail-soft:', err.message);
    });
  }

  void publishTicketEvent(chamado._id.toString(), 'message');
  res.status(201).json({
    ...(result.public ?? result.internal),
    publicMessage: result.public,
    internalNote: result.internal,
  });
});

router.post('/:id/whatsapp/messages', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  try {
    assertChamadoModifiable(chamado);
    await assertCanActOnTicket(req.user!, chamado);
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }

  const text = String(req.body?.text ?? '').trim();
  const initialTemplate = req.body?.initialTemplate === true;
  const waChatId = String(req.body?.waChatId ?? '').trim() || undefined;
  const attachmentList = Array.isArray(req.body?.attachments)
    ? req.body.attachments.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
    : [];

  if (!initialTemplate && !text && !attachmentList.length) {
    return res.status(400).json({ message: 'Texto ou anexo é obrigatório' });
  }

  let mediaContentTypes: string[] = [];
  let anexosScanStatus: string[] = [];
  if (attachmentList.length) {
    try {
      const metas = await Promise.all(attachmentList.map((url: string) => resolveSentAttachmentSendMeta(url)));
      mediaContentTypes = metas.map((item) => item.contentType);
      anexosScanStatus = metas.map((item) => item.scanStatus);
    } catch (err) {
      return res.status(400).json({ message: (err as Error).message });
    }
  }

  applyManualResponsavelClaim(chamado, req.user);

  const isFirstOutboundMessage = !hasPriorAgentWhatsAppMessage(chamado, waChatId);
  const appendText = text || (initialTemplate ? 'Mensagem inicial WhatsApp (template)' : '');

  let appendResult;
  try {
    appendResult = appendWhatsAppMensagemToChamado(chamado, {
      origin: 'agente',
      autor: String(req.user?.name ?? req.user?.email ?? '').trim() || undefined,
      texto: appendText,
      anexos: attachmentList,
      mediaContentTypes,
      anexosScanStatus,
      waChatId,
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }

  let twilio: WhatsAppChamadoOutboundResult = { sent: false, reason: 'Destino WhatsApp não encontrado no ticket' };
  const sendResult = await sendWhatsAppForChamado(chamado, {
    text: text || undefined,
    waChatId,
    initialTemplate,
    forceTemplate: initialTemplate || undefined,
    attachments: attachmentList,
    agentName: String(req.user?.name ?? '').trim() || undefined,
    isFirstOutboundMessage,
  });
  twilio = sendResult;
  if (sendResult.sent && sendResult.sid) {
      const reg = chamado.registro?.[appendResult.registroIndex];
      if (reg) {
        const list = readWhatsAppMensagens(reg);
        const last = list[list.length - 1];
        if (last) {
          last.twilioMessageSid = sendResult.sid;
          last.deliveryStatus = 'sent';
          last.deliveryStatusAt = new Date().toISOString();
        }
        const meta = (reg.metadados ?? {}) as Record<string, unknown>;
        meta.whatsappMensagens = list;
        reg.metadados = meta;
        appendResult.mensagem.twilioMessageSid = sendResult.sid;
        appendResult.mensagem.deliveryStatus = 'sent';
        appendResult.mensagem.deliveryStatusAt = last?.deliveryStatusAt;
        if (sendResult.mode === 'template' && sendResult.body) {
          appendResult.mensagem.texto = sendResult.body;
          if (last) last.texto = sendResult.body;
        }
      }
    } else if (sendResult.sid) {
      updateWhatsAppMensagemDeliveryBySid(chamado, sendResult.sid, {
        status: 'failed',
        errorMessage: sendResult.reason,
      });
    } else if (!sendResult.sent && sendResult.reason) {
      appendResult.mensagem.deliveryStatus = 'failed';
      appendResult.mensagem.deliveryErrorMessage = sendResult.reason;
    }

  if (sendResult.sent) {
    await finishWorkflowAfterPublicReply(
      chamado,
      req.user?.name || req.user?.email || 'Agente',
    );
  }

  await chamado.save();
  if (sendResult.sent) {
    void clearAiSuggestionCache(chamado._id.toString()).catch((err: Error) => {
      console.warn('[tickets.routes] clearAiSuggestionCache fail-soft:', err.message);
    });
    void upsertWaActiveConversation({
      phoneE164: resolveWaChatIdFromChamado(chamado, waChatId),
      canal: 'whatsapp',
      ticketId: chamado._id.toString(),
      ticketCollection: 'chamados_n1',
      ticketProtocolo: chamado.chamadoProtocolo,
    });
  }
  void publishTicketEvent(chamado._id.toString(), 'whatsapp-outbound');

  const boxes = await loadBoxes();
  const ticket = await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes));

  res.status(201).json({
    mensagem: appendResult.mensagem,
    registroIndex: appendResult.registroIndex,
    createdThread: appendResult.createdThread,
    twilio,
    ticket,
  });
});

router.post(
  '/:id/whatsapp/messages/:messageSid/transcription',
  authMiddleware,
  async (req, res: Response) => {
    const chamado = await ChamadoN1.findById(req.params.id);
    if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

    try {
      await assertCanActOnTicket(req.user!, chamado);
    } catch (err) {
      if (handleTicketMutationError(err, res)) return;
      throw err;
    }

    try {
      const transcriptionStatus = await requestWhatsAppAudioTranscription(
        chamado._id.toString(),
        String(req.params.messageSid || '').trim(),
      );
      const refreshed = await ChamadoN1.findById(chamado._id);
      if (!refreshed) return res.status(404).json({ message: 'Ticket não encontrado' });
      const boxes = await loadBoxes();
      const ticket = await chamadoToTicket(
        refreshed,
        await resolveBoxIdForChamado(refreshed, boxes),
      );
      return res.status(202).json({ transcriptionStatus, ticket });
    } catch (err) {
      return res.status(400).json({ message: (err as Error).message });
    }
  },
);

router.post('/:id/workflow/start', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  try {
    assertChamadoModifiable(chamado);
    await assertCanActOnTicket(req.user!, chamado);
    const requisicaoValores = req.body?.requisicao?.valores as Record<string, unknown> | undefined;
    const solicitacaoProdutos = req.body?.solicitacaoProdutos as Record<string, unknown> | undefined;
    const definicaoSlug = req.body?.definicaoSlug as string | undefined;
    await startWorkflowForChamado(
      chamado,
      req.user,
      requisicaoValores,
      definicaoSlug,
      solicitacaoProdutos,
    );
    applyManualResponsavelClaim(chamado, req.user);
    await chamado.save();
    void publishTicketEvent(chamado._id.toString(), 'workflow');
    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.post('/:id/workflow/advance', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  const decision = req.body?.decision;
  try {
    assertChamadoModifiable(chamado);
    if (decision === 'approve' || decision === 'reject') {
      await advanceWorkflowWithDecision(chamado, decision, req.user);
    } else if (req.body?.pendingDecision === 'approve' || req.body?.pendingDecision === 'reject') {
      setWorkflowPendingDecision(chamado, req.body.pendingDecision);
      await advanceWorkflowManual(chamado, req.user);
    } else {
      await advanceWorkflowManual(chamado, req.user);
    }
    applyManualResponsavelClaim(chamado, req.user);
    await chamado.save();
    void publishTicketEvent(chamado._id.toString(), 'workflow');
    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.post('/:id/workflow/cancel', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';

  try {
    assertChamadoModifiable(chamado);
    await assertCanInterruptWorkflow(req.user!, chamado);
    await cancelWorkflowForChamado(chamado, req.user, motivo || undefined);
    applyManualResponsavelClaim(chamado, req.user);
    await chamado.save();
    void publishTicketEvent(chamado._id.toString(), 'workflow');
    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

router.post('/:id/workflow/comunicacao', authMiddleware, async (req, res: Response) => {
  const chamado = await ChamadoN1.findById(req.params.id);
  if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

  const origem = req.body?.origem === 'responsavel' ? 'responsavel' : 'workflow';
  const mensagem = String(req.body?.mensagem ?? '');

  try {
    assertChamadoModifiable(chamado);
    await assertCanWorkflowComunicacao(req.user!, chamado, origem);
    applyManualResponsavelClaim(chamado, req.user);
    appendComunicacaoWorkflow(chamado, { mensagem, origem }, req.user);
    await chamado.save();
    if (origem === 'workflow') {
      void notifyWorkflowMensagemToResponsavel(chamado);
    } else {
      void notifyAgentReplyToWorkflowResponsavel(chamado);
    }
    void publishTicketEvent(chamado._id.toString(), 'workflow');
    const boxes = await loadBoxes();
    res.json(await chamadoToTicket(chamado, await resolveBoxIdForChamado(chamado, boxes)));
  } catch (err) {
    if (handleTicketMutationError(err, res)) return;
    throw err;
  }
});

export default router;
