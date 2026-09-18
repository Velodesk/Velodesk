/**
 * csatEmail.service v1.4.0 — remove card grande duplicado (usa so a linha compacta)
 * VERSION: v1.4.0 | DATE: 2026-08-24
 */
import fs from 'fs';
import path from 'path';
import { ChamadoN1, type IChamadoN1 } from '../models/ChamadoN1';
import { env } from '../config/env';
import { isEspeciaisChamado, currentStatus } from './chamado.mapper';
import { resolveClienteEmailFromChamado } from './emailNotification.service';
import { applyTicketPlaceholders, resolveTicketSaudacao } from './placeholders.util';
import { getEmailConteudoByNome } from './emailConteudo.service';
import { businessMsBetween } from './dates/businessHours.util';
import { assembleClientEmail, plainTextToEmailHtml } from './emailSkeleton.service';
import { escapeHtmlAttribute } from './emailHtml.util';
import { sendOutboundEmail } from './email-outbound.service';
import { blockQaOutboundEmail } from './qaEmailGuard.service';
import {
  buildOutboundMessageId,
  persistOutboundEmailMeta,
} from './emailThread.service';

/** Casa "TESTE" como palavra isolada — evita falso positivo em palavras como "atestado". */
const TESTE_MARKER_PATTERN = /\bteste\b/i;

/**
 * Ticket marcado como teste pelo próprio time (assunto do ticket ou qualquer anotação
 * interna do histórico contendo "TESTE") nunca recebe CSAT — convenção pedida pra evitar
 * poluir a nota real com tickets de teste manuais/telefone que não passam pelo agente de QA
 * (esses já são cobertos por blockQaOutboundEmail).
 */
function hasTesteMarker(chamado: IChamadoN1): boolean {
  if (TESTE_MARKER_PATTERN.test(String(chamado.chamadoTitulo ?? ''))) return true;
  const registros = chamado.registro ?? [];
  return registros.some((reg) => TESTE_MARKER_PATTERN.test(String(reg.anotacaoInterna ?? '')));
}

// CSAT dispara com o ticket já "resolvido", mas o selo do cabeçalho não deve dizer
// "RESOLVIDO" — precisa deixar claro que este e-mail é a pesquisa de satisfação, não o
// aviso de encerramento em si. Mesmo formato "• PROTOCOLO · <RÓTULO>" dos demais status
// (ver emailBrand.util.ts), só que fixo, independente do status real do ticket.
const CSAT_HEADER_STATUS_LABEL = '• PROTOCOLO · PESQUISA DE SATISFAÇÃO';

const CSAT_STAR_FILENAME = 'csat-star.png';

function resolveCsatStarPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'assets', 'email', CSAT_STAR_FILENAME),
    path.join(__dirname, '..', '..', 'assets', 'email', CSAT_STAR_FILENAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let cachedCsatStarDataUri: string | null | undefined;

/** Estrela ilustrada (imagem, não glifo ★) embutida como data URI — cacheada em memória. */
function loadCsatStarDataUri(): string | null {
  if (cachedCsatStarDataUri !== undefined) return cachedCsatStarDataUri;
  const starPath = resolveCsatStarPath();
  if (!starPath) {
    console.warn('[csatEmail] imagem da estrela não encontrada — usando fallback ★');
    cachedCsatStarDataUri = null;
    return null;
  }
  try {
    const buffer = fs.readFileSync(starPath);
    cachedCsatStarDataUri = `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.warn('[csatEmail] falha ao ler imagem da estrela:', (err as Error).message);
    cachedCsatStarDataUri = null;
  }
  return cachedCsatStarDataUri;
}

/** Linha discreta "Avaliação referente ao protocolo X." — formato compacto, não o card grande padrão. */
export function buildCsatProtocoloLineHtml(protocolo: string): string {
  const safeProtocolo = escapeHtmlAttribute(protocolo);
  return `<p style="margin:0 0 16px 0;font-size:13px;color:#5A6472;font-family:Arial,sans-serif;">Avaliação referente ao protocolo <strong style="color:#1634FF;">${safeProtocolo}</strong>.</p>`;
}

/**
 * Tamanho (px) de cada estrela — crescente de 1 a 5: nota 1 é a menor e a estrela vai
 * crescendo até a nota 5, a maior (reforça visualmente que 5 é a nota máxima).
 */
const CSAT_STAR_SIZE_BY_RATING: Record<number, number> = { 1: 28, 2: 32, 3: 36, 4: 40, 5: 44 };

/** Monta o bloco HTML das 5 estrelas clicáveis (cada uma é um <a href> com nota na URL). */
export function buildCsatStarsHtml(protocolo: string): string {
  const base = env.twilioWebhookPublicBaseUrl.replace(/\/+$/, '');
  const safeProtocolo = encodeURIComponent(protocolo);
  const starDataUri = loadCsatStarDataUri();
  const stars = [1, 2, 3, 4, 5]
    .map((n) => {
      const href = escapeHtmlAttribute(`${base}/csat?protocolo=${safeProtocolo}&nota=${n}`);
      const size = CSAT_STAR_SIZE_BY_RATING[n];
      const starVisual = starDataUri
        ? `<img src="${starDataUri}" width="${size}" height="${size}" alt="★" style="display:inline-block;width:${size}px;height:${size}px;border:0;">`
        : `<span style="font-size:${size}px;line-height:1;color:#FFB800;">★</span>`;
      // valign="bottom" + altura fixa: estrelas de tamanhos diferentes (crescente 1→5) ficam
      // ancoradas embaixo da célula, então o número abaixo de cada uma alinha na mesma linha
      // reta — sem isso (valign="top"), cada número começa logo depois da sua estrela e a
      // fileira de números fica em zigue-zague.
      return `<td align="center" valign="bottom" height="70" style="padding:0 4px;">
      <a href="${href}" target="_blank" style="text-decoration:none;display:inline-block;">
        ${starVisual}
        <br>
        <span style="font-size:11px;color:#9AA0AE;">${n}</span>
      </a>
    </td>`;
    })
    .join('\n');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td colspan="5" style="text-align:center;padding:0 0 10px 0;">
    <p style="margin:0;font-size:19px;font-weight:700;color:#272A30;font-family:Arial,sans-serif;">Como foi o seu atendimento?</p>
    <p style="margin:6px 0 16px 0;font-size:16px;color:#9AA0AE;font-family:Arial,sans-serif;">Clique nas estrelas para dar sua nota, de 1 a 5.</p>
  </td></tr>
  <tr>${stars}</tr>
</table>`;
}

async function composeAndSendCsatEmail(
  chamado: IChamadoN1,
  opts: { templateNome: string; isRepescagem: boolean },
): Promise<void> {
  // Guard: canal especial não recebe CSAT
  if (isEspeciaisChamado(chamado)) return;

  // Guard: ticket marcado como teste (assunto ou anotação interna) nunca recebe CSAT
  if (hasTesteMarker(chamado)) {
    console.info('[csatEmail] envio pulado — ticket marcado como TESTE:', chamado.chamadoProtocolo);
    return;
  }

  // Guards de idempotência
  if (opts.isRepescagem) {
    if (!chamado.csat?.enviado || chamado.csat.respondido || chamado.csat.repescagemEnviada) return;
  } else {
    if (chamado.csat?.enviado) return;
  }

  // Resolve e-mail do cliente
  const to = await resolveClienteEmailFromChamado(chamado);
  if (!to) {
    console.warn('[csatEmail] sem e-mail de cliente para CSAT:', chamado.chamadoProtocolo);
    return;
  }

  // Busca template ativo
  const doc = await getEmailConteudoByNome(opts.templateNome);
  if (!doc) {
    console.warn(`[csatEmail] template "${opts.templateNome}" não encontrado ou inativo`);
    return;
  }

  const saudacao = await resolveTicketSaudacao(doc.saudacao || '', chamado);
  const corpoTexto = await applyTicketPlaceholders(doc.corpo || '', chamado);
  const corpoTextoHtml = plainTextToEmailHtml(corpoTexto);
  const protocolo = String(chamado.chamadoProtocolo ?? '').trim();
  const protocoloLineHtml = buildCsatProtocoloLineHtml(protocolo);
  const blocoEstrelasHtml = buildCsatStarsHtml(protocolo);
  const corpo = `${corpoTextoHtml}\n${protocoloLineHtml}\n${blocoEstrelasHtml}`;

  const assembled = await assembleClientEmail({
    mode: 'template',
    chamado,
    saudacao,
    corpo,
    corpoAlreadyHtml: true,
    // CSAT usa a linha compacta "Avaliação referente ao protocolo X." (dentro de
    // `corpo`, via buildCsatProtocoloLineHtml) no lugar do card grande "Atendimento"
    // que os demais e-mails de saída usam — evita duplicar a referência ao protocolo.
    showTicketBox: false,
    statusLabelOverride: CSAT_HEADER_STATUS_LABEL,
  });

  const messageId = buildOutboundMessageId(protocolo);
  // CSAT chega como thread NOVA — sem In-Reply-To/References e sem "Re:" no assunto,
  // senão o cliente do e-mail agrupa a pesquisa dentro da conversa do atendimento.
  const subject = `Protocolo ${protocolo} - Pesquisa de Satisfação`;

  // Trava de QA: ticket de teste nunca envia e-mail para fora da lista segura.
  const bloqueioQa = blockQaOutboundEmail(chamado, to);
  if (bloqueioQa) {
    console.warn('[csatEmail] envio bloqueado pela trava de QA:', bloqueioQa);
    return;
  }

  const result = await sendOutboundEmail({
    to,
    subject,
    text: assembled.text,
    html: assembled.html,
    headers: { messageId },
    inlineImages: assembled.inlineImages,
  });

  if (!result.sent) {
    console.warn('[csatEmail] não enviado:', opts.templateNome, result.reason);
    return;
  }

  // Registro de auditoria (mesmo padrão de sendTemplateEmail em emailTrigger.service)
  const status = currentStatus(chamado);
  if (!chamado.registro) chamado.registro = [];
  chamado.registro.push({
    data: new Date(),
    origin: 'sistema',
    autor: 'e-mail padrão',
    mensagemPublica: [saudacao, corpoTexto].filter(Boolean).join('\n\n'),
    anexosMensagemPublica: [],
    anotacaoInterna: `Mensagem Automática Enviada: ${opts.templateNome}`,
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: { emailPadraoId: String(doc._id), emailPadraoNome: doc.nome, csatType: opts.isRepescagem ? 'repescagem' : 'inicial' },
    status,
  });

  persistOutboundEmailMeta(chamado, messageId, chamado.registro.length - 1);

  // Atualiza subdocumento csat
  const now = new Date();
  if (opts.isRepescagem) {
    chamado.csat!.repescagemEnviada = true;
    chamado.csat!.repescagemEnviadaEm = now;
  } else {
    chamado.csat = {
      enviado: true,
      enviadoEm: now,
      nota: null,
      comentario: '',
      respondido: false,
      respondidoEm: null,
      repescagemEnviada: false,
      repescagemEnviadaEm: null,
    };
  }

  await chamado.save();

  console.info('[csatEmail] enviado:', {
    protocolo,
    to,
    tipo: opts.isRepescagem ? 'repescagem' : 'inicial',
  });
}

/** Dispara e-mail de CSAT no encerramento do ticket. Fail-soft. */
export async function sendCsatEmailAsync(chamado: IChamadoN1): Promise<void> {
  try {
    await composeAndSendCsatEmail(chamado, {
      templateNome: 'Encerramento mais satisfação',
      isRepescagem: false,
    });
  } catch (err) {
    console.warn('[csatEmail] falha ao enviar CSAT:', (err as Error).message);
  }
}

/** Dispara e-mail de repescagem de CSAT. Fail-soft. */
export async function sendCsatRepescagemEmailAsync(chamado: IChamadoN1): Promise<void> {
  try {
    await composeAndSendCsatEmail(chamado, {
      templateNome: 'Repescagem da satisfação',
      isRepescagem: true,
    });
  } catch (err) {
    console.warn('[csatEmail] falha ao enviar repescagem CSAT:', (err as Error).message);
  }
}

const CSAT_INICIAL_TEMPLATE_NOME = 'Encerramento mais satisfação';
const CSAT_INICIAL_DEFAULT_STATUS = 'resolvido';
const CSAT_INICIAL_DEFAULT_PRAZO_HORAS = 48;

export interface CsatInicialResult {
  scanned: number;
  sent: number;
  errors: number;
}

/**
 * Instante em que o ticket ENTROU no status alvo — não o timestamp do último registro
 * qualquer. Antes, `since` pegava a data do último registro do array, então qualquer
 * atividade nova no ticket já resolvido (nota interna, outro e-mail automático, etc.)
 * empurrava a contagem do prazo pra frente indefinidamente, fazendo o CSAT disparar muito
 * depois do prazo configurado (ou nunca, se o ticket seguisse recebendo eventos). Anda pra
 * trás a partir do fim enquanto o status bater com o alvo, e fica com o mais antigo da
 * sequência — ou seja, o momento exato da transição pro status alvo.
 */
function resolveStatusSinceDate(registros: Array<{ status?: string | null; data?: Date | null }>, status: string): Date | null {
  let anchor: Date | null = null;
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    const reg = registros[i];
    if (String(reg?.status || '').toLowerCase() !== status) break;
    anchor = reg?.data ? new Date(reg.data) : anchor;
  }
  return anchor;
}

/**
 * Dispara a pesquisa de CSAT inicial de acordo com o gatilho configurado no
 * próprio e-mail (aba Emails de Saída, template "Encerramento mais satisfação"):
 * qual status inicia a contagem e o prazo (horas úteis) até o disparo. Decoupled
 * do fechamento automático de tickets — se o e-mail estiver inativo, não dispara.
 */
export async function runCsatInicialPastWindow(now = new Date()): Promise<CsatInicialResult> {
  const doc = await getEmailConteudoByNome(CSAT_INICIAL_TEMPLATE_NOME);
  if (!doc) return { scanned: 0, sent: 0, errors: 0 };

  const criterio = (doc.gatilho?.criterios || []).find((item) => item.tipo === 'gatilho_interno');
  const status = criterio?.valores?.[0] || CSAT_INICIAL_DEFAULT_STATUS;
  const prazoTipo = criterio?.prazoTipo === 'imediato' ? 'imediato' : 'horas';
  const prazoHoras = prazoTipo === 'horas'
    ? (Number(criterio?.prazoHoras) > 0 ? Number(criterio?.prazoHoras) : CSAT_INICIAL_DEFAULT_PRAZO_HORAS)
    : 0;
  const prazoMs = prazoHoras * 60 * 60 * 1000;

  const candidates = await ChamadoN1.find({
    $expr: { $eq: [{ $arrayElemAt: ['$registro.status', -1] }, status] },
    $or: [{ 'csat.enviado': { $exists: false } }, { 'csat.enviado': false }],
  }).select('_id chamadoProtocolo cliente registro csat tabulacao');

  let sent = 0;
  let errors = 0;
  for (const chamado of candidates) {
    try {
      const registros = chamado.registro ?? [];
      const last = registros[registros.length - 1];
      if (!last || String(last.status || '').toLowerCase() !== status) continue;

      if (prazoMs > 0) {
        const since = resolveStatusSinceDate(registros, status);
        if (!since || Number.isNaN(since.getTime())) continue;
        if (businessMsBetween(since, now) < prazoMs) continue;
      }

      await sendCsatEmailAsync(chamado);
      if (chamado.csat?.enviado) sent += 1;
    } catch (err) {
      errors += 1;
      console.warn(
        '[csat-inicial] falha',
        chamado.chamadoProtocolo || chamado._id?.toString(),
        (err as Error).message,
      );
    }
  }

  return { scanned: candidates.length, sent, errors };
}
