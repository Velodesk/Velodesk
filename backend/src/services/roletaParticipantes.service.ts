/**
 * roletaParticipantes.service v1.0.0 — override manual de quem participa da roleta
 *
 * Enquanto não existe tela no front para isso, este serviço é a única forma de
 * corrigir quem a roleta considera elegível sem depender só do campo `atuacao`
 * do cadastro (console_funcionarios) — ver RoletaParticipante.ts para o porquê.
 */
import { getRoletaParticipanteModel } from '../models/RoletaParticipante';
import { listAgentesDeskLive } from './agenteDesk.service';
import { extractFuncoes } from '../utils/normalizeFuncao';

function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

/** Mapa e-mail (minúsculo) → override explícito. Uma query só, reaproveitada por toda a rodada de atribuição. */
export async function loadParticipanteOverrides(): Promise<Map<string, boolean>> {
  const Model = getRoletaParticipanteModel();
  const docs = await Model.find({}).select('email ativo').lean();
  return new Map(docs.map((doc) => [normalizeEmail(doc.email), doc.ativo === true]));
}

export interface ParticipanteRoletaView {
  email: string;
  colaboradorNome: string;
  /** Formato original do cadastro (ex.: [{funcao:'Atendimento'}]) — mesma forma que agentesDeskApi já devolvia, pra não quebrar a formatação existente no front. */
  atuacao: unknown;
  funcaoNome: string | null;
  funcaoSlug: string | null;
  nivel: number | null;
  afastado: boolean;
  elegivelPorCadastro: boolean;
  override: boolean | null;
  elegivelFinal: boolean;
  motivo: string;
  atualizadoPor: string;
  atualizadoEm: Date | null;
}

/** Visão completa para gestão: todo colaborador com acesso Desk + estado final da roleta para cada um. */
export async function listParticipantesRoleta(): Promise<ParticipanteRoletaView[]> {
  const [agentes, overridesDocs] = await Promise.all([
    listAgentesDeskLive(),
    getRoletaParticipanteModel().find({}).lean(),
  ]);

  const overridesByEmail = new Map(overridesDocs.map((d) => [normalizeEmail(d.email), d]));

  return agentes.map((agente) => {
    const email = normalizeEmail(agente.email);
    const funcoes = extractFuncoes(agente.atuacao);
    const elegivelPorCadastro =
      !agente.afastado &&
      (funcoes.includes('atendimento') || funcoes.includes('n2') || (Boolean(agente.funcaoSlug) && agente.funcaoSlug !== 'gestao'));
    const overrideDoc = overridesByEmail.get(email);
    const override = overrideDoc ? overrideDoc.ativo === true : null;

    return {
      email,
      colaboradorNome: agente.colaboradorNome,
      atuacao: agente.atuacao,
      funcaoNome: agente.funcaoNome,
      funcaoSlug: agente.funcaoSlug,
      nivel: agente.nivel,
      afastado: agente.afastado,
      elegivelPorCadastro,
      override,
      elegivelFinal: override ?? elegivelPorCadastro,
      motivo: overrideDoc?.motivo ?? '',
      atualizadoPor: overrideDoc?.atualizadoPor ?? '',
      atualizadoEm: overrideDoc?.updatedAt ?? null,
    };
  });
}

/** Define (ou substitui) o override para um e-mail. `ativo=false` tira da roleta mesmo com atuação de atendimento/N2. */
export async function setParticipanteRoleta(
  email: string,
  ativo: boolean,
  meta: { motivo?: string; atualizadoPor?: string } = {},
): Promise<void> {
  const Model = getRoletaParticipanteModel();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('E-mail obrigatório.');
  await Model.findOneAndUpdate(
    { email: normalized },
    {
      $set: {
        ativo,
        motivo: meta.motivo ?? '',
        atualizadoPor: meta.atualizadoPor ?? '',
      },
    },
    { upsert: true },
  );
}

/** Remove o override — volta a valer a regra padrão (atuacao/afastado do cadastro). */
export async function removeParticipanteRoleta(email: string): Promise<boolean> {
  const Model = getRoletaParticipanteModel();
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const result = await Model.deleteOne({ email: normalized });
  return result.deletedCount > 0;
}
