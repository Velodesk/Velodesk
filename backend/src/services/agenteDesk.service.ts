/**
 * agenteDesk.service v2.0.0 — leitura 100% ao vivo do VeloHub, sem espelho local (desk_agentes removida)
 * Fail-closed: se o VeloHub estiver indisponível, a listagem falha em vez de cair num cache desatualizado.
 */
import {
  listColaboradoresVelotaxDesk,
  type ColaboradorDeskPublico,
} from './colaboradoresCadastro.service';
import { listFuncoesPermissoes } from './funcaoPermissao.service';
import { extractFuncoes, resolvePrimaryFuncao } from '../utils/normalizeFuncao';

export interface AgenteDeskPublico {
  email: string;
  velohubId: string;
  colaboradorNome: string;
  empresa: string;
  departamento: string;
  atuacao: ColaboradorDeskPublico['atuacao'];
  funcaoSlug: string | null;
  funcaoNome: string | null;
  nivel: number | null;
  afastado: boolean;
  syncedAt: string | null;
  updatedBy: string;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

async function buildFuncaoMap() {
  const funcoes = await listFuncoesPermissoes();
  return new Map(funcoes.map((f) => [f.slug, { nome: f.nome, nivel: f.nivel ?? 1 }]));
}

export function deriveFuncaoFromAtuacao(
  atuacao: ColaboradorDeskPublico['atuacao'] | undefined,
  funcaoBySlug: Map<string, { nome: string; nivel: number }>,
): { funcaoSlug: string | null; funcaoNome: string | null; nivel: number | null } {
  const slugs = extractFuncoes(atuacao);
  if (!slugs.length) {
    return { funcaoSlug: null, funcaoNome: null, nivel: null };
  }

  const nivelMap = new Map(
    [...funcaoBySlug.entries()].map(([slug, f]) => [slug, f.nivel]),
  );
  const funcaoSlug = resolvePrimaryFuncao(slugs, nivelMap);
  const funcao = funcaoBySlug.get(funcaoSlug);
  return {
    funcaoSlug: funcaoSlug || null,
    funcaoNome: funcao?.nome || funcaoSlug || null,
    nivel: funcao?.nivel ?? nivelMap.get(funcaoSlug) ?? null,
  };
}

function mapColaboradorToPublico(
  col: ColaboradorDeskPublico,
  funcaoBySlug: Map<string, { nome: string; nivel: number }>,
): AgenteDeskPublico {
  const derived = deriveFuncaoFromAtuacao(col.atuacao, funcaoBySlug);
  return {
    email: normalizeEmail(col.userMail),
    velohubId: String(col._id || ''),
    colaboradorNome: col.colaboradorNome || '',
    empresa: col.empresa || '',
    departamento: col.departamento || '',
    atuacao: col.atuacao || [],
    funcaoSlug: derived.funcaoSlug,
    funcaoNome: derived.funcaoNome,
    nivel: derived.nivel,
    afastado: col.afastado === true,
    syncedAt: new Date().toISOString(),
    updatedBy: 'velohub-live',
  };
}

/** Lista agentes Desk ao vivo do VeloHub (fonte da verdade). Sem cache/fallback local. */
export async function listAgentesDeskLive(): Promise<AgenteDeskPublico[]> {
  const [colaboradores, funcaoBySlug] = await Promise.all([
    listColaboradoresVelotaxDesk(),
    buildFuncaoMap(),
  ]);
  return colaboradores
    .map((col) => mapColaboradorToPublico(col, funcaoBySlug))
    .filter((a) => Boolean(a.email))
    .sort((a, b) => a.colaboradorNome.localeCompare(b.colaboradorNome, 'pt-BR'));
}

function normalizePersonToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Resolve o e-mail Desk do colaborador a partir do nome gravado em responsável/atribuído.
 * Fail-soft: devolve string vazia se não houver match (não bloqueia o fluxo de comunicação).
 */
export async function findAgenteEmailByNome(nome: string): Promise<string> {
  const target = normalizePersonToken(nome);
  if (!target) return '';

  const agentes = await listAgentesDeskLive();
  const exact = agentes.find((agente) => {
    const colaboradorNome = normalizePersonToken(agente.colaboradorNome);
    const localPart = normalizePersonToken(String(agente.email || '').split('@')[0]);
    return colaboradorNome === target || localPart === target;
  });
  if (exact?.email) return normalizeEmail(exact.email);

  const partial = agentes.find((agente) => {
    const colaboradorNome = normalizePersonToken(agente.colaboradorNome);
    return colaboradorNome && (colaboradorNome.includes(target) || target.includes(colaboradorNome));
  });
  return partial?.email ? normalizeEmail(partial.email) : '';
}
