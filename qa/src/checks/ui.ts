/**
 * checks/ui v1.0.0 — telas no navegador (Playwright)
 *
 * Sessão é injetada no localStorage a partir do login pela API, para não
 * depender do botão do Google. Só abre ticket criado pelo próprio QA — nunca
 * tira print de ticket de cliente real.
 */
import fs from 'fs';
import path from 'path';
import { cfg } from '../config';
import type { Contexto } from '../contexto';
import { ok, falha, parcial, bloqueado, listarAchados, situacaoPorLatencia } from '../resultado';

const ESPERA = 25_000;

export async function checarTelas(ctx: Contexto): Promise<void> {
  const { coletor } = ctx;

  if (cfg.pularUi) {
    for (const id of ['U01', 'U02', 'U03', 'U04', 'X02']) {
      coletor.naoExecutado(id, 'Camada de navegador desativada nesta rodada (QA_PULAR_UI).');
    }
    return;
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    for (const id of ['U01', 'U02', 'U03', 'U04', 'X02']) {
      coletor.naoExecutado(id, 'Playwright não está instalado nesta máquina.', 'Bloqueado');
    }
    return;
  }

  fs.mkdirSync(ctx.dirPrints, { recursive: true });
  const navegador = await chromium.launch({ args: ['--no-sandbox'] });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const errosConsole: string[] = [];

  contexto.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const texto = msg.text();
    if (/console operacional/.test(texto)) return; // banner esperado do próprio CRM
    errosConsole.push(texto.slice(0, 300));
  });

  const print = async (page: any, nome: string) => {
    const arquivo = path.join(ctx.dirPrints, `${nome}.png`);
    await page.screenshot({ path: arquivo, fullPage: false }).catch(() => undefined);
    return arquivo;
  };

  try {
    // U01 — tela de login
    const pagina = await contexto.newPage();
    await coletor.checar('U01', async () => {
      const resp = await pagina.goto(`${cfg.baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: ESPERA });
      if (!resp || resp.status() >= 400) return falha(`A tela de login não abriu (status ${resp?.status() ?? 'sem resposta'}).`);
      const temEmail = await pagina.locator('input[name="email"]').count();
      const temSenha = await pagina.locator('#desk-login-password').count();
      const arquivo = await print(pagina, 'u01-login');
      if (temEmail && temSenha) return { ...ok('Tela de login abriu com os campos de e-mail e senha.'), print: arquivo };
      const gate = await pagina.locator('.desk-login-card, .desk-login-page').count();
      if (gate) return { ...parcial('Tela de login abriu, mas sem o formulário de e-mail e senha visível.'), print: arquivo };
      return { ...falha('A tela de login abriu sem o cartão de acesso.'), print: arquivo };
    });

    if (!ctx.sessao) {
      for (const id of ['U02', 'U03', 'U04']) {
        coletor.naoExecutado(id, 'Sem sessão de atendente — o login pela API falhou nesta rodada.', 'Bloqueado');
      }
    } else {
      const s = ctx.sessao;
      await contexto.addInitScript(
        ([token, user, colaborador]: [string, string, string]) => {
          try {
            localStorage.setItem('velodesk_token', token);
            localStorage.setItem('velodesk_user', user);
            if (colaborador && colaborador !== 'null') localStorage.setItem('velodesk_colaborador', colaborador);
            localStorage.setItem('velodesk_gate_authorized', '1');
            localStorage.setItem('velodesk_auth_mode', 'cadastro-desk');
          } catch {
            /* ambiente sem localStorage */
          }
        },
        [s.token, JSON.stringify(s.user), JSON.stringify(s.colaborador)] as [string, string, string],
      );

      // U02 — Meu dia (PAUSADO a pedido da Nathalia em 05/10: falso positivo recorrente,
      // não reflete erro real do produto — retomar quando a causa (provável timing/seletor
      // do Playwright, não o cockpit em si) for investigada e corrigida.)
      coletor.naoExecutado(
        'U02',
        'Checagem pausada temporariamente — vinha reportando falha mesmo sem erro real no cockpit.',
        'Nao testavel',
      );

      // U03 — fila
      await coletor.checar('U03', async () => {
        const t0 = Date.now();
        await pagina.goto(`${cfg.baseUrl}/tickets?desk=v2&queue=novos`, {
          waitUntil: 'domcontentloaded',
          timeout: ESPERA,
        });
        const painel = pagina.locator('#crmQueuePanel');
        const apareceu = await painel
          .waitFor({ state: 'visible', timeout: ESPERA })
          .then(() => true)
          .catch(() => false);
        // Tempo real até o painel aparecer (ou até os ESPERA ms de timeout, o que vier
        // primeiro) — vira métrica de latência da tela de fila, além do pass/fail de sempre.
        const duracaoMs = Date.now() - t0;
        coletor.metrica({
          nome: 'Tempo até o painel de filas aparecer (navegador)',
          valor: duracaoMs,
          situacao: situacaoPorLatencia(duracaoMs),
        });
        const arquivo = await print(pagina, 'u03-fila');
        if (!apareceu) return { ...falha(`O painel de filas não abriu em ${duracaoMs} ms.`), print: arquivo };
        const filas = await pagina.locator('#queueStatusList li[data-queue]').count();
        if (filas < 5) {
          return {
            ...parcial(`Painel de filas abriu em ${duracaoMs} ms, mas com ${filas} fila(s) em vez das 5 esperadas.`),
            print: arquivo,
          };
        }
        return { ...ok(`Fila de atendimento abriu em ${duracaoMs} ms com as ${filas} caixas e seus contadores.`), print: arquivo };
      });

      // U04 — ticket aberto (só ticket de QA)
      await coletor.checar('U04', async () => {
        const alvo = ctx.criados[0];
        if (!alvo?.id) {
          return bloqueado(
            'Nenhum ticket de QA disponível. O agente não abre ticket de cliente real para não expor dados no print.',
          );
        }
        await pagina.goto(`${cfg.baseUrl}/tickets?desk=v2&ticket=${alvo.id}&queue=resolvidos`, {
          waitUntil: 'domcontentloaded',
          timeout: ESPERA,
        });
        const abas = pagina.locator('nav.tabs-top');
        const apareceu = await abas
          .waitFor({ state: 'visible', timeout: ESPERA })
          .then(() => true)
          .catch(() => false);
        const arquivo = await print(pagina, 'u04-ticket');
        if (!apareceu) {
          const erro = await pagina.locator('.crm-empty-state[role="alert"]').count();
          return {
            ...falha(
              erro
                ? `O ticket ${alvo.protocolo} não abriu — a tela exibiu o aviso de erro do ticket.`
                : `As abas do ticket ${alvo.protocolo} não apareceram.`,
            ),
            print: arquivo,
          };
        }
        const nomes = await abas.locator('button.tab-btn').allInnerTexts();
        const faltando = ['Conversa', 'Notas', 'Eventos'].filter(
          (n) => !nomes.some((t) => t.trim().toLowerCase().includes(n.toLowerCase())),
        );
        if (faltando.length) {
          return { ...parcial(`Ticket abriu, mas sem a(s) aba(s): ${faltando.join(', ')}.`), print: arquivo };
        }
        return { ...ok(`Ticket ${alvo.protocolo} abriu com as abas ${nomes.join(' / ')}.`), print: arquivo };
      });
    }

    // X02 — erros de console
    await coletor.checar('X02', async () => {
      const falhasApi = errosConsole.filter((t) => /FALHOU|\[VeloDesk\]/.test(t));
      coletor.metrica({
        nome: 'Erros no console do navegador',
        valor: errosConsole.length,
        situacao: errosConsole.length ? 'Atenção' : 'Normal',
      });
      if (!errosConsole.length) return ok('Nenhum erro no console ao abrir cockpit, fila e ticket.');
      if (falhasApi.length) {
        return falha(
          `${falhasApi.length} falha(s) de API registrada(s) no console:\n${listarAchados(falhasApi.slice(0, 3))}`,
        );
      }
      return parcial(
        `${errosConsole.length} erro(s) de console sem relação com API:\n${listarAchados(errosConsole.slice(0, 3))}`,
      );
    });
  } finally {
    await contexto.close().catch(() => undefined);
    await navegador.close().catch(() => undefined);
  }
}
