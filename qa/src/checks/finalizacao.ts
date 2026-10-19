/**
 * checks/finalizacao v1.0.0 — travas de encerramento e rotinas automáticas
 *
 * F01 e F02 são checagens de contrato: esperam que o sistema RECUSE a operação.
 * Rodam num ticket auxiliar que ainda não tem responsável nem tabulação, e por
 * isso não alteram nada.
 */
import { cfg } from '../config';
import type { Contexto } from '../contexto';
import { colChamados, filtroStatusAtual, filtroStatusAtualEm, buscarComRetry } from '../db';
import { ok, falha, parcial, bloqueado, comTicket, pareceOperacaoEmLote } from '../resultado';

const TRES_DIAS = 3 * 24 * 60 * 60 * 1000;
const QUATRO_DIAS = 4 * 24 * 60 * 60 * 1000;

export async function checarFinalizacao(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;
  const principal = ctx.criados[0];
  const auxiliar = ctx.criados.find((t, i) => i > 0);

  // F01 — trava de responsável
  await coletor.checar('F01', async () => {
    if (!auxiliar) return bloqueado('Sem ticket auxiliar de teste nesta rodada.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    if (!ctx.tabulacao) {
      // Sem tabulação válida no corpo, quem barra primeiro é a trava de tabulação, e o
      // caso não diria nada sobre a trava de responsável.
      return bloqueado(
        'Sem tabulação válida nesta rodada — a recusa viria da trava de tabulação e não diria ' +
          'nada sobre a de responsável. Ver o caso R03.',
      );
    }
    const r = await api.commit(auxiliar.id, {
      status: 'resolvido',
      author: ctx.nomeAtendente || cfg.responsavel,
      lateralForm: { ...(ctx.tabulacao ?? {}), responsavel: '' },
    });
    if (r.status === 400 && /respons/i.test(String(r.body?.message ?? ''))) {
      return comTicket(ok(`Trava funcionando: o sistema recusou com "${r.body.message}".`), auxiliar);
    }
    if (r.status === 200) {
      return comTicket(
        falha('O ticket foi ENCERRADO sem responsável definido. A trava que exige responsável real não funcionou.'),
        auxiliar,
      );
    }
    return comTicket(parcial(`Recusou, mas com outra mensagem (status ${r.status}): ${r.body?.message ?? ''}`), auxiliar);
  });

  // F02 — trava de tabulação
  await coletor.checar('F02', async () => {
    if (!auxiliar) return bloqueado('Sem ticket auxiliar de teste nesta rodada.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    // Passo preparatório: grava só o responsável, usando um status que não
    // exige tabulação. Sem isso a recusa viria da trava de responsável (F01) e
    // não daria para saber se a trava de tabulação funciona.
    const prep = await api.commit(auxiliar.id, {
      status: 'em-espera',
      author: ctx.nomeAtendente || cfg.responsavel,
      lateralForm: {
        produto: '',
        tipoChamado: '',
        motivo: '',
        detalhe: '',
        canal: 'App',
        responsavel: ctx.nomeAtendente || cfg.responsavel,
      },
    });
    if (prep.status !== 200) {
      return bloqueado(
        `Não foi possível preparar o ticket para esta checagem (status ${prep.status}: ${prep.body?.message ?? ''}).`,
      );
    }
    const r = await api.commit(auxiliar.id, {
      status: 'resolvido',
      author: ctx.nomeAtendente || cfg.responsavel,
      lateralForm: {
        produto: '',
        tipoChamado: '',
        motivo: '',
        detalhe: '',
        canal: 'App',
        responsavel: ctx.nomeAtendente || cfg.responsavel,
      },
    });
    const msg = String(r.body?.message ?? '');
    if (r.status === 400 && /tabula|produto|motivo|preencha/i.test(msg)) {
      return comTicket(ok(`Trava funcionando: o sistema recusou com "${msg}".`), auxiliar);
    }
    if (r.status === 400) return comTicket(parcial(`Recusou, mas por outro motivo: "${msg}".`), auxiliar);
    if (r.status === 200) {
      return comTicket(falha('O ticket foi ENCERRADO sem tabulação. A trava que exige produto/tipo/motivo não funcionou.'), auxiliar);
    }
    return comTicket(parcial(`Resposta inesperada (status ${r.status}): ${r.body?.message ?? ''}`), auxiliar);
  });

  // F03 — finalizar de verdade
  await coletor.checar('F03', async () => {
    if (!principal) return bloqueado('Nenhum ticket de teste disponível.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    if (!ctx.tabulacao) return bloqueado('Sem tabulação válida para finalizar o ticket.');
    const r = await api.commit(principal.id, {
      status: 'resolvido',
      author: ctx.nomeAtendente || cfg.responsavel,
      lateralForm: { ...ctx.tabulacao, responsavel: ctx.nomeAtendente || cfg.responsavel },
    });
    if (r.status !== 200) {
      return comTicket(falha(`Finalização recusada (status ${r.status}): ${r.body?.message ?? ''}`), principal);
    }
    if (ctx.temBanco) {
      const col = await colChamados();
      const statusDoDoc = (d: any) => {
        const registros: any[] = d?.registro ?? [];
        return registros.length ? String(registros[registros.length - 1].status ?? '') : '';
      };
      const doc = await buscarComRetry(
        () => col.findOne({ chamadoProtocolo: principal.protocolo }),
        (d) => statusDoDoc(d) === 'resolvido',
      );
      const statusAtual = statusDoDoc(doc);
      if (statusAtual !== 'resolvido') {
        return comTicket(falha(`A API aceitou, mas o ticket ficou com status "${statusAtual}" em vez de "resolvido".`), principal);
      }
    }
    return comTicket(ok(`Ticket ${principal.protocolo} finalizado e registrado como resolvido em ${r.ms} ms.`), principal);
  });

  // F04 — rotina de fechamento automático
  await coletor.checar('F04', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir a rotina de fechamento.');
    const col = await colChamados();
    const docs = await col
      .find({ ...filtroStatusAtual('resolvido'), updatedAt: { $lt: new Date(Date.now() - TRES_DIAS) } })
      .project({ chamadoProtocolo: 1, updatedAt: 1 })
      .toArray();
    const atrasados = docs.length;
    // Muitos tickets com o MESMO horário de atualização (ou bem próximo) não é fila parada
    // orgânica — é sinal de uma escrita em lote (migração/importação/dado de teste). Nesse caso
    // vira Atenção, não Crítico: pode ser falta de contexto nosso, não motivo pra acionar ninguém
    // como urgente (confirmado em 19/10: os 159 "atrasados" daquele dia eram tudo dado incluído
    // de uma vez, não backlog real).
    const lote = pareceOperacaoEmLote(docs.map((d: any) => new Date(d.updatedAt)));
    coletor.metrica({
      nome: 'Resolvidos há mais de 3 dias sem fechar',
      valor: atrasados,
      situacao: lote ? (atrasados > 0 ? 'Atenção' : 'Normal') : atrasados > 20 ? 'Alerta' : atrasados > 0 ? 'Atenção' : 'Normal',
    });
    if (atrasados === 0) return ok('Nenhum ticket resolvido parado — a rotina de fechamento está rodando.');
    if (lote) {
      return parcial(
        `${atrasados} ticket(s) resolvido(s) há mais de 3 dias sem fechar — mas o horário de atualização ` +
          'deles está concentrado num intervalo muito curto, o que sugere uma carga em lote (importação/teste), ' +
          'não necessariamente a rotina de fechamento parada. Vale confirmar antes de tratar como crítico.',
      );
    }
    if (atrasados <= 20) {
      return parcial(`${atrasados} ticket(s) resolvido(s) há mais de 3 dias ainda sem fechamento automático.`);
    }
    return falha(
      `${atrasados} tickets resolvidos há mais de 3 dias sem fechar. A rotina de fechamento automático ` +
        '(que roda de hora em hora) parece parada.',
    );
  });

  // F05 — rotina de resolução de pendentes
  await coletor.checar('F05', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir a rotina de pendentes.');
    const col = await colChamados();
    const docs = await col
      .find({ ...filtroStatusAtualEm(['pendente', 'em-espera']), updatedAt: { $lt: new Date(Date.now() - TRES_DIAS) } })
      .project({ chamadoProtocolo: 1, updatedAt: 1 })
      .toArray();
    const atrasados = docs.length;
    const lote = pareceOperacaoEmLote(docs.map((d: any) => new Date(d.updatedAt)));
    coletor.metrica({
      nome: 'Pendentes há mais de 3 dias sem resolver',
      valor: atrasados,
      situacao: lote ? (atrasados > 0 ? 'Atenção' : 'Normal') : atrasados > 20 ? 'Alerta' : atrasados > 0 ? 'Atenção' : 'Normal',
    });
    if (atrasados === 0) return ok('Nenhum pendente antigo acumulado — a rotina está rodando.');
    if (lote) {
      return parcial(
        `${atrasados} ticket(s) pendente(s) há mais de 3 dias — mas o horário de atualização deles está ` +
          'concentrado num intervalo muito curto, o que sugere uma carga em lote (importação/teste), não ' +
          'necessariamente a rotina parada. Vale confirmar antes de tratar como crítico.',
      );
    }
    if (atrasados <= 20) return parcial(`${atrasados} ticket(s) pendente(s) há mais de 3 dias.`);
    return falha(`${atrasados} tickets pendentes há mais de 3 dias. A rotina de resolução automática parece parada.`);
  });
}

export { QUATRO_DIAS };
