/**
 * checks/tickets v1.0.0 — tickets novos, mensagens e tabulação
 *
 * Todo ticket criado aqui:
 *  - usa o CPF fictício de QA (QA_CLIENT_CPF)
 *  - usa um e-mail da lista segura (QA_EMAIL_ALLOWLIST)
 *  - nasce marcado com a origem de QA, para poder ser auditado e limpo depois
 */
import { cfg, exigirEmailSeguro } from '../config';
import type { Contexto, Tabulacao } from '../contexto';
import { MARCA_QA, colChamados, colContadores, filtroQa } from '../db';
import { ok, falha, parcial, bloqueado, comTicket } from '../resultado';

const PREFIXO = 'qa-velodesk';

function payloadTicket(ctx: Contexto, sufixo: string) {
  const email = exigirEmailSeguro(ctx.emailTeste, 'criação de ticket de QA');
  const externalId = `${PREFIXO}-${ctx.runId}-${sufixo}`;
  return {
    externalId,
    title: `Monitoramento automático de QA — ${ctx.runId}`,
    text:
      'Ticket gerado pelo agente de QA do Velodesk para verificar diariamente as ' +
      'funções do CRM. Pode ser encerrado sem tratamento.',
    clientName: 'Cliente de Teste QA',
    clientCPF: cfg.cpfQa,
    clientEmail: email,
    priority: 'baixa',
    metadata: { origemQa: MARCA_QA, runId: ctx.runId, criadoEm: new Date().toISOString() },
  };
}

/** Descobre uma tabulação válida na árvore de motivos ativa. */
export async function descobrirTabulacao(ctx: Contexto): Promise<Tabulacao | null> {
  const r = await ctx.api.get('/api/tabulation');
  if (r.status !== 200 || !r.body?.produtos) return null;
  const produtos: any[] = Array.isArray(r.body.produtos) ? r.body.produtos : [];
  const tipos: string[] = r.body?.opcoes?.tipoChamado ?? r.body?.opcoes?.tipo ?? [];
  const tipo =
    (Array.isArray(tipos) ? tipos.map((t: any) => (typeof t === 'string' ? t : t?.valor ?? t?.nome)) : [])
      .filter(Boolean)[0] ?? 'Dúvida';

  for (const p of produtos) {
    if (p?.ativo === false) continue;
    const motivos: any[] = (p?.motivos ?? []).filter((m: any) => m?.ativo !== false);
    for (const m of motivos) {
      const detalhes: any[] = (m?.detalhes ?? []).filter((d: any) => d?.ativo !== false);
      return {
        produto: String(p.produto),
        tipoChamado: String(tipo),
        motivo: String(m.motivo),
        detalhe: detalhes.length ? String(detalhes[0].detalhe) : '',
        canal: 'App',
        responsavel: ctx.nomeAtendente || cfg.responsavel,
      };
    }
  }
  return null;
}

export async function checarTicketsNovos(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;

  // T01 — criar ticket
  let primeiro: { id: string; protocolo: string; externalId: string } | null = null;
  await coletor.checar('T01', async () => {
    if (!ctx.podeEscrever) return bloqueado('Rodada em modo somente leitura — nenhum ticket foi criado.');
    const payload = payloadTicket(ctx, 'a');
    const r = await api.criarTicketEntrada(payload);
    if (r.status !== 201) {
      return falha(
        `Criação de ticket recusada (status ${r.status}): ${r.body?.message ?? JSON.stringify(r.body).slice(0, 200)}`,
      );
    }
    const protocolo = String(r.body?.chamadoProtocolo ?? '');
    const ticketId = String(r.body?.ticketId ?? '');
    if (!/^\d{10}$/.test(protocolo)) {
      return comTicket(
        parcial(`Ticket criado, mas o protocolo "${protocolo}" não tem o formato de 10 dígitos esperado.`),
        { id: ticketId, protocolo },
      );
    }
    primeiro = { id: ticketId, protocolo, externalId: payload.externalId };
    ctx.criados.push(primeiro);
    return comTicket(ok(`Ticket criado em ${r.ms} ms — protocolo ${protocolo}, canal ${r.body?.canal ?? '-'}.`), primeiro);
  });

  // T02 — buscar por protocolo
  await coletor.checar('T02', async () => {
    if (!primeiro) return bloqueado('Nenhum ticket de teste foi criado nesta rodada.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente para consultar o ticket.');
    const r = await api.ticketPorProtocolo(primeiro.protocolo);
    if (r.status !== 200) return comTicket(falha(`Ticket ${primeiro.protocolo} não foi encontrado pela busca (status ${r.status}).`), primeiro);
    const status = String(r.body?.status ?? r.body?.statusId ?? '');
    if (status && !['novo', 'novos'].includes(status.toLowerCase())) {
      return comTicket(parcial(`Ticket encontrado, mas já está em "${status}" em vez de "novo".`), primeiro);
    }
    return comTicket(ok(`Ticket ${primeiro.protocolo} encontrado pela busca por protocolo, com status "novo".`), primeiro);
  });

  // T03 — idempotência
  await coletor.checar('T03', async () => {
    if (!primeiro) return bloqueado('Nenhum ticket de teste foi criado nesta rodada.');
    const r = await api.criarTicketEntrada(payloadTicket(ctx, 'a'));
    if (r.status === 200 && r.body?.action === 'duplicate') {
      const mesmo = String(r.body?.chamadoProtocolo ?? '') === primeiro.protocolo;
      return comTicket(
        mesmo
          ? ok('Reenvio do mesmo pedido não criou ticket duplicado (devolveu o protocolo original).')
          : parcial('Reenvio foi tratado como duplicado, mas devolveu protocolo diferente do original.'),
        primeiro,
      );
    }
    if (r.status === 201) {
      const dup = String(r.body?.chamadoProtocolo ?? '');
      const dupTicket = { id: String(r.body?.ticketId ?? ''), protocolo: dup, externalId: primeiro.externalId };
      if (dup) ctx.criados.push(dupTicket);
      return comTicket(
        falha(`Reenvio criou um SEGUNDO ticket (protocolo ${dup}). A proteção contra duplicidade falhou.`),
        { ...primeiro, papel: 'original' },
        { ...dupTicket, papel: 'duplicado indevido' },
      );
    }
    return comTicket(falha(`Reenvio respondeu de forma inesperada (status ${r.status}): ${r.body?.message ?? ''}`), primeiro);
  });

  // T04 — fila
  await coletor.checar('T04', async () => {
    if (!api.temToken) return bloqueado('Sem sessão de atendente para consultar as filas.');
    const r = await api.queueCounts();
    if (r.status !== 200) return falha(`Contadores das filas não responderam (status ${r.status}).`);
    const texto = JSON.stringify(r.body ?? {});
    const novos = Number(r.body?.novos ?? r.body?.counts?.novos ?? NaN);
    if (Number.isFinite(novos)) {
      coletor.metrica({ nome: 'Tickets na fila "Novos"', valor: novos, situacao: novos === 0 ? 'Atenção' : 'Normal' });
      return novos > 0
        ? ok(`Fila de novos com ${novos} ticket(s).`)
        : parcial('Fila de novos está zerada — verifique se a entrada de tickets está chegando.');
    }
    return parcial(`Contadores responderam, mas em formato não reconhecido: ${texto.slice(0, 180)}`);
  });

  // T05 — contador de protocolo
  await coletor.checar('T05', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir o contador de protocolo.');
    const col = await colContadores();
    const doc = await col.findOne({ _id: 'chamadoProtocolo' as any });
    if (!doc) return falha('Contador de protocolo do dia não existe. Novos tickets podem ficar sem número.');
    coletor.metrica({ nome: 'Protocolos emitidos hoje', valor: Number(doc.value ?? 0), situacao: 'Normal' });
    return ok(`Contador do dia ${doc.day ?? '-'} está em ${doc.value ?? '-'}.`);
  });

  // T06 — volume de entrada
  await coletor.checar('T06', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para contar os tickets do período.');
    const col = await colChamados();
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const criados24h = await col.countDocuments({ createdAt: { $gte: desde } });
    const media7d = (await col.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 864e5) } })) / 7;
    coletor.metrica({
      nome: 'Tickets criados nas últimas 24h',
      valor: criados24h,
      situacao: criados24h === 0 ? 'Alerta' : 'Normal',
      observacao: `Média diária dos últimos 7 dias: ${media7d.toFixed(0)}`,
    });
    if (criados24h === 0) return falha('Nenhum ticket criado nas últimas 24h. Suspeita de entrada travada.');
    if (media7d > 0 && criados24h < media7d * 0.3) {
      return parcial(
        `Entrada bem abaixo do normal: ${criados24h} nas últimas 24h contra média de ${media7d.toFixed(0)}/dia.`,
      );
    }
    return ok(`${criados24h} ticket(s) criado(s) nas últimas 24h (média de ${media7d.toFixed(0)}/dia).`);
  });
}

/**
 * Cria os dois tickets auxiliares usados pelas travas de finalização e pela
 * mescla. Não é um caso do catálogo — é preparação da rodada.
 */
export async function prepararTicketsAuxiliares(ctx: Contexto): Promise<void> {
  if (!ctx.podeEscrever) return;
  for (const sufixo of ['b', 'c']) {
    const r = await ctx.api.criarTicketEntrada(payloadTicket(ctx, sufixo));
    const protocolo = String(r.body?.chamadoProtocolo ?? '');
    if (r.status === 201 && protocolo) {
      ctx.criados.push({ id: String(r.body?.ticketId ?? ''), protocolo, externalId: `${PREFIXO}-${ctx.runId}-${sufixo}` });
    } else {
      console.warn(`[qa] ticket auxiliar "${sufixo}" não foi criado (status ${r.status}).`);
    }
  }
}

export async function checarMensagens(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;
  const ticket = ctx.criados[0];

  // R01 — anotação interna
  await coletor.checar('R01', async () => {
    if (!ticket) return bloqueado('Nenhum ticket de teste disponível.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    const r = await api.mensagem(ticket.id, {
      text: `Anotação interna do agente de QA — rodada ${ctx.runId}.`,
      internal: true,
      author: ctx.nomeAtendente || cfg.responsavel,
    });
    if (r.status !== 200 && r.status !== 201) {
      return comTicket(falha(`Anotação interna recusada (status ${r.status}): ${r.body?.message ?? ''}`), ticket);
    }
    if (ctx.temBanco) {
      const col = await colChamados();
      const doc = await col.findOne({ chamadoProtocolo: ticket.protocolo });
      const temNota = (doc?.registro ?? []).some((x: any) => String(x?.anotacaoInterna ?? '').includes(ctx.runId));
      if (!temNota) return comTicket(falha('A API aceitou a anotação, mas ela não apareceu no histórico do ticket.'), ticket);
    }
    return comTicket(ok('Anotação interna gravada no histórico do ticket.'), ticket);
  });

  // R02 — resposta pública (falha conhecida)
  await coletor.checar('R02', async () => {
    if (!ticket) return bloqueado('Nenhum ticket de teste disponível.');
    if (!api.temToken) return bloqueado('Sem sessão de atendente.');
    if (!ctx.tabulacao) return bloqueado('Não foi possível montar uma tabulação válida para enviar a resposta.');
    exigirEmailSeguro(ctx.emailTeste, 'resposta pública ao cliente de teste');
    const r = await api.commit(ticket.id, {
      status: 'em-andamento',
      text: `Resposta pública de teste do agente de QA — rodada ${ctx.runId}. Nenhuma ação necessária.`,
      author: ctx.nomeAtendente || cfg.responsavel,
      lateralForm: { ...ctx.tabulacao },
    });
    if (r.status !== 200) {
      return comTicket(falha(`Envio da resposta pública recusado (status ${r.status}): ${r.body?.message ?? ''}`), ticket);
    }
    if (ctx.temBanco) {
      const col = await colChamados();
      const doc = await col.findOne({ chamadoProtocolo: ticket.protocolo });
      const registros: any[] = doc?.registro ?? [];
      const publica = registros.find((x) => String(x?.mensagemPublica ?? '').includes(ctx.runId));
      if (!publica) return comTicket(falha('A resposta foi aceita pela API, mas não ficou gravada na conversa do ticket.'), ticket);
      // A prova de que o e-mail saiu é `emailOutboundMessageId`, gravado por
      // persistOutboundEmailMeta NO REGISTRO DESTA resposta. Duas armadilhas evitadas
      // aqui: `emailMessageId` é campo de e-mail RECEBIDO, e olhar o ticket todo faria
      // a marca do e-mail automático de abertura satisfazer a checagem sem a resposta
      // ter saído — falso verde justamente no caso do bug conhecido do Compose.
      const idEnvio = String(publica?.metadados?.emailOutboundMessageId ?? '').trim();
      if (!idEnvio) {
        return comTicket(
          parcial(
            'Resposta gravada na conversa, mas o registro dela não recebeu o identificador de e-mail ' +
              'enviado (emailOutboundMessageId) — indício de que a mensagem não saiu para o cliente. ' +
              'Confira o transporte de e-mail (caso S03).',
          ),
          ticket,
        );
      }
      return comTicket(ok(`Resposta pública gravada na conversa e e-mail enviado ao cliente (id ${idEnvio}).`), ticket);
    }
    return comTicket(ok('Resposta pública aceita pela API (sem acesso ao banco para confirmar o envio do e-mail).'), ticket);
  });

  // R03 — tabulação (falha conhecida)
  await coletor.checar('R03', async () => {
    if (!ticket) return bloqueado('Nenhum ticket de teste disponível.');
    if (!ctx.tabulacao) {
      return falha('Não foi possível obter uma tabulação válida na árvore de motivos ativa.');
    }
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir a tabulação gravada.');
    const col = await colChamados();
    const doc = await col.findOne({ chamadoProtocolo: ticket.protocolo });
    const tabs: any[] = doc?.tabulacao ?? [];
    const atual = tabs[tabs.length - 1];
    if (!atual) return comTicket(falha('Nenhuma tabulação foi gravada no ticket.'), ticket);
    const faltando = (['produto', 'tipoChamado', 'motivo'] as const).filter((k) => !String(atual[k] ?? '').trim());
    if (faltando.length) return comTicket(falha(`Tabulação incompleta no ticket — sem: ${faltando.join(', ')}.`), ticket);
    return comTicket(ok(`Tabulação gravada: ${atual.produto} / ${atual.tipoChamado} / ${atual.motivo}.`), ticket);
  });

  // R04 — encaminhar para outro grupo
  coletor.naoExecutado(
    'R04',
    'Sem rota de API equivalente para automatizar o encaminhamento; a função também não foi ' +
      'localizada na tela durante os testes manuais de 21/08.',
    'Nao testavel',
  );
}

export { filtroQa };
