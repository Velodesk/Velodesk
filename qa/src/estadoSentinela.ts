/**
 * estadoSentinela v1.2.0 — retrato da rodada para o dashboard Sentinela Velodesk
 *
 * O agente roda num Cloud Run Job (disparado pelo Cloud Scheduler) e não tem
 * como escrever direto no banco do dashboard (isso só uma sessão do Claude ou
 * alguém abrindo a página faz). Por isso a rodada grava esse retrato em dois
 * lugares:
 *  - qa/data/*.json local ao runner, só como registro/depuração daquela
 *    execução — não é comitado de volta no repositório.
 *  - qa_sentinela_estado / qa_sentinela_runs (ou qa_sentinela_runs_vigilancia)
 *    no MongoDB (ver gravarEstadoSentinelaMongo abaixo) — é dali que uma
 *    rotina agendada à parte lê e atualiza o Sentinela publicado.
 *
 * Rodada oficial (07h/17h) x rodada de vigilância (a cada 30 min, horário
 * comercial, só um subconjunto leve do catálogo — ver QA_MODO_EXECUCAO em
 * config.ts e `modos` em catalogo.ts):
 *  - As DUAS atualizam o doc único `qa_sentinela_estado` (_id:"atual"), para o
 *    dashboard sempre ter o dado mais recente possível. Mas a vigilância só
 *    toca o subconjunto que ela de fato rodou — os demais casos (só cobertos
 *    pela rodada oficial) são preservados do snapshot anterior em vez de
 *    virarem "não executado" a cada 30 min (ver mesclarCasos abaixo).
 *  - Só a oficial grava em `qa_sentinela_runs` (histórico capado, auditoria
 *    das rodadas 2x/dia). A vigilância grava seu próprio histórico em
 *    `qa_sentinela_runs_vigilancia`, pra não esvaziar o das oficiais rodando
 *    bem mais vezes por dia.
 */
import fs from 'fs';
import path from 'path';
import { cfg, type ModoExecucao } from './config';
import type { Coletor, TicketRef } from './resultado';
import type { Situacao } from './catalogo';
import { colQaSentinelaEstado, colQaSentinelaRuns, colQaSentinelaRunsVigilancia } from './db';

const DIR_DADOS = path.join(__dirname, '..', 'data');
const ARQ_ESTADO = path.join(DIR_DADOS, 'estado-atual.json');
const ARQ_RUNS = path.join(DIR_DADOS, 'runs.json');
const MAX_RUNS_HISTORICO = 14;
/** Cap do histórico de vigilância: a cada 30 min, 07h-19h, seg-sex, dá ~24 rodadas/dia útil —
 * 96 cobre uns 4 dias úteis de retrospecto sem deixar a coleção crescer sem limite. */
const MAX_RUNS_HISTORICO_VIGILANCIA = 96;

export interface ResumoEstado {
  total: number;
  sim: number;
  nao: number;
  parcial: number;
  conhecidas: number;
  bloqueados: number;
  naoTestaveis: number;
  naoTestados: number;
}

interface CasoEstado {
  id: string;
  area: string;
  funcionalidade: string;
  objetivo: string;
  esperado: string;
  situacao: string;
  observacao: string;
  conhecida: string | null;
  tickets: TicketRef[] | null;
}

export interface EstadoAtual {
  ambiente: string;
  runId: string;
  iniciadoEm: string;
  finalizadoEm: string;
  /** 'completo' ou 'somente leitura' — se a rodada podia escrever (ver cfg.somenteLeitura). */
  modo: string;
  /** 'oficial' (07h/17h, catálogo completo) ou 'vigilancia' (a cada 30min, subconjunto leve).
   * Campo novo, distinto de `modo` acima (que fala de escrita, não de frequência/escopo). */
  modoExecucao: ModoExecucao;
  resumo: ResumoEstado;
  casos: CasoEstado[];
}

interface RunHistorico {
  runId: string;
  iniciadoEm: string;
  finalizadoEm: string;
  modoExecucao: ModoExecucao;
  resumo: ResumoEstado;
}

function resumoParaEstado(coletor: Coletor): ResumoEstado {
  const r = coletor.resumo;
  // Nomes diferentes de propósito: coletor.resumo usa vocabulário interno
  // (ok/falhas); o Sentinela usa o vocabulário das situações (sim/nao) —
  // ver RESUMO_TILES no HTML do dashboard.
  return {
    total: r.total,
    sim: r.ok,
    nao: r.falhas,
    parcial: r.parcial,
    conhecidas: r.conhecidas,
    bloqueados: r.bloqueados,
    naoTestaveis: r.naoTestaveis,
    naoTestados: r.naoTestados,
  };
}

export function montarEstadoAtual(params: {
  runId: string;
  inicio: Date;
  fim: Date;
  coletor: Coletor;
  somenteLeitura: boolean;
  modoExecucao: ModoExecucao;
}): EstadoAtual {
  const { runId, inicio, fim, coletor, somenteLeitura, modoExecucao } = params;
  const casos: CasoEstado[] = coletor.resultados
    .slice()
    .sort((a, b) => a.caso.id.localeCompare(b.caso.id))
    .map((r) => ({
      id: r.caso.id,
      area: r.caso.area,
      funcionalidade: r.caso.funcionalidade,
      objetivo: r.caso.objetivo,
      esperado: r.caso.esperado,
      situacao: r.situacao,
      observacao: r.observacao,
      conhecida: r.caso.conhecida ?? null,
      tickets: r.tickets ?? null,
    }));

  return {
    ambiente: cfg.baseUrl,
    runId,
    iniciadoEm: inicio.toISOString(),
    finalizadoEm: fim.toISOString(),
    modo: somenteLeitura ? 'somente leitura' : 'completo',
    modoExecucao,
    resumo: resumoParaEstado(coletor),
    casos,
  };
}

/** Conta por `situacao` a partir de uma lista de casos já gravada — usado para recompor o
 * resumo depois de mesclarCasos() (ver gravarEstadoSentinelaMongo), já que nesse ponto o
 * `coletor.resumo` original só reflete o subconjunto que a rodada de vigilância de fato rodou. */
function resumoDeCasos(casos: CasoEstado[]): ResumoEstado {
  const conta = (s: Situacao) => casos.filter((c) => c.situacao === s).length;
  return {
    total: casos.length,
    sim: conta('Sim'),
    nao: conta('Nao'),
    parcial: conta('Parcial'),
    conhecidas: conta('Falha conhecida'),
    bloqueados: conta('Bloqueado'),
    naoTestaveis: conta('Nao testavel'),
    naoTestados: conta('Nao testado'),
  };
}

/**
 * Em rodada de vigilância, `novo.casos` só tem o subconjunto leve que ela rodou (ver `modos`
 * em catalogo.ts). Em vez de deixar os outros ~40 casos sumirem ou virarem "não executado" no
 * retrato publicado, preserva-os como estavam no snapshot anterior (`anteriores`) — o dashboard
 * sempre mostra o dado mais recente disponível para cada caso, e a rodada oficial seguinte
 * naturalmente os atualiza de novo. Em rodada oficial, `novo.casos` já tem os 49 — o merge não
 * muda nada na prática (não sobra nenhum `anterior` fora de `tocados`).
 */
function mesclarCasos(novo: CasoEstado[], anteriores: CasoEstado[]): CasoEstado[] {
  const tocados = new Set(novo.map((c) => c.id));
  const preservados = anteriores.filter((c) => !tocados.has(c.id));
  return [...novo, ...preservados].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Grava qa/data/estado-atual.json (retrato da rodada mais recente, com os casos
 * de rodadas anteriores mesclados — ver mesclarCasos) e qa/data/runs.json
 * (histórico das últimas rodadas, só o resumo — o suficiente pro gráfico de
 * tendência do dashboard). Cada container do Cloud Run Job é efêmero, então
 * isto só serve de fato como registro/depuração local (dev); em produção a
 * fonte de verdade é o Mongo (gravarEstadoSentinelaMongo).
 */
export function gravarEstadoSentinela(estado: EstadoAtual): void {
  fs.mkdirSync(DIR_DADOS, { recursive: true });

  let casosAnteriores: CasoEstado[] = [];
  try {
    const anterior = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8')) as EstadoAtual;
    casosAnteriores = anterior.casos ?? [];
  } catch {
    casosAnteriores = [];
  }
  const casos = mesclarCasos(estado.casos, casosAnteriores);
  const estadoParaGravar: EstadoAtual = { ...estado, casos, resumo: resumoDeCasos(casos) };
  fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estadoParaGravar, null, 2) + '\n', 'utf8');

  let historico: RunHistorico[] = [];
  try {
    historico = JSON.parse(fs.readFileSync(ARQ_RUNS, 'utf8'));
    if (!Array.isArray(historico)) historico = [];
  } catch {
    historico = [];
  }

  historico = historico.filter((r) => r.runId !== estado.runId);
  historico.push({
    runId: estado.runId,
    iniciadoEm: estado.iniciadoEm,
    finalizadoEm: estado.finalizadoEm,
    modoExecucao: estado.modoExecucao,
    // Resumo da PRÓPRIA rodada (não o merge) — fiel ao que esta rodada de fato rodou.
    resumo: estado.resumo,
  });
  historico.sort((a, b) => a.iniciadoEm.localeCompare(b.iniciadoEm));
  const cap = estado.modoExecucao === 'vigilancia' ? MAX_RUNS_HISTORICO_VIGILANCIA : MAX_RUNS_HISTORICO;
  if (historico.length > cap) {
    historico = historico.slice(historico.length - cap);
  }

  fs.writeFileSync(ARQ_RUNS, JSON.stringify(historico, null, 2) + '\n', 'utf8');
}

export interface CasoAnterior {
  situacao: string;
  observacao: string;
}

/**
 * Lê o estado "atual" como ele está ANTES desta rodada sobrescrever — é a rodada anterior.
 * Usado pra comparar e não repetir alarme de Telegram pra um problema que já foi notificado e
 * continua exatamente igual (ver montarMensagemResumo). null quando não há rodada anterior
 * (primeira execução) ou o Mongo não está acessível — tratado como "tudo é novo", comportamento
 * de hoje.
 */
export async function lerEstadoAnteriorMongo(): Promise<Map<string, CasoAnterior> | null> {
  try {
    const colEstado = await colQaSentinelaEstado();
    const doc = await colEstado.findOne({ _id: 'atual' });
    const casos = (doc as unknown as EstadoAtual | null)?.casos;
    if (!casos?.length) return null;
    return new Map(casos.map((c) => [c.id, { situacao: c.situacao, observacao: c.observacao }]));
  } catch (err) {
    console.warn('[qa] falha ao ler estado anterior do Mongo:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Grava o mesmo retrato direto no MongoDB (`desk_config`) — é dali que a
 * rotina que atualiza o dashboard Sentinela Velodesk lê, sem precisar passar
 * pelo git. Documento único (`_id: "atual"`) para o estado corrente; um
 * documento por rodada para o histórico de auditoria.
 *
 * Rodada oficial e de vigilância gravam as DUAS no doc único `qa_sentinela_estado`
 * (_id:"atual"). A vigilância só roda um subconjunto leve do catálogo, então os
 * casos que ela não tocou são preservados do snapshot anterior (mesclarCasos) —
 * o dashboard nunca perde a cobertura dos ~40 casos que só a rodada oficial
 * cobre, mesmo entre uma rodada oficial e a próxima.
 *
 * Para o histórico de auditoria, as duas vão para coleções SEPARADAS:
 * `qa_sentinela_runs` (só oficial, capada nas últimas MAX_RUNS_HISTORICO) e
 * `qa_sentinela_runs_vigilancia` (só vigilância, capada nas últimas
 * MAX_RUNS_HISTORICO_VIGILANCIA) — rodando a cada 30 min, a vigilância
 * esvaziaria o histórico oficial rápido demais se dividisse a mesma coleção.
 */
export async function gravarEstadoSentinelaMongo(estado: EstadoAtual): Promise<void> {
  const colEstado = await colQaSentinelaEstado();

  const anterior = await colEstado.findOne({ _id: 'atual' });
  const casosAnteriores = (anterior as unknown as EstadoAtual | null)?.casos ?? [];
  const casos = mesclarCasos(estado.casos, casosAnteriores);
  const estadoParaGravar: EstadoAtual = { ...estado, casos, resumo: resumoDeCasos(casos) };

  await colEstado.updateOne(
    { _id: 'atual' },
    { $set: { ...estadoParaGravar, atualizadoEm: new Date().toISOString() } },
    { upsert: true },
  );

  const vigilancia = estado.modoExecucao === 'vigilancia';
  const colRuns = vigilancia ? await colQaSentinelaRunsVigilancia() : await colQaSentinelaRuns();
  const capHistorico = vigilancia ? MAX_RUNS_HISTORICO_VIGILANCIA : MAX_RUNS_HISTORICO;

  await colRuns.updateOne(
    { _id: estado.runId },
    {
      $set: {
        runId: estado.runId,
        iniciadoEm: estado.iniciadoEm,
        finalizadoEm: estado.finalizadoEm,
        modoExecucao: estado.modoExecucao,
        // Resumo da PRÓPRIA rodada (não o merge) — fiel ao que esta rodada de fato rodou.
        resumo: estado.resumo,
      },
    },
    { upsert: true },
  );

  // Mantém só as últimas capHistorico rodadas na coleção de histórico correspondente.
  const antigas = await colRuns
    .find({}, { projection: { _id: 1 }, sort: { iniciadoEm: -1 } })
    .skip(capHistorico)
    .toArray();
  if (antigas.length) {
    await colRuns.deleteMany({ _id: { $in: antigas.map((d) => d._id) } });
  }
}
