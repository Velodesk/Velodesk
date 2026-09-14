/**
 * estadoSentinela v1.0.0 — retrato da rodada para o dashboard Sentinela Velodesk
 *
 * O agente roda no GitHub Actions e não tem como escrever direto no banco do
 * dashboard (isso só uma sessão do Claude ou alguém abrindo a página faz).
 * Por isso a rodada deixa aqui um retrato compacto (JSON), versionado no
 * próprio repositório em qa/data/ — o workflow comita esse arquivo, e uma
 * rotina agendada à parte lê dali e atualiza o Sentinela publicado.
 */
import fs from 'fs';
import path from 'path';
import { cfg } from './config';
import type { Coletor, TicketRef } from './resultado';
import { colQaSentinelaEstado, colQaSentinelaRuns } from './db';

const DIR_DADOS = path.join(__dirname, '..', 'data');
const ARQ_ESTADO = path.join(DIR_DADOS, 'estado-atual.json');
const ARQ_RUNS = path.join(DIR_DADOS, 'runs.json');
const MAX_RUNS_HISTORICO = 14;

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
  modo: string;
  resumo: ResumoEstado;
  casos: CasoEstado[];
}

interface RunHistorico {
  runId: string;
  iniciadoEm: string;
  finalizadoEm: string;
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
}): EstadoAtual {
  const { runId, inicio, fim, coletor, somenteLeitura } = params;
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
    resumo: resumoParaEstado(coletor),
    casos,
  };
}

/**
 * Grava qa/data/estado-atual.json (retrato da rodada mais recente) e
 * qa/data/runs.json (histórico das últimas MAX_RUNS_HISTORICO rodadas, só o
 * resumo — o suficiente pro gráfico de tendência do dashboard).
 */
export function gravarEstadoSentinela(estado: EstadoAtual): void {
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estado, null, 2) + '\n', 'utf8');

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
    resumo: estado.resumo,
  });
  historico.sort((a, b) => a.iniciadoEm.localeCompare(b.iniciadoEm));
  if (historico.length > MAX_RUNS_HISTORICO) {
    historico = historico.slice(historico.length - MAX_RUNS_HISTORICO);
  }

  fs.writeFileSync(ARQ_RUNS, JSON.stringify(historico, null, 2) + '\n', 'utf8');
}

/**
 * Grava o mesmo retrato direto no MongoDB (coleções `qa_sentinela_estado` e
 * `qa_sentinela_runs`, banco `desk_config`) — é dali que a rotina que
 * atualiza o dashboard Sentinela Velodesk lê, sem precisar passar pelo git.
 * Documento único (`_id: "atual"`) para o estado corrente; um documento por
 * rodada (capado nas últimas MAX_RUNS_HISTORICO) para o histórico.
 */
export async function gravarEstadoSentinelaMongo(estado: EstadoAtual): Promise<void> {
  const colEstado = await colQaSentinelaEstado();
  await colEstado.updateOne(
    { _id: 'atual' },
    { $set: { ...estado, atualizadoEm: new Date().toISOString() } },
    { upsert: true },
  );

  const colRuns = await colQaSentinelaRuns();
  await colRuns.updateOne(
    { _id: estado.runId },
    {
      $set: {
        runId: estado.runId,
        iniciadoEm: estado.iniciadoEm,
        finalizadoEm: estado.finalizadoEm,
        resumo: estado.resumo,
      },
    },
    { upsert: true },
  );

  // Mantém só as últimas MAX_RUNS_HISTORICO rodadas na coleção de histórico.
  const antigas = await colRuns
    .find({}, { projection: { _id: 1 }, sort: { iniciadoEm: -1 } })
    .skip(MAX_RUNS_HISTORICO)
    .toArray();
  if (antigas.length) {
    await colRuns.deleteMany({ _id: { $in: antigas.map((d) => d._id) } });
  }
}
