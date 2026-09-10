/**
 * checks/csat v1.0.0 — pesquisa de satisfação
 *
 * O envio real do CSAT é feito por uma rotina que roda de hora em hora e só
 * dispara 48 horas úteis depois da resolução — não dá para esperar isso numa
 * rodada diária. Então o agente faz duas coisas:
 *  1. testa o registro da nota de ponta a ponta no ticket que ele mesmo criou;
 *  2. audita os números e o acúmulo, que é o que revela rotina parada.
 */
import type { Contexto } from '../contexto';
import { colChamados, filtroStatusAtual, prepararCsatDoTicketQa } from '../db';
import { ok, falha, parcial, bloqueado, comTicket } from '../resultado';

const QUATRO_DIAS = 4 * 24 * 60 * 60 * 1000;
const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

export async function checarCsat(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;
  const principal = ctx.criados[0];
  const semCsat = ctx.criados[2] ?? ctx.criados[1];

  // C01 — registrar a nota
  let notaRegistrada = false;
  await coletor.checar('C01', async () => {
    if (!principal) return bloqueado('Nenhum ticket de teste disponível.');
    if (!ctx.temBanco) {
      return bloqueado(
        'Sem acesso ao banco. Para testar a nota é preciso marcar a pesquisa como enviada no ticket de teste.',
      );
    }
    await prepararCsatDoTicketQa(principal.id);
    const r = await api.responderCsat({
      protocolo: principal.protocolo,
      nota: 5,
      comentario: `Avaliação de teste do agente de QA — rodada ${ctx.runId}.`,
    });
    if (r.status !== 200 || r.body?.ok !== true) {
      return comTicket(falha(`Registro da nota recusado (status ${r.status}): ${r.body?.message ?? ''}`), principal);
    }
    const col = await colChamados();
    const doc = await col.findOne({ chamadoProtocolo: principal.protocolo });
    const csat: any = doc?.csat ?? {};
    if (csat.nota !== 5 || csat.respondido !== true || !csat.respondidoEm) {
      return comTicket(
        falha(`A API aceitou, mas o ticket não guardou a avaliação (nota=${csat.nota}, respondido=${csat.respondido}).`),
        principal,
      );
    }
    const temEvento = (doc?.registro ?? []).some((x: any) =>
      String(x?.anotacaoInterna ?? '').includes('Avaliação CSAT recebida'),
    );
    notaRegistrada = true;
    if (!temEvento) return comTicket(parcial('Nota gravada, mas o evento não apareceu no histórico do ticket.'), principal);
    return comTicket(ok('Nota 5 registrada no ticket, com data da resposta e evento no histórico.'), principal);
  });

  // C02 — nota inválida
  await coletor.checar('C02', async () => {
    if (!principal) return bloqueado('Nenhum ticket de teste disponível.');
    const r = await api.responderCsat({ protocolo: principal.protocolo, nota: 9 });
    if (r.status === 400) return comTicket(ok(`Trava funcionando: nota fora de 1 a 5 recusada ("${r.body?.message ?? ''}").`), principal);
    return comTicket(falha(`Nota inválida NÃO foi recusada (status ${r.status}). A validação de 1 a 5 falhou.`), principal);
  });

  // C03 — avaliação não enviada
  await coletor.checar('C03', async () => {
    if (!semCsat) return bloqueado('Sem ticket auxiliar sem pesquisa enviada para a checagem.');
    const r = await api.responderCsat({ protocolo: semCsat.protocolo, nota: 4 });
    if (r.status === 404) return comTicket(ok('Trava funcionando: protocolo sem pesquisa enviada não aceita nota.'), semCsat);
    if (r.status === 200) {
      return comTicket(falha('O sistema aceitou nota em um ticket que nunca recebeu a pesquisa de satisfação.'), semCsat);
    }
    return comTicket(parcial(`Resposta inesperada (status ${r.status}): ${r.body?.message ?? ''}`), semCsat);
  });

  // C04 — não sobrescreve
  await coletor.checar('C04', async () => {
    if (!notaRegistrada) return bloqueado('A nota não foi registrada nesta rodada.');
    const r = await api.responderCsat({ protocolo: principal.protocolo, nota: 1, comentario: 'segunda tentativa' });
    if (r.status !== 200) return comTicket(parcial(`Segunda resposta devolveu status ${r.status}.`), principal);
    const col = await colChamados();
    const doc = await col.findOne({ chamadoProtocolo: principal.protocolo });
    const nota = doc?.csat?.nota;
    if (nota === 5) return comTicket(ok('Segunda resposta não alterou a nota original (5).'), principal);
    return comTicket(falha(`A nota foi sobrescrita: virou ${nota} quando deveria permanecer 5.`), principal);
  });

  // C05 — página do cliente
  await coletor.checar('C05', async () => {
    const r = await api.paginaCsat();
    if (r.status !== 200) return falha(`A página de avaliação não abriu (status ${r.status}).`);
    const html = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    if (/cardAvaliacao|Sua opini|avalia/i.test(html)) return ok('Página de avaliação do cliente carregou normalmente.');
    return parcial('A página respondeu, mas o conteúdo não parece ser o card de avaliação.');
  });

  // C06 — números
  await coletor.checar('C06', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para calcular os números do CSAT.');
    const col = await colChamados();
    const desde = new Date(Date.now() - SETE_DIAS);
    const enviados = await col.countDocuments({ 'csat.enviado': true, 'csat.enviadoEm': { $gte: desde } });
    const respondidos = await col.countDocuments({ 'csat.respondido': true, 'csat.respondidoEm': { $gte: desde } });
    const taxa = enviados > 0 ? (respondidos / enviados) * 100 : 0;
    const media = await col
      .aggregate([
        { $match: { 'csat.respondido': true, 'csat.respondidoEm': { $gte: desde } } },
        { $group: { _id: null, media: { $avg: '$csat.nota' } } },
      ])
      .toArray();
    const notaMedia = media[0]?.media ? Number(media[0].media).toFixed(2) : '-';

    coletor.metrica({ nome: 'CSAT enviados (7 dias)', valor: enviados, situacao: enviados === 0 ? 'Alerta' : 'Normal' });
    coletor.metrica({ nome: 'CSAT respondidos (7 dias)', valor: respondidos, situacao: 'Normal' });
    coletor.metrica({
      nome: 'Taxa de resposta do CSAT (7 dias)',
      valor: `${taxa.toFixed(1)}%`,
      situacao: enviados > 0 && taxa < 5 ? 'Atenção' : 'Normal',
    });
    coletor.metrica({ nome: 'Nota média do CSAT (7 dias)', valor: notaMedia, situacao: 'Normal' });

    if (enviados === 0) {
      return falha(
        'Nenhuma pesquisa de satisfação enviada nos últimos 7 dias. Verifique o modelo de e-mail e o transporte.',
      );
    }
    return ok(
      `${enviados} pesquisa(s) enviada(s) e ${respondidos} respondida(s) em 7 dias — ` +
        `taxa de ${taxa.toFixed(1)}%, nota média ${notaMedia}.`,
    );
  });

  // C07 — rotina de envio
  await coletor.checar('C07', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir a rotina de CSAT.');
    const col = await colChamados();
    const atrasados = await col.countDocuments({
      ...filtroStatusAtual('resolvido'),
      updatedAt: { $lt: new Date(Date.now() - QUATRO_DIAS) },
      $or: [{ 'csat.enviado': { $exists: false } }, { 'csat.enviado': false }],
    });
    coletor.metrica({
      nome: 'Resolvidos há mais de 4 dias sem pesquisa enviada',
      valor: atrasados,
      situacao: atrasados > 20 ? 'Alerta' : atrasados > 0 ? 'Atenção' : 'Normal',
    });
    if (atrasados === 0) return ok('Nenhum acúmulo — a rotina que envia a pesquisa está rodando.');
    if (atrasados <= 20) {
      return parcial(`${atrasados} ticket(s) resolvido(s) há mais de 4 dias ainda sem pesquisa enviada.`);
    }
    return falha(
      `${atrasados} tickets resolvidos há mais de 4 dias sem pesquisa enviada. A rotina horária do CSAT ` +
        'parece parada ou o modelo de e-mail está inativo.',
    );
  });
}
