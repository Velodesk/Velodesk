/** redesSociaisCaptacaoEstado.service v1.0.0 — carrega/salva no Mongo o estado de
 * captação (EstadoDeCaptacaoFacebook/Instagram) entre ciclos, pra sobreviver a
 * reinício do processo. Antes disso, esse estado vivia só em memória (ver histórico
 * de orquestrador.service.ts) — todo deploy/restart do Cloud Run forçava uma nova
 * sincronização do zero. Ver models/RedesSociaisCaptacaoEstado.
 */
import { getRedesSociaisCaptacaoEstadoModel } from '../../models/RedesSociaisCaptacaoEstado';
import type { EstadoDeCaptacaoFacebook } from './captacao/facebookCaptacao.service';
import type { EstadoDeCaptacaoInstagram } from './captacao/instagramCaptacao.service';

export async function carregarEstadoFacebook(): Promise<EstadoDeCaptacaoFacebook | null> {
  const Model = getRedesSociaisCaptacaoEstadoModel();
  const doc = await Model.findOne({ canal: 'facebook' }).lean();
  if (!doc) return null;

  return {
    postsConhecidos: new Set(doc.containersConhecidos),
    comentariosConhecidos: new Set(doc.comentariosConhecidos),
    ultimoFilhoConhecidoPorContainer: new Map(Object.entries(doc.cursores ?? {})),
  };
}

export async function salvarEstadoFacebook(estado: EstadoDeCaptacaoFacebook): Promise<void> {
  const Model = getRedesSociaisCaptacaoEstadoModel();
  await Model.findOneAndUpdate(
    { canal: 'facebook' },
    {
      $set: {
        containersConhecidos: Array.from(estado.postsConhecidos),
        comentariosConhecidos: Array.from(estado.comentariosConhecidos),
        cursores: estado.ultimoFilhoConhecidoPorContainer,
        atualizadoEm: new Date(),
      },
    },
    { upsert: true },
  ).exec();
}

export async function carregarEstadoInstagram(): Promise<EstadoDeCaptacaoInstagram | null> {
  const Model = getRedesSociaisCaptacaoEstadoModel();
  const doc = await Model.findOne({ canal: 'instagram' }).lean();
  if (!doc) return null;

  return {
    midiasConhecidas: new Set(doc.containersConhecidos),
    comentariosConhecidos: new Set(doc.comentariosConhecidos),
    ultimoFilhoConhecidoPorContainer: new Map(Object.entries(doc.cursores ?? {})),
  };
}

export async function salvarEstadoInstagram(estado: EstadoDeCaptacaoInstagram): Promise<void> {
  const Model = getRedesSociaisCaptacaoEstadoModel();
  await Model.findOneAndUpdate(
    { canal: 'instagram' },
    {
      $set: {
        containersConhecidos: Array.from(estado.midiasConhecidas),
        comentariosConhecidos: Array.from(estado.comentariosConhecidos),
        cursores: estado.ultimoFilhoConhecidoPorContainer,
        atualizadoEm: new Date(),
      },
    },
    { upsert: true },
  ).exec();
}
