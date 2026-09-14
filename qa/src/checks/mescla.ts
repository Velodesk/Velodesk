/**
 * checks/mescla v1.0.0 — fusão de tickets do mesmo cliente
 *
 * Usa apenas os dois tickets auxiliares criados pela própria rodada. O agente
 * nunca mescla ticket de cliente real.
 */
import { cfg } from '../config';
import type { Contexto } from '../contexto';
import { colChamados, buscarComRetry } from '../db';
import { ok, falha, parcial, bloqueado, comTicket } from '../resultado';

/** Busca o chamado por protocolo, tentando de novo se a condição não bater (ver buscarComRetry em db.ts). */
async function buscarChamadoComRetry(protocolo: string, condicaoOk: (doc: any) => boolean): Promise<any> {
  const col = await colChamados();
  return buscarComRetry(() => col.findOne({ chamadoProtocolo: protocolo }), condicaoOk);
}

export async function checarMesclas(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;
  const inativo = ctx.criados[1];
  const ativo = ctx.criados[2];

  // M03 — trava de CPF divergente.
  // Roda ANTES da mescla, de propósito. A ordem das validações no backend é: CPF com 11
  // dígitos → ticket ativo válido → lista de inativos não vazia → nenhum fechado →
  // nenhum já absorvido → e só então a comparação de CPF. Se este caso rodasse depois de
  // M01, o inativo já estaria absorvido e o 400 viria da validação anterior, sem nunca
  // exercitar a trava de CPF. Por isso também exige que a MENSAGEM seja a de CPF: só
  // conferir "deu 4xx" aceitaria a recusa errada e mascararia a trava removida.
  await coletor.checar('M03', async () => {
    if (!ativo || !inativo) return bloqueado('São necessários dois tickets de teste e apenas um foi criado.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    const r = await api.fundir({ activeId: ativo.id, inactiveIds: [inativo.id], cpf: '00000000000' });
    const msg = String(r.body?.message ?? '');
    const tks = [{ ...ativo, papel: 'ativo' }, { ...inativo, papel: 'inativo' }];
    if (r.status === 200) {
      return comTicket(falha('O sistema aceitou uma mesclagem com CPF que não pertence aos tickets.'), ...tks);
    }
    if (/cpf|pertence/i.test(msg)) {
      return comTicket(ok(`Trava funcionando: o sistema recusou com "${msg}".`), ...tks);
    }
    return comTicket(
      parcial(`Recusou (status ${r.status}), mas por outro motivo: "${msg}". A trava de CPF não foi exercitada.`),
      ...tks,
    );
  });

  // M01 — mesclar
  let mesclou = false;
  await coletor.checar('M01', async () => {
    if (!ativo || !inativo) return bloqueado('São necessários dois tickets de teste e apenas um foi criado.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    const r = await api.fundir({ activeId: ativo.id, inactiveIds: [inativo.id], cpf: cfg.cpfQa });
    const tks = [{ ...ativo, papel: 'ativo' }, { ...inativo, papel: 'inativo' }];
    if (r.status !== 200 || r.body?.success !== true) {
      return comTicket(
        falha(`Mesclagem recusada (status ${r.status}): ${r.body?.message ?? JSON.stringify(r.body).slice(0, 160)}`),
        ...tks,
      );
    }
    mesclou = true;
    if (ctx.temBanco) {
      const doc = await buscarChamadoComRetry(
        ativo.protocolo,
        (d) => d?.fusao?.fundido === true && d?.fusao?.hierarquia === 'superior',
      );
      const fusao: any = doc?.fusao ?? {};
      if (fusao.fundido !== true || fusao.hierarquia !== 'superior') {
        return comTicket(
          falha('A API respondeu com sucesso, mas o ticket ativo não ficou marcado como superior da mesclagem.'),
          ...tks,
        );
      }
      const filhos: string[] = fusao.childProtocolos ?? [];
      if (!filhos.includes(inativo.protocolo)) {
        return comTicket(
          parcial(`Mesclagem registrada, mas o protocolo absorvido ${inativo.protocolo} não aparece na lista do ticket ativo.`),
          ...tks,
        );
      }
    }
    return comTicket(
      ok(`Ticket ${inativo.protocolo} mesclado ao ativo ${ativo.protocolo}, com o registro da mesclagem no histórico.`),
      ...tks,
    );
  });

  // M02 — absorvido sai da fila
  await coletor.checar('M02', async () => {
    if (!mesclou) return bloqueado('A mesclagem não aconteceu nesta rodada.');
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir o ticket absorvido.');
    const doc = await buscarChamadoComRetry(
      inativo.protocolo,
      (d) => d?.fusao?.fundido === true && d?.fusao?.hierarquia === 'inferior',
    );
    const registros: any[] = doc?.registro ?? [];
    const statusAtual = registros.length ? String(registros[registros.length - 1].status ?? '') : '';
    const fusao: any = doc?.fusao ?? {};
    if (fusao.hierarquia !== 'inferior' || fusao.fundido !== true) {
      return comTicket(falha('O ticket absorvido não ficou marcado como inferior da mesclagem — ele continuaria nas filas.'), inativo);
    }
    if (statusAtual !== 'resolvido') {
      return comTicket(parcial(`Ticket absorvido marcado corretamente, mas ficou com status "${statusAtual}".`), inativo);
    }
    return comTicket(ok('Ticket absorvido foi resolvido e marcado como inferior — sai das filas abertas.'), inativo);
  });

  // M04 — mesclas do dia
  await coletor.checar('M04', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para contar as mesclas.');
    const col = await colChamados();
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const total = await col.countDocuments({ 'fusao.dataFundido': { $gte: desde } });
    coletor.metrica({ nome: 'Mesclas nas últimas 24h', valor: total, situacao: 'Normal' });
    return ok(`${total} mescla(s) registrada(s) nas últimas 24h (inclui as do próprio teste).`);
  });
}
