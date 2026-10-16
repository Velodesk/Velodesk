/**
 * checks/erros v1.1.0 — sinais de problema que não aparecem nos fluxos felizes
 */
import type { Contexto } from '../contexto';
import { buscarTicketsEmNovo, colChamados, filtroExcluirEspeciais, filtroQa, filtroSemResponsavel, filtroStatusAtual } from '../db';
import { estaEmHorarioComercial, eraDaMadrugada, formatarHoraBrt, tempoParadoMs } from '../horarioComercial';
import { ok, falha, parcial, bloqueado, type Ocorrencia } from '../resultado';

const VINTE_QUATRO_H = 24 * 60 * 60 * 1000;
const DUAS_H = 2 * 60 * 60 * 1000;
const TRES_H = 3 * 60 * 60 * 1000;
const CINCO_H = 5 * 60 * 60 * 1000;
/** A partir de quantos tickets parados (3h+) já vira crítico por volume, mesmo sem nenhum passar de 5h. */
const VOLUME_CRITICO = 5;

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
    // Exclui Procon/Consumidor.Gov/Reclame Aqui/Bacen: tickets de Reclame Aqui importados do
    // CRM antigo (Octadesk) chegaram com status "novo" e nunca entram na fila de tratamento —
    // contá-los aqui é falso alarme, não fila parada de verdade.
    const travados = await col.countDocuments({
      ...filtroStatusAtual('novo'),
      ...filtroExcluirEspeciais(),
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

  // X06 — tickets em "novo" sem responsável atribuído agora (fila/roleta não pegou ainda).
  // Diferente de X07: aqui é só a contagem do instante, sem olhar há quanto tempo.
  await coletor.checar('X06', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco.');
    const col = await colChamados();
    const semResponsavel = await col.countDocuments({
      $and: [filtroStatusAtual('novo'), filtroExcluirEspeciais(), filtroSemResponsavel(), { $nor: [filtroQa()] }],
    });
    coletor.metrica({
      nome: 'Tickets em "novo" sem responsável atribuído (agora)',
      valor: semResponsavel,
      situacao: semResponsavel > 10 ? 'Atenção' : 'Normal',
    });
    if (semResponsavel === 0) return ok('Nenhum ticket em "novo" sem responsável atribuído neste instante.');
    if (semResponsavel <= 10) {
      return ok(`${semResponsavel} ticket(s) em "novo" sem responsável no momento — dentro do esperado.`);
    }
    return parcial(
      `${semResponsavel} tickets em "novo" sem responsável atribuído agora — acima do normal, vale checar o roteamento/roleta.`,
    );
  });

  // X07 — tickets parados em "novo" por tempo, com ou sem responsável já atribuído (diferente
  // de X06: aqui conta mesmo ticket já roteado, se o agente ainda não abriu/tratou).
  //
  // Só vira alerta dentro do horário de atendimento humano (8h–19h): fora disso, backlog da
  // madrugada é esperado (ninguém de plantão) e isso é só informativo. E o "tempo parado" de um
  // ticket da madrugada conta a partir da ABERTURA do expediente (8h), não da criação real —
  // senão ele já nasceria "parado há várias horas" no instante em que o primeiro agente loga,
  // antes de qualquer chance real de ser tratado (ver horarioComercial.ts).
  await coletor.checar('X07', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco.');
    const agora = new Date();
    const tickets = await buscarTicketsEmNovo();

    if (!estaEmHorarioComercial(agora)) {
      coletor.metrica({
        nome: 'Tickets em "novo" (fora do horário comercial)',
        valor: tickets.length,
        situacao: 'Normal',
      });
      return ok(
        `${tickets.length} ticket(s) em "novo" no momento — fora do horário de atendimento (8h–19h), sem alarme.`,
      );
    }

    const comTempo = tickets.map((t) => ({
      ...t,
      paradoMs: tempoParadoMs(t.createdAt, agora),
      madrugada: eraDaMadrugada(t.createdAt, agora),
    }));
    const parados2h = comTempo.filter((t) => t.paradoMs > DUAS_H);
    const parados3h = comTempo.filter((t) => t.paradoMs > TRES_H);
    const parados5h = comTempo.filter((t) => t.paradoMs > CINCO_H);

    const critico = parados5h.length > 0 || parados3h.length >= VOLUME_CRITICO;
    const atencao = parados2h.length > 0;
    const situacao = critico ? 'Alerta' : atencao ? 'Atenção' : 'Normal';

    coletor.metrica({
      nome: 'Tickets em "novo" parados (horário comercial)',
      valor: `${parados2h.length} acima de 2h, ${parados3h.length} acima de 3h, ${parados5h.length} acima de 5h`,
      situacao,
    });

    if (!atencao) {
      return ok('Nenhum ticket em "novo" parado há mais de 2h dentro do horário de atendimento.');
    }

    const semResponsavel = parados2h.filter((t) => !t.responsavel);
    const comResponsavel = parados2h.filter((t) => t.responsavel);
    const nomes = [...new Set(comResponsavel.map((t) => t.responsavel))];
    const madrugada = parados2h.filter((t) => t.madrugada);
    const hoje = parados2h.filter((t) => !t.madrugada);

    const resumoGeral =
      `${semResponsavel.length} sem responsável, ${comResponsavel.length} com responsável` +
      (nomes.length ? ` (${nomes.join(', ')})` : '') +
      `. ${madrugada.length} da madrugada (contando desde a abertura às 8h), ${hoje.length} aberto(s) hoje durante o expediente.`;

    // Uma ocorrência por ticket parado — a mensagem do Telegram já sabe truncar/"+N outras" se
    // passar do tamanho (ver montarBlocoPorArea em telegram.ts), então não precisa resumir aqui.
    const ocorrencias: Ocorrencia[] = parados2h
      .slice()
      .sort((a, b) => b.paradoMs - a.paradoMs)
      .map((t) => {
        const horas = (t.paradoMs / (60 * 60 * 1000)).toFixed(1).replace('.0', '');
        const origem = t.madrugada
          ? `criado às ${formatarHoraBrt(t.createdAt)} (madrugada)`
          : `criado às ${formatarHoraBrt(t.createdAt)} hoje`;
        const quem = t.responsavel ? `com responsável: ${t.responsavel}` : 'sem responsável';
        return {
          item: `Ticket ${t.protocolo || '(sem protocolo)'}`,
          resumo: `${origem} — ${horas}h sem tratamento desde a abertura do expediente, ${quem}.`,
          impacto: t.paradoMs,
        };
      });

    if (critico) {
      const motivo =
        parados5h.length > 0
          ? `${parados5h.length} já passam de 5h`
          : `${parados3h.length} tickets passam de 3h ao mesmo tempo`;
      return { ...falha(`${parados2h.length} ticket(s) em "novo" parado(s) há mais de 2h — ${motivo}. ${resumoGeral}`), ocorrencias };
    }
    return { ...parcial(`${parados2h.length} ticket(s) em "novo" parado(s) há mais de 2h. ${resumoGeral}`), ocorrencias };
  });
}
