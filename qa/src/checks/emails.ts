/**
 * checks/emails v1.0.0 — envios de e-mail e auditoria da lista segura
 */
import { cfg, ehEmailSeguro } from '../config';
import type { Contexto } from '../contexto';
import { colChamados, colClientes, colConteudos, colDisparos, filtroQa } from '../db';
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
    const doc = await col.findOne({ chamadoProtocolo: principal.protocolo });
    const registros: any[] = doc?.registro ?? [];
    // Os dois caminhos de envio ao cliente gravam marcas diferentes:
    // e-mail automático por gatilho → emailPadraoId/emailPadraoNome;
    // resposta do agente → emailOutboundMessageId (persistOutboundEmailMeta).
    // `emailMessageId` NÃO entra aqui: é campo de e-mail recebido.
    const enviados = registros.filter(
      (r) => r?.metadados?.emailPadraoId || r?.metadados?.emailPadraoNome || r?.metadados?.emailOutboundMessageId,
    );
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
}
