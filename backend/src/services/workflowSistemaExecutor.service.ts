/** workflowSistemaExecutor.service v1.3.0 — resposta_cliente: IA ou e-mail padrão (com envelope) */
import type { IChamadoN1 } from '../models/ChamadoN1';
import type { IWorkflowDefinicao, IWorkflowPassoEnvelope, IWorkflowAutomaticaConfig } from '../models/WorkflowDefinicao';
import { appendRegistroEntry } from './chamado.mapper';
import { composeAtendimento } from './agents/atendimentoAgent.service';
import type { TicketAiMessageInput } from './agents/agentTypes';
import { invokeInternalHook } from './workflowInternalHooks';
import { getAgentNomeOficial } from './agents/agentRegistry';
import { detectEnvelopeModoFromChamado, wrapComposerOpening } from './clientMessageEnvelope.service';
import { notifyAgentReplyAsync } from './emailNotification.service';
import { createWorkflowNotificacao } from './workflowNotificacao.service';
import { buildTabulationFieldsFromTicket } from './workflowMatcher.service';
import { isAutomaticaStep, resolveAutomaticaConfig } from './workflowAutomatica.util';
import { getEmailConteudoById } from './emailConteudo.service';
import { applyTicketPlaceholders, resolveChamadoClientName } from './placeholders.util';

const WEBHOOK_TIMEOUT_MS = 15000;

export interface SistemaExecResult {
  ok: boolean;
  autoAdvance: boolean;
  modo: string;
  message?: string;
  detail?: Record<string, unknown>;
}

function normalizeNome(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildWebhookPayload(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  step: number,
  passo: IWorkflowPassoEnvelope,
): Record<string, unknown> {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  return {
    protocolo: chamado.chamadoProtocolo,
    ticketId: chamado._id?.toString(),
    workflowId: String(definicao._id),
    workflowSlug: definicao.slug,
    step,
    passoId: passo._id ? String(passo._id) : null,
    passoNome: passo.passo?.nome || '',
    tabulacao: tab || {},
    titulo: chamado.chamadoTitulo,
    timestamp: new Date().toISOString(),
  };
}

function registroToMessages(chamado: IChamadoN1): TicketAiMessageInput[] {
  const rows: TicketAiMessageInput[] = [];
  for (const reg of chamado.registro || []) {
    const publicText = String(reg.mensagemPublica || '').trim();
    const internalText = String(reg.anotacaoInterna || '').trim();
    if (publicText) {
      rows.push({
        role: reg.origin === 'cliente' ? 'cliente' : 'agente',
        text: publicText,
      });
    }
    if (internalText) {
      rows.push({ role: 'agente', text: `[Nota interna] ${internalText}` });
    }
  }
  return rows.slice(-30);
}

async function executeWebhook(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  step: number,
  passo: IWorkflowPassoEnvelope,
  automatica: IWorkflowAutomaticaConfig,
): Promise<SistemaExecResult> {
  const payload = buildWebhookPayload(chamado, definicao, step, passo);

  if (automatica.webhookTipo === 'interno') {
    const hookId = String(automatica.webhookHookId || '').trim();
    const result = await invokeInternalHook(hookId, {
      chamado,
      workflowId: String(definicao._id),
      workflowSlug: definicao.slug,
      step,
      passoId: passo._id ? String(passo._id) : null,
    });
    return {
      ok: result.ok,
      autoAdvance: result.ok,
      modo: 'acao_sistema',
      message: result.message,
      detail: { hookId, ...result.data },
    };
  }

  const url = String(automatica.webhookUrl || '').trim();
  if (!url) {
    return { ok: false, autoAdvance: false, modo: 'acao_sistema', message: 'URL do webhook não configurada' };
  }

  const method = automatica.webhookMetodo === 'GET' ? 'GET' : 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(automatica.webhookHeaders || {}),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ok = response.status >= 200 && response.status < 300;
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }

    return {
      ok,
      autoAdvance: ok,
      modo: 'acao_sistema',
      message: ok ? 'Webhook executado com sucesso' : `Webhook retornou HTTP ${response.status}`,
      detail: { status: response.status, body: bodyText.slice(0, 500) },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao chamar webhook';
    return { ok: false, autoAdvance: false, modo: 'acao_sistema', message, detail: { error: message } };
  }
}

/** Envelopa o núcleo (IA ou e-mail padrão) e envia como resposta pública ao cliente. */
async function sendRespostaClienteNucleo(
  chamado: IChamadoN1,
  step: number,
  nucleo: string,
  detail: Record<string, unknown>,
): Promise<SistemaExecResult> {
  const composerText = wrapComposerOpening({
    nucleo,
    clientName: await resolveChamadoClientName(chamado),
    modo: detectEnvelopeModoFromChamado(chamado),
  });

  const registroResult = appendRegistroEntry(chamado, {
    mensagemPublica: composerText,
    sender: 'me',
    autor: getAgentNomeOficial(1),
    metadados: {
      sistemaExec: {
        modo: 'resposta_cliente',
        step,
        at: new Date().toISOString(),
        ...detail,
      },
    },
  });
  // appendRegistroEntry só grava no chamado em memória — sem isto a resposta automática
  // dessa etapa "sistema" nunca chegava ao e-mail do cliente, mesmo a mensagem de retorno
  // abaixo dizendo "Resposta enviada ao cliente" (quem chama salva o chamado depois,
  // persistindo o carimbo de emailOutboundMessageId que notifyAgentReplyAsync grava aqui).
  await notifyAgentReplyAsync(chamado, composerText, undefined, registroResult.public?.registroIndex);

  return {
    ok: true,
    autoAdvance: true,
    modo: 'resposta_cliente',
    message: 'Resposta enviada ao cliente',
    detail,
  };
}

async function executeRespostaClienteIa(
  chamado: IChamadoN1,
  passo: IWorkflowPassoEnvelope,
  automatica: IWorkflowAutomaticaConfig,
  step: number,
  messages: TicketAiMessageInput[],
): Promise<SistemaExecResult> {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  const promptExtra = (await applyTicketPlaceholders(automatica.promptContexto || '', chamado)).trim();

  const result = await composeAtendimento({
    ticketId: chamado._id?.toString(),
    protocolo: chamado.chamadoProtocolo,
    titulo: chamado.chamadoTitulo,
    status: chamado.registro?.[chamado.registro.length - 1]?.status,
    contextSource: 'public',
    messages,
    produtoHint: tab?.produto,
    internalNote: promptExtra
      ? `[Contexto da etapa "${passo.passo?.nome || ''}"]\n${promptExtra}`
      : undefined,
  });

  if (!result.success || !result.respostaSugerida?.trim()) {
    return {
      ok: false,
      autoAdvance: false,
      modo: 'resposta_cliente',
      message: result.error || 'Agente de atendimento não retornou resposta',
    };
  }

  return sendRespostaClienteNucleo(chamado, step, result.respostaSugerida.trim(), {
    conteudoModo: 'ia',
    model: result.model,
  });
}

async function executeRespostaClienteEmailPadrao(
  chamado: IChamadoN1,
  automatica: IWorkflowAutomaticaConfig,
  step: number,
): Promise<SistemaExecResult> {
  const conteudoId = String(automatica.emailConteudoId || '').trim();
  const doc = conteudoId ? await getEmailConteudoById(conteudoId) : null;
  const temGatilhoInterno = Boolean(doc?.gatilho?.criterios?.some((c) => c.tipo === 'gatilho_interno'));

  if (!doc || !doc.ativo || !temGatilhoInterno) {
    return {
      ok: false,
      autoAdvance: false,
      modo: 'resposta_cliente',
      message: 'E-mail padrão configurado não encontrado, inativo ou sem "Gatilho interno"',
    };
  }

  const nucleo = (await applyTicketPlaceholders(doc.corpo || '', chamado)).trim();
  if (!nucleo) {
    return {
      ok: false,
      autoAdvance: false,
      modo: 'resposta_cliente',
      message: `E-mail padrão "${doc.nome}" está sem corpo configurado`,
    };
  }

  return sendRespostaClienteNucleo(chamado, step, nucleo, {
    conteudoModo: 'email_padrao',
    emailConteudoId: conteudoId,
    emailConteudoNome: doc.nome,
  });
}

async function executeRespostaCliente(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  step: number,
  passo: IWorkflowPassoEnvelope,
  automatica: IWorkflowAutomaticaConfig,
): Promise<SistemaExecResult> {
  const messages = registroToMessages(chamado);

  if (automatica.conteudoModo === 'email_padrao') {
    return executeRespostaClienteEmailPadrao(chamado, automatica, step);
  }

  return executeRespostaClienteIa(chamado, passo, automatica, step, messages);
}

async function resolveCtaDestinatario(
  chamado: IChamadoN1,
  automatica: IWorkflowAutomaticaConfig,
): Promise<string> {
  const fields = buildTabulationFieldsFromTicket({
    tabulacao: chamado.tabulacao as unknown as Array<Record<string, string>>,
  });
  const alvo = automatica.ctaAlvo || 'responsavel';

  if (alvo === 'responsavel') {
    return String(fields.responsavel || '').trim();
  }
  if (alvo === 'atribuido') {
    const atribuido = String(fields.atribuido || '').trim();
    if (atribuido.startsWith('grupo:')) return '';
    return atribuido;
  }
  return '';
}

async function executeCallToAction(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  step: number,
  passo: IWorkflowPassoEnvelope,
  automatica: IWorkflowAutomaticaConfig,
): Promise<SistemaExecResult> {
  const destinatarioEmail = await resolveCtaDestinatario(chamado, automatica);
  if (!destinatarioEmail) {
    return {
      ok: false,
      autoAdvance: false,
      modo: 'call_to_action',
      message: 'Não foi possível resolver destinatário do CTA',
    };
  }

  const titulo = String(automatica.ctaTitulo || passo.passo?.nome || 'Ação necessária').trim();
  const mensagem = String(
    automatica.ctaMensagem
    || passo.passo?.descricao
    || `O ticket ${chamado.chamadoProtocolo} aguarda sua ação na etapa "${passo.passo?.nome || ''}".`,
  ).trim();

  await createWorkflowNotificacao({
    destinatarioEmail,
    ticketId: chamado._id!.toString(),
    chamadoProtocolo: chamado.chamadoProtocolo,
    workflowId: String(definicao._id),
    workflowSlug: definicao.slug,
    step,
    passoId: passo._id ? String(passo._id) : null,
    titulo,
    mensagem,
  });

  return {
    ok: true,
    autoAdvance: false,
    modo: 'call_to_action',
    message: `Notificação enviada para ${destinatarioEmail}`,
    detail: { destinatarioEmail, titulo },
  };
}

export async function executeSistemaStep(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  step: number,
  passo: IWorkflowPassoEnvelope,
): Promise<SistemaExecResult> {
  if (!isAutomaticaStep(passo.passo)) {
    return { ok: true, autoAdvance: false, modo: 'none', message: 'Etapa não é automática' };
  }

  const automatica = resolveAutomaticaConfig(passo.passo);
  if (!automatica?.modo) {
    return { ok: false, autoAdvance: false, modo: 'none', message: 'Modo automático não configurado' };
  }

  let result: SistemaExecResult;
  switch (automatica.modo) {
    case 'acao_sistema':
      result = await executeWebhook(chamado, definicao, step, passo, automatica);
      break;
    case 'resposta_cliente':
      result = await executeRespostaCliente(chamado, definicao, step, passo, automatica);
      break;
    case 'call_to_action':
      result = await executeCallToAction(chamado, definicao, step, passo, automatica);
      break;
    default:
      result = { ok: false, autoAdvance: false, modo: String(automatica.modo), message: 'Modo automático inválido' };
  }

  appendRegistroEntry(chamado, {
    anotacaoInterna: `[Workflow automático] ${result.message || result.modo}`,
    sender: 'me',
    autor: 'Sistema',
    metadados: {
      sistemaExec: {
        modo: result.modo,
        step,
        ok: result.ok,
        autoAdvance: result.autoAdvance,
        at: new Date().toISOString(),
        detail: result.detail,
      },
    },
  });

  return result;
}

export function isDevolutivaPasso(nome: string): boolean {
  const n = normalizeNome(nome);
  return n.includes('devolutiva') || n.includes('retorno ao cliente');
}
