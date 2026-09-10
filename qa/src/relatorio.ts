/**
 * relatorio v1.0.0 — alimenta a planilha consolidada
 *
 * Uma planilha só, alimentada a cada rodada (07h e 17h), no mesmo formato do
 * consolidado manual. Três abas:
 *   Resumo por rodada · Casos de Teste · Números do dia
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { cfg } from './config';
import type { Coletor, Metrica, Resultado } from './resultado';
import type { Situacao } from './catalogo';

const CORES: Record<string, string> = {
  Sim: 'FFD9F2E3',
  Nao: 'FFF8D7DA',
  Parcial: 'FFFFF3CD',
  'Falha conhecida': 'FFE2E3E5',
  Bloqueado: 'FFE2E3E5',
  'Nao testavel': 'FFF1F1F1',
  'Nao testado': 'FFF1F1F1',
  Normal: 'FFD9F2E3',
  Atenção: 'FFFFF3CD',
  Alerta: 'FFF8D7DA',
};

const AZUL = 'FF000058';

const COLUNAS_CASOS = [
  { header: 'Data', key: 'data', width: 12 },
  { header: 'Hora', key: 'hora', width: 8 },
  { header: 'Rodada', key: 'rodada', width: 14 },
  { header: 'Agente', key: 'agente', width: 22 },
  { header: 'Área / Funcionalidade', key: 'area', width: 22 },
  { header: 'Funcionalidade testada', key: 'funcionalidade', width: 34 },
  { header: 'Objetivo do teste', key: 'objetivo', width: 46 },
  { header: 'Resultado esperado', key: 'esperado', width: 52 },
  { header: 'OK?', key: 'ok', width: 16 },
  { header: 'Executado?', key: 'executado', width: 12 },
  { header: 'Protocolo(s) testado(s)', key: 'protocolos', width: 24 },
  { header: 'Abrir no Desk', key: 'linkDesk', width: 16 },
  { header: 'Observação', key: 'observacao', width: 90 },
  { header: 'Devolutiva (sugestão da IA)', key: 'devolutiva', width: 72 },
];

const COLUNAS_RESUMO = [
  { header: 'Data', key: 'data', width: 12 },
  { header: 'Hora', key: 'hora', width: 8 },
  { header: 'Rodada', key: 'rodada', width: 14 },
  { header: 'Situação geral', key: 'situacao', width: 18 },
  { header: 'Testes executados', key: 'total', width: 18 },
  { header: 'Passaram', key: 'ok', width: 11 },
  { header: 'Com ressalva', key: 'parcial', width: 14 },
  { header: 'Falharam', key: 'falhas', width: 11 },
  { header: 'Falhas conhecidas', key: 'conhecidas', width: 18 },
  { header: 'Não testados', key: 'naoTestados', width: 14 },
  { header: 'Duração', key: 'duracao', width: 11 },
  { header: 'O que precisa de atenção', key: 'atencao', width: 100 },
];

const COLUNAS_NUMEROS = [
  { header: 'Data', key: 'data', width: 12 },
  { header: 'Hora', key: 'hora', width: 8 },
  { header: 'Indicador', key: 'nome', width: 46 },
  { header: 'Valor', key: 'valor', width: 14 },
  { header: 'Situação', key: 'situacao', width: 12 },
  { header: 'Observação', key: 'observacao', width: 60 },
];

function formatarCabecalho(aba: ExcelJS.Worksheet) {
  const linha = aba.getRow(1);
  linha.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  linha.alignment = { vertical: 'middle', horizontal: 'left' };
  linha.height = 24;
  aba.views = [{ state: 'frozen', ySplit: 1 }];
  aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.columnCount } };
}

type Coluna = { header: string; key: string; width: number };

function garantirAba(wb: ExcelJS.Workbook, nome: string, colunas: Coluna[]): ExcelJS.Worksheet {
  const existente = wb.getWorksheet(nome);
  if (existente) {
    // Ao reabrir um arquivo salvo, o ExcelJS não devolve as larguras/chaves das
    // colunas. Reaplica só as larguras — as linhas já gravadas não são tocadas.
    colunas.forEach((c, i) => {
      existente.getColumn(i + 1).width = c.width;
    });
    return existente;
  }
  const aba = wb.addWorksheet(nome);
  aba.columns = colunas.map((c) => ({ header: c.header, key: c.key, width: c.width })) as any;
  formatarCabecalho(aba);
  return aba;
}

/**
 * Monta a linha na ordem das colunas. Não usa as chaves do ExcelJS de
 * propósito: quando a planilha é reaberta de um arquivo, as chaves se perdem e
 * `addRow({...})` gravaria linhas em branco.
 */
function novaLinha(
  aba: ExcelJS.Worksheet,
  colunas: Coluna[],
  valores: Record<string, string | number>,
): ExcelJS.Row {
  const linha = aba.addRow(colunas.map((c) => valores[c.key] ?? ''));
  linha.alignment = { vertical: 'top', wrapText: true };
  return linha;
}

function pintar(aba: ExcelJS.Worksheet, linha: number, coluna: number, chave: string) {
  const cor = CORES[chave];
  if (!cor) return;
  const celula = aba.getCell(linha, coluna);
  celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  celula.font = { bold: true };
}

const dataBr = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: cfg.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const horaBr = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: cfg.timezone, hour: '2-digit', minute: '2-digit' }).format(d);

/** Nome da rodada: "Manhã (07h)", "Tarde (17h)" ou o rótulo informado. */
export function nomeRodada(agora: Date): string {
  if (cfg.rodada) return cfg.rodada;
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', { timeZone: cfg.timezone, hour: '2-digit', hour12: false }).format(agora),
  );
  if (hora < 12) return `Manhã (${String(hora).padStart(2, '0')}h)`;
  if (hora < 18) return `Tarde (${String(hora).padStart(2, '0')}h)`;
  return `Noite (${String(hora).padStart(2, '0')}h)`;
}

function situacaoGeral(c: Coletor): string {
  const r = c.resumo;
  if (r.falhas > 0) return 'Falha nova';
  if (r.bloqueados > 0) return 'Bloqueado';
  if (r.parcial > 0) return 'Com ressalva';
  return 'Tudo certo';
}

const executado = (s: Situacao) => (s === 'Nao testado' ? 'Nao' : 'Sim');

export interface DadosRodada {
  inicio: Date;
  fim: Date;
  coletor: Coletor;
  observacaoGeral: string;
  /** id do caso → texto da coluna Devolutiva (sugestão de correção). */
  devolutivas?: Map<string, string>;
}

export async function alimentarPlanilha(arquivo: string, dados: DadosRodada): Promise<void> {
  const { coletor, inicio, fim } = dados;
  const wb = new ExcelJS.Workbook();

  if (fs.existsSync(arquivo)) {
    await wb.xlsx.readFile(arquivo);
  } else {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    wb.creator = 'Claudio Q.A.';
  }
  wb.modified = new Date();

  const data = dataBr(inicio);
  const hora = horaBr(inicio);
  const rodada = nomeRodada(inicio);

  // ── Resumo por rodada ────────────────────────────────────────────────────
  const abaResumo = garantirAba(wb, 'Resumo por rodada', COLUNAS_RESUMO);
  const r = coletor.resumo;
  const criticos = coletor.resultados
    .filter((x) => x.situacao === 'Nao' || x.situacao === 'Bloqueado')
    .map((x) => `${x.caso.funcionalidade}: ${x.observacao}`);
  const situacao = situacaoGeral(coletor);
  const linhaResumo = novaLinha(abaResumo, COLUNAS_RESUMO, {
    data,
    hora,
    rodada,
    situacao,
    total: r.total,
    ok: r.ok,
    parcial: r.parcial,
    falhas: r.falhas,
    conhecidas: r.conhecidas,
    naoTestados: r.naoTestados + r.naoTestaveis,
    duracao: `${Math.round((fim.getTime() - inicio.getTime()) / 1000)}s`,
    atencao:
      [criticos.join(' • '), dados.observacaoGeral].filter(Boolean).join(' • ') || 'Nada exigindo ação.',
  });
  pintar(abaResumo, linhaResumo.number, 4, situacao === 'Tudo certo' ? 'Sim' : situacao === 'Com ressalva' ? 'Parcial' : 'Nao');

  // ── Casos de Teste ───────────────────────────────────────────────────────
  const abaCasos = garantirAba(wb, 'Casos de Teste', COLUNAS_CASOS);
  const ordenados = [...coletor.resultados].sort((a, b) => a.caso.id.localeCompare(b.caso.id));
  const colLinkDesk = COLUNAS_CASOS.findIndex((c) => c.key === 'linkDesk') + 1;
  for (const res of ordenados) {
    const protocolos = (res.tickets ?? [])
      .map((t) => (t.papel ? `${t.protocolo} (${t.papel})` : t.protocolo))
      .join(' / ');
    const linha = novaLinha(abaCasos, COLUNAS_CASOS, {
      data,
      hora,
      rodada,
      agente: cfg.agente,
      area: res.caso.area,
      funcionalidade: res.caso.funcionalidade,
      objetivo: res.caso.objetivo,
      esperado: res.caso.esperado,
      ok: res.situacao,
      executado: executado(res.situacao),
      protocolos,
      observacao: res.observacao,
      devolutiva: dados.devolutivas?.get(res.caso.id) ?? '',
    });
    pintar(abaCasos, linha.number, 9, res.situacao);
    // Link direto pro primeiro ticket usado na checagem — a planilha guarda o
    // link, não só o protocolo, pra quem for investigar não ter que colar a
    // URL na mão.
    const primeiroTicket = res.tickets?.[0];
    if (primeiroTicket?.id) {
      linha.getCell(colLinkDesk).value = {
        text: 'Abrir no Desk',
        hyperlink: `${cfg.baseUrl}/tickets?desk=v2&ticket=${primeiroTicket.id}&queue=resolvidos`,
      };
      linha.getCell(colLinkDesk).font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  }

  // ── Números do dia ───────────────────────────────────────────────────────
  const abaNumeros = garantirAba(wb, 'Números do dia', COLUNAS_NUMEROS);
  for (const m of coletor.metricas as Metrica[]) {
    const linha = novaLinha(abaNumeros, COLUNAS_NUMEROS, {
      data,
      hora,
      nome: m.nome,
      valor: m.valor,
      situacao: m.situacao,
      observacao: m.observacao ?? '',
    });
    pintar(abaNumeros, linha.number, 5, m.situacao);
  }

  await wb.xlsx.writeFile(arquivo);
}

/** Resumo curto para o log da execução. */
export function resumoTexto(coletor: Coletor): string {
  const r = coletor.resumo;
  const linhas = [
    `Situação geral: ${situacaoGeral(coletor)}`,
    `${r.total} testes — ${r.ok} passaram, ${r.parcial} com ressalva, ${r.falhas} falharam, ` +
      `${r.conhecidas} falha(s) conhecida(s), ${r.bloqueados} bloqueado(s), ${r.naoTestados + r.naoTestaveis} não testado(s).`,
  ];
  const problemas = coletor.resultados.filter((x: Resultado) => x.situacao === 'Nao' || x.situacao === 'Bloqueado');
  for (const p of problemas) linhas.push(`  [${p.caso.id}] ${p.caso.funcionalidade} → ${p.observacao}`);
  return linhas.join('\n');
}
