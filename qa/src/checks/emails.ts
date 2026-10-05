/**
 * checks/emails v1.0.0 — envios de e-mail e auditoria da lista segura
 */
import { cfg, ehEmailSeguro } from '../config';
import type { Contexto } from '../contexto';
import {
  colChamados, colClientes, colConteudos, colDisparos, filtroExcluirEspeciais, filtroQa, buscarComRetry,
} from '../db';
import { ok, falha, parcial, bloqueado, comTicket } from '../resultado';

const VINTE_QUATRO_H = 24 * 60 * 60 * 1000;
const TEMPLATE_CSAT = 'Encerramento mais satisfação';
const TEMPLATE_REPESCAGEM = 'Repescagem da satisfação';

async function templateAtivo(nome: string) {
  const col = await colConteudos();
  return col.findOne({ nome });
}

/** E-mails cadastrados para um CPF (é daí que o CRM tira o destinatário). */
async function emailsDoCpf(cpf: string): Promise<string[]> {
  const col = await colClientes();
  const doc = await col.findOne({ 'clienteDados.clienteCpf': cpf });
  const dados = (doc?.clienteDados ?? []).find((d: any) => d?.clienteCpf === cpf);
  const lista: string[] = dados?.clienteEmail?.lista ?? [];
  const resposta: string = dados?.clienteEmail?.resposta ?? '';
  return [...new Set([...lista, resposta].filter(Boolean))];
}

export async function checarEmails(ctx: Contexto): Promise<void> {
  const { coletor } = ctx;
  const principal = ctx.criados[0];

  // E01 — envios nas últimas 24h
  await coletor.checar('E01', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para contar os envios.');
    const desde = new Date(Date.now() - VINTE_QUATRO_H);

    // Duas fontes distintas, porque só os e-mails por gatilho passam pelo log de
    // disparos: emailTrigger.service é o único que escreve em email_disparos_log.
    // Resposta de agente e CSAT não aparecem lá — ficam na marca do registro do
    // ticket. Contar só o log daria alarme errado ("transporte quebrado") num dia
    // em que apenas os gatilhos estivessem inativos.
    const porGatilho = await (await colDisparos()).countDocuments({ sentAt: { $gte: desde } });
    const respostasAgente = await (await colChamados()).countDocuments({
      registro: { $elemMatch: { data: { $gte: desde }, 'metadados.emailOutboundMessageId': { $exists: true } } },
    });

    coletor.metrica({
      nome: 'E-mails automáticos por gatilho (24h)',
      valor: porGatilho,
      situacao: porGatilho === 0 ? 'Atenção' : 'Normal',
    });
    coletor.metrica({
      nome: 'Tickets com resposta enviada ao cliente (24h)',
      valor: respostasAgente,
      situacao: respostasAgente === 0 ? 'Atenção' : 'Normal',
    });

    if (porGatilho === 0 && respostasAgente === 0) {
      return falha(
        'Nenhum e-mail saiu nas últimas 24h — nem automático por gatilho, nem resposta de agente. ' +
          'Isso aponta para o transporte de e-mail, não para configuração de modelo (ver caso S03).',
      );
    }
    if (porGatilho === 0) {
      return parcial(
        `Nenhum e-mail automático por gatilho nas últimas 24h, mas ${respostasAgente} ticket(s) com ` +
          'resposta enviada. O transporte funciona; o problema está na configuração dos modelos ' +
          '(ver casos E02, E03 e E06).',
      );
    }
    if (respostasAgente === 0) {
      return parcial(
        `${porGatilho} e-mail(s) automático(s) por gatilho, mas nenhum ticket com resposta de agente ` +
          'enviada nas últimas 24h. Pode ser dia de baixo movimento ou falha no envio do Compose (ver R02).',
      );
    }
    return ok(
      `${porGatilho} e-mail(s) por gatilho e ${respostasAgente} ticket(s) com resposta enviada nas últimas 24h.`,
    );
  });

  // E02 — modelo do CSAT
  await coletor.checar('E02', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir os modelos de e-mail.');
    const doc = await templateAtivo(TEMPLATE_CSAT);
    if (!doc) {
      return falha(
        `O modelo "${TEMPLATE_CSAT}" não existe. Sem ele, NENHUMA pesquisa de satisfação é enviada.`,
      );
    }
    if (doc.ativo !== true) {
      return falha(`O modelo "${TEMPLATE_CSAT}" está inativo. Nenhuma pesquisa de satisfação é enviada.`);
    }
    const criterios = doc.gatilho?.criterios ?? [];
    if (!criterios.length) return parcial(`Modelo ativo, mas sem gatilho configurado — o envio pode não acontecer.`);
    return ok(`Modelo "${TEMPLATE_CSAT}" ativo, com ${criterios.length} critério(s) de gatilho.`);
  });

  // E03 — modelo da repescagem
  await coletor.checar('E03', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir os modelos de e-mail.');
    const doc = await templateAtivo(TEMPLATE_REPESCAGEM);
    if (!doc) return parcial(`O modelo "${TEMPLATE_REPESCAGEM}" não existe — a repescagem do CSAT não acontece.`);
    if (doc.ativo !== true) return parcial(`O modelo "${TEMPLATE_REPESCAGEM}" está inativo.`);
    return ok(`Modelo "${TEMPLATE_REPESCAGEM}" ativo.`);
  });

  // E04 — e-mail do ticket de teste
  await coletor.checar('E04', async () => {
    if (!principal) return bloqueado('Nenhum ticket de teste disponível.');
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir o histórico do ticket.');
    const col = await colChamados();
    // Os dois caminhos de envio ao cliente gravam marcas diferentes:
    // e-mail automático por gatilho → emailPadraoId/emailPadraoNome;
    // resposta do agente → emailOutboundMessageId (persistOutboundEmailMeta).
    // `emailMessageId` NÃO entra aqui: é campo de e-mail recebido.
    const enviadosDoDoc = (d: any): any[] =>
      (d?.registro ?? []).filter(
        (r: any) => r?.metadados?.emailPadraoId || r?.metadados?.emailPadraoNome || r?.metadados?.emailOutboundMessageId,
      );
    // Mais tolerante que as outras checagens (5 tentativas, 600ms) — o disparo do
    // e-mail é assíncrono no backend, não confirmado antes da resposta da API.
    const doc = await buscarComRetry(
      () => col.findOne({ chamadoProtocolo: principal.protocolo }),
      (d) => enviadosDoDoc(d).length > 0,
      5,
      600,
    );
    const enviados = enviadosDoDoc(doc);
    const emails = await emailsDoCpf(cfg.cpfQa);
    const forasDaLista = emails.filter((e) => !ehEmailSeguro(e));
    if (forasDaLista.length) {
      return comTicket(
        falha(`PARE: o cadastro do CPF de teste tem e-mail fora da lista segura (${forasDaLista.join(', ')}).`),
        principal,
      );
    }
    if (!enviados.length) {
      return comTicket(
        parcial(
          'O ticket de teste não registrou nenhum e-mail enviado. Pode ser modelo de gatilho inativo ' +
            'ou transporte de e-mail indisponível (ver casos S03 e E02).',
        ),
        principal,
      );
    }
    const nomes = [...new Set(enviados.map((r) => r?.metadados?.emailPadraoNome).filter(Boolean))];
    return comTicket(
      ok(
        `${enviados.length} envio(s) registrado(s) no ticket de teste para ${emails.join(', ')}` +
          (nomes.length ? ` — modelo(s): ${nomes.join(', ')}.` : '.'),
      ),
      principal,
    );
  });

  // E05 — auditoria da lista segura
  await coletor.checar('E05', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para auditar os tickets de QA.');
    const col = await colChamados();
    const tickets = await col.find(filtroQa()).project({ chamadoProtocolo: 1, cliente: 1 }).limit(500).toArray();
    const cpfs = [...new Set(tickets.map((t: any) => t?.cliente?.[0]?.clienteCpf).filter(Boolean))];
    const problemas: string[] = [];
    for (const cpf of cpfs) {
      const emails = await emailsDoCpf(String(cpf));
      const foras = emails.filter((e) => !ehEmailSeguro(e));
      if (foras.length) problemas.push(`CPF ${cpf}: ${foras.join(', ')}`);
    }
    coletor.metrica({ nome: 'Tickets de QA no banco', valor: tickets.length, situacao: 'Normal' });
    if (problemas.length) {
      return falha(
        `Encontrado endereço fora da lista segura em ticket de QA — ${problemas.join(' | ')}. ` +
          'Corrija antes da próxima rodada.',
      );
    }
    return ok(
      `${tickets.length} ticket(s) de QA auditado(s): todos apontam apenas para e-mails autorizados ` +
        `(${cfg.emailsSeguros.join(', ')}).`,
    );
  });

  // E06 — modelos com gatilho ativo
  await coletor.checar('E06', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir os modelos de e-mail.');
    const col = await colConteudos();
    const ativos = await col.countDocuments({ ativo: true, 'gatilho.criterios.0': { $exists: true } });
    const total = await col.countDocuments({});
    coletor.metrica({
      nome: 'Modelos de e-mail ativos com gatilho',
      valor: ativos,
      situacao: ativos === 0 ? 'Alerta' : 'Normal',
      observacao: `${total} modelo(s) cadastrado(s) no total`,
    });
    if (ativos === 0) {
      return falha('Nenhum modelo de e-mail ativo com gatilho. Nenhum e-mail automático será disparado.');
    }
    return ok(`${ativos} modelo(s) de e-mail ativo(s) com gatilho, de ${total} cadastrado(s).`);
  });

  // Mantém em sincronia com EMAIL_SLA_LIMIT_HOURS em
  // backend/src/services/emailOutbound.constants.ts — se um status novo ganhar prazo lá (ou
  // um existente mudar de valor) e esta lista não acompanhar, o E09 passa a reportar "sem prazo
  // configurado" por engano para um gatilho que na verdade já funciona.
  const SLA_LIMITE_HORAS: Record<string, number> = {
    'em-aberto': 4,
    'em-andamento': 8,
    pendente: 24,
  };

  // E09 — cobertura de canal e cumprimento de prazo dos encerramentos automáticos por
  // status/SLA (gatilho_interno fica de fora: é o CSAT, já coberto por E02/E03/C07). Avalia
  // cada modelo ativo separadamente para apontar exatamente qual deles tem problema: "canal não
  // coberto" (nunca avalia), "prazo não cumprido" (avaliou e não saiu) ou "sem prazo configurado"
  // (SLA preso a um status sem limite definido no backend — nunca dispara, não importa o tempo).
  await coletor.checar('E09', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para conferir os modelos de encerramento.');
    const colC = await colConteudos();
    const templates = await colC.find({ ativo: true }).toArray();

    type Alvo = { tpl: any; statusCrit: any; canalCrit: any; slaCrit: any };
    const alvos: Alvo[] = [];
    for (const tpl of templates) {
      const criterios = tpl?.gatilho?.criterios ?? [];
      if (criterios.some((c: any) => c.tipo === 'gatilho_interno')) continue;
      const statusCrit = criterios.find((c: any) => c.tipo === 'status');
      if (!statusCrit?.valores?.length) continue;
      const slaCrit = criterios.find((c: any) => c.tipo === 'sla');
      const statusHasDelay = statusCrit.prazoTipo === 'horas' && Number(statusCrit.prazoHoras) > 0;
      const statusImediato = statusCrit.prazoTipo === 'imediato';
      if (!slaCrit && !statusHasDelay && !statusImediato) continue;
      alvos.push({ tpl, statusCrit, canalCrit: criterios.find((c: any) => c.tipo === 'canal'), slaCrit });
    }

    if (!alvos.length) {
      return ok('Nenhum modelo ativo de encerramento por status/SLA (fora o CSAT) para conferir nesta rodada.');
    }

    const colCh = await colChamados();
    const colD = await colDisparos();
    const JANELA_DIAS = 7;
    const corteInferior = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000);

    const problemas: string[] = [];

    for (const { tpl, statusCrit, canalCrit, slaCrit } of alvos) {
      const statusAlvo: string[] = statusCrit.valores;
      const canaisTemplate: string[] | null = canalCrit?.valores?.length ? canalCrit.valores : null;

      // sla "metade" é transitório (só vale numa janela estreita) — difícil de auditar depois
      // do fato sem falso alarme, então fica de fora de propósito; "estourado"/"personalizado"
      // só crescem com o tempo, por isso dá pra conferir com folga.
      let semPrazoDefinido = false;
      let prazoLabel = '';
      let folgaHoras = 2;
      if (slaCrit) {
        const valoresSla: string[] = slaCrit.valores ?? [];
        if (valoresSla.includes('personalizado')) {
          const limite = Number(slaCrit.horasPersonalizadas) || 0;
          if (limite <= 0) continue;
          folgaHoras = limite * 2 + 48;
          prazoLabel = `${limite}h personalizadas`;
        } else if (valoresSla.includes('estourado')) {
          const limite = SLA_LIMITE_HORAS[statusAlvo[0]];
          if (!limite) {
            problemas.push(
              `"${tpl.nome}": gatilho de SLA preso ao status "${statusAlvo[0]}", mas esse status não ` +
                'tem prazo configurado no sistema (só em-aberto/em-andamento têm) — nunca dispara.',
            );
            continue;
          }
          folgaHoras = limite * 2 + 48;
          prazoLabel = 'SLA estourado';
        } else {
          continue; // só "metade" configurado
        }
      } else if (statusCrit.prazoTipo === 'horas') {
        folgaHoras = (Number(statusCrit.prazoHoras) || 0) + 24;
        prazoLabel = `${statusCrit.prazoHoras}h úteis`;
      } else {
        prazoLabel = 'imediato';
      }

      const corteSuperior = new Date(Date.now() - folgaHoras * 60 * 60 * 1000);

      // SLA é avaliado com o ticket ainda no status (condição que persiste), não um evento
      // passado — por isso filtra pelo status atual, igual o backend faz (currentStatus).
      // Exclui especiais (Procon/Consumidor.Gov/Reclame Aqui/Bacen) igual o backend faz antes
      // de avaliar qualquer gatilho (ver isEspeciaisChamado) — inclui o histórico de Reclame
      // Aqui importado do CRM antigo, que nunca passa por esse fluxo de e-mail.
      const candidatos = await colCh
        .find({
          $expr: { $in: [{ $arrayElemAt: ['$registro.status', -1] }, statusAlvo] },
          updatedAt: { $gte: corteInferior, $lte: corteSuperior },
          $and: [{ $nor: [filtroQa()] }, filtroExcluirEspeciais()],
        })
        .project({ chamadoProtocolo: 1, tabulacao: 1, registro: 1 })
        .limit(500)
        .toArray();

      if (!candidatos.length) continue; // sem volume nesta janela pra avaliar o modelo

      const elegiveis: Array<{ _id: any; chamadoProtocolo: string; eventKey: string }> = [];
      const canaisNaoCobertos = new Map<string, number>();

      for (const doc of candidatos) {
        const tabs = doc.tabulacao ?? [];
        const canal = String(tabs[tabs.length - 1]?.canal ?? '').trim();
        if (canaisTemplate && !canaisTemplate.includes(canal)) {
          const chave = canal || '(vazio)';
          canaisNaoCobertos.set(chave, (canaisNaoCobertos.get(chave) ?? 0) + 1);
          continue;
        }
        // eventKey por ticket (não pelo template) — correto mesmo quando o gatilho lista mais
        // de um status, já que cada ticket só está, de fato, num deles agora.
        const statusDoTicket = String(
          doc.registro?.[doc.registro.length - 1]?.status ?? '',
        ).trim();
        const eventKey = slaCrit
          ? (slaCrit.valores.includes('personalizado') ? 'sla:personalizado' : 'sla:estourado')
          : statusCrit.prazoTipo === 'horas'
            ? `status:${statusDoTicket}:prazo`
            : `status:${statusDoTicket}`;
        elegiveis.push({ _id: doc._id, chamadoProtocolo: doc.chamadoProtocolo, eventKey });
      }

      if (canaisNaoCobertos.size) {
        const detalhe = [...canaisNaoCobertos.entries()].map(([c, n]) => `"${c}" (${n})`).join(', ');
        problemas.push(
          `"${tpl.nome}": gatilho não cobre o canal ${detalhe} — esses tickets nunca são avaliados.`,
        );
      }

      if (!elegiveis.length) continue;

      const ids = elegiveis.map((d) => d._id);
      const enviados = await colD
        .find({ chamadoId: { $in: ids }, conteudoId: tpl._id })
        .project({ chamadoId: 1, eventKey: 1 })
        .toArray();
      const enviadosSet = new Set(enviados.map((e: any) => `${e.chamadoId}|${e.eventKey}`));
      const faltando = elegiveis.filter((d) => !enviadosSet.has(`${d._id}|${d.eventKey}`));

      if (faltando.length) {
        problemas.push(
          `"${tpl.nome}": prazo (${prazoLabel}) não cumprido em ${faltando.length}/${elegiveis.length} ` +
            `ticket(s) elegível(eis) nos últimos ${JANELA_DIAS} dias — ex.: protocolo ${faltando[0]?.chamadoProtocolo}.`,
        );
      }
    }

    coletor.metrica({
      nome: 'Modelos de encerramento com problema de canal/prazo',
      valor: problemas.length,
      situacao: problemas.length ? 'Alerta' : 'Normal',
    });

    if (!problemas.length) {
      return ok(`${alvos.length} modelo(s) de encerramento por status/SLA conferido(s) — canal e prazo cumpridos.`);
    }
    return falha(problemas.join(' | '));
  });
}
