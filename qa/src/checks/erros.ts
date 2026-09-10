/**
 * checks/erros v1.0.0 — sinais de problema que não aparecem nos fluxos felizes
 */
import type { Contexto } from '../contexto';
import { colChamados, filtroStatusAtual } from '../db';
import { ok, falha, parcial, bloqueado } from '../resultado';

const VINTE_QUATRO_H = 24 * 60 * 60 * 1000;

export async function checarErros(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;

  // X01 — erros de servidor durante a rodada
  await coletor.checar('X01', async () => {
    const erros = coletor.erros5xx;
    coletor.metrica({
      nome: 'Chamadas com erro de servidor ou sem resposta',
      valor: erros.length,
      situacao: erros.length ? 'Alerta' : 'Normal',
    });
    if (!erros.length) return ok('Nenhum erro de servidor nas chamadas feitas nesta rodada.');
    return falha(
      `${erros.length} chamada(s) com erro de servidor ou sem resposta: ${erros.slice(0, 6).join('; ')}`,
    );
  });

  // X03 — tickets sem protocolo
  await coletor.checar('X03', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco.');
    const col = await colChamados();
    const pendentes = await col.countDocuments({
      chamadoProtocolo: { $regex: '^__SIMULACAO_PENDENTE__:' },
    });
    const semProtocolo = await col.countDocuments({
      $or: [{ chamadoProtocolo: { $exists: false } }, { chamadoProtocolo: '' }],
      createdAt: { $gte: new Date(Date.now() - 7 * VINTE_QUATRO_H) },
    });
    const total = pendentes + semProtocolo;
    coletor.metrica({
      nome: 'Tickets sem número de protocolo',
      valor: total,
      situacao: total ? 'Alerta' : 'Normal',
    });
    if (total === 0) return ok('Todos os tickets recentes receberam número de protocolo.');
    return falha(
      `${total} ticket(s) sem protocolo definido (${pendentes} aguardando atribuição). ` +
        'O cliente não tem número para acompanhar o atendimento.',
    );
  });

  // X04 — tickets travados em "novo"
  await coletor.checar('X04', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco.');
    const col = await colChamados();
    const travados = await col.countDocuments({
      ...filtroStatusAtual('novo'),
      createdAt: { $lt: new Date(Date.now() - VINTE_QUATRO_H) },
    });
    coletor.metrica({
      nome: 'Tickets em "novo" há mais de 24h',
      valor: travados,
      situacao: travados > 50 ? 'Alerta' : travados > 0 ? 'Atenção' : 'Normal',
    });
    if (travados === 0) return ok('Nenhum ticket parado em "novo" por mais de 24h.');
    if (travados <= 50) return parcial(`${travados} ticket(s) ainda em "novo" com mais de 24h de aberto.`);
    return falha(`${travados} tickets parados em "novo" há mais de 24h — fila sem tratamento ou roleta parada.`);
  });

  // X05 — módulos do console
  await coletor.checar('X05', async () => {
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    const r = await api.moduleStatus();
    if (r.status !== 200) return falha(`Consulta de módulos falhou (status ${r.status}).`);
    const items: any[] = r.body?.items ?? [];
    if (!items.length) return parcial('Nenhum módulo retornado — a configuração do console pode estar indisponível.');
    const problemas = items.filter((i) => String(i?.status ?? '').toLowerCase() !== 'on');
    if (!problemas.length) return ok(`Todos os ${items.length} módulos estão ligados.`);
    return parcial(
      `Módulo(s) fora do ar ou em revisão: ${problemas.map((i) => `${i.label} (${i.status})`).join(', ')}.`,
    );
  });
}
