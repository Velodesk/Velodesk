/**
 * checks/saude v1.0.0 — o sistema está no ar e conectado?
 */
import { cfg } from '../config';
import type { Contexto } from '../contexto';
import { ok, falha, parcial, bloqueado } from '../resultado';

export async function checarSaude(ctx: Contexto): Promise<void> {
  const { api, coletor } = ctx;

  await coletor.checar('S01', async () => {
    const r = await api.health();
    if (r.status !== 200) return falha(`A API não respondeu como esperado (status ${r.status || 'sem resposta'}).`);
    const status = String(r.body?.status ?? '');
    if (status === 'ok') return ok(`API no ar, respondeu em ${r.ms} ms.`);
    return parcial(`API respondeu em ${r.ms} ms, mas o próprio sistema se declara "${status}" (degradado).`);
  });

  await coletor.checar('S02', async () => {
    const r = await api.health();
    if (r.status !== 200) return bloqueado('Não foi possível consultar a saúde da API.');
    const bancos: Array<[string, unknown]> = [
      ['Chamados', r.body?.mongo],
      ['Cadastros de clientes', r.body?.cadastrosConnected],
      ['Configurações do Desk', r.body?.deskConfigConnected],
      ['Preferências do Desk', r.body?.deskPreferencesConnected],
      ['Cadastro de colaboradores', r.body?.funcionariosConnected],
    ];
    const desconectados = bancos.filter(([, v]) => v !== true).map(([n]) => n);
    if (!desconectados.length) return ok('Todos os bancos de dados estão conectados.');
    return falha(`Banco(s) desconectado(s): ${desconectados.join(', ')}. Isso derruba funções do CRM.`);
  });

  await coletor.checar('S03', async () => {
    const r = await api.healthEmail();
    if (r.status !== 200) return bloqueado(`Sonda de e-mail não respondeu (status ${r.status || 'sem resposta'}).`);
    if (r.body?.emailTransportReady === true) return ok('Transporte de e-mail configurado e pronto para enviar.');
    return falha(
      'O ambiente NÃO tem transporte de e-mail pronto. Nenhum e-mail sai daqui — ' +
        'inclusive os de CSAT, que nem gravam registro no ticket quando o envio falha.',
    );
  });

  await coletor.checar('S04', async () => {
    const r = await api.healthInboundTickets();
    if (r.status !== 200) return bloqueado(`Sonda de entrada de tickets não respondeu (status ${r.status}).`);
    if (r.body?.enabled === true) return ok('Canal de entrada de tickets ativo.');
    return falha('Canal de entrada de tickets desligado — app, telefone e IA não conseguem abrir ticket.');
  });

  await coletor.checar('S05', async () => {
    if (!cfg.login.email || !cfg.login.password) {
      return bloqueado('Sem usuário de QA configurado (QA_LOGIN_EMAIL / QA_LOGIN_PASSWORD).');
    }
    const r = await api.login(cfg.login.email, cfg.login.password);
    if (r.status === 200 && r.body?.token) {
      ctx.nomeAtendente = String(r.body?.user?.name || r.body?.colaborador?.colaboradorNome || cfg.responsavel);
      ctx.sessao = { token: String(r.body.token), user: r.body.user, colaborador: r.body.colaborador ?? null };
      const acessoDesk = r.body?.colaborador?.acessos?.Desk ?? r.body?.colaborador?.acessos?.desk;
      if (acessoDesk !== true) {
        return parcial(`Login funcionou, mas o colaborador não tem acesso ao Desk marcado no cadastro.`);
      }
      return ok(`Login do atendente "${ctx.nomeAtendente}" funcionou em ${r.ms} ms.`);
    }
    const msg = r.body?.message ?? `status ${r.status}`;
    return falha(`Login recusado: ${msg}. Sem login, nenhuma tela do CRM abre.`);
  });

  await coletor.checar('S06', async () => {
    if (!api.temToken) return bloqueado('Sem sessão — o login falhou nesta rodada.');
    const r = await api.stats();
    if (r.status !== 200) return falha(`Contadores não responderam (status ${r.status}).`);
    const { total, resolved, pending, boxes, agents } = r.body ?? {};
    if ([total, resolved, pending, boxes, agents].some((v) => typeof v !== 'number')) {
      return falha(`Resposta dos contadores fora do formato esperado: ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    coletor.metrica({ nome: 'Tickets no total', valor: total, situacao: 'Normal' });
    coletor.metrica({ nome: 'Tickets resolvidos (acumulado)', valor: resolved, situacao: 'Normal' });
    coletor.metrica({ nome: 'Tickets em aberto agora', valor: pending, situacao: 'Normal' });
    coletor.metrica({ nome: 'Atendentes cadastrados', valor: agents, situacao: 'Normal' });
    return ok(`Contadores respondendo: ${total} tickets no total, ${pending} em aberto, ${agents} atendentes.`);
  });
}
