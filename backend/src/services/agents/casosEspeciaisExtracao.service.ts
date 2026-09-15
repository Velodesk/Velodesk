/**
 * casosEspeciaisExtracao.service v1.0.0 — Agente 5: extração de campos (Procon/Bacen/Consumidor.gov)
 *
 * Roda DEPOIS que o Agente 4 (classificação) já decidiu que o ticket é um caso formal de um
 * desses 3 órgãos e o registro já foi criado/atualizado em reclamacoes_* (upsertFromChamado).
 * Este agente só lê o texto do ticket e preenche os campos do esquema que ainda estiverem vazios
 * — nunca sobrescreve o que já veio preenchido (ex.: pelos parsers determinísticos de Bacen/
 * Consumidor.gov, que rodam antes, no e-mail inbound). Campos que a LLM não encontrar ficam em
 * branco mesmo, para preenchimento manual do responsável pela ocorrência.
 */
import { Types } from 'mongoose';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { adaptChamadoToTicketIa, buildTicketIaText } from '../ticketIaAdapter.service';
import {
  createOpenAiClient,
  extractOutputText,
  isOpenAiApiKeyConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { resolveReclamacaoModel } from '../reclamacoes/reclamacao.service';
import { getCasosEspeciaisExtracaoProconPersona } from './personas/casosEspeciaisExtracaoProconPersona';
import { getCasosEspeciaisExtracaoBacenPersona } from './personas/casosEspeciaisExtracaoBacenPersona';
import { getCasosEspeciaisExtracaoConsumidorGovPersona } from './personas/casosEspeciaisExtracaoConsumidorGovPersona';
import { logAiUsage } from '../aiUsage.service';

export type CasoEspecialExtracaoOrgao = 'procon' | 'bacen' | 'consumidor_gov';

const EXTRACAO_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    consumidor: { type: 'string' },
    cpf: { type: 'string' },
    email: { type: 'string' },
    telefone: { type: 'string' },
    cidade: { type: 'string' },
    uf: { type: 'string' },
    protocolo: { type: 'string' },
    orgaoInstituicao: { type: 'string' },
    assunto: { type: 'string' },
    descricao: { type: 'string' },
    produto: { type: 'string' },
    prazoLegalData: { type: 'string' },
    dataAberturaData: { type: 'string' },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
  },
  required: [
    'consumidor', 'cpf', 'email', 'telefone', 'cidade', 'uf', 'protocolo', 'orgaoInstituicao',
    'assunto', 'descricao', 'produto', 'prazoLegalData', 'dataAberturaData', 'confianca',
  ],
} as const;

interface ExtracaoParsed {
  consumidor?: string;
  cpf?: string;
  email?: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
  protocolo?: string;
  orgaoInstituicao?: string;
  assunto?: string;
  descricao?: string;
  produto?: string;
  prazoLegalData?: string;
  dataAberturaData?: string;
  confianca?: 'alta' | 'media' | 'baixa';
}

const PERSONA_BY_ORGAO: Record<CasoEspecialExtracaoOrgao, () => string> = {
  procon: getCasosEspeciaisExtracaoProconPersona,
  bacen: getCasosEspeciaisExtracaoBacenPersona,
  consumidor_gov: getCasosEspeciaisExtracaoConsumidorGovPersona,
};

export interface CasosEspeciaisExtracaoResult {
  ran: boolean;
  filledFields?: string[];
  error?: string;
}

function normalizeCpfDigits(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Só aceita AAAA-MM-DD explícito da LLM — nunca deixa ela "inventar" um formato ambíguo. */
function parseIsoDateOnly(value: string | undefined): Date | undefined {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T12:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildUserBlock(chamado: IChamadoN1, canalLabel: string): string {
  const payload = adaptChamadoToTicketIa(chamado);
  const texto = payload ? buildTicketIaText(payload, 6000) : String(chamado.chamadoTitulo ?? '');
  return [
    `Protocolo interno Velodesk: ${chamado.chamadoProtocolo || '(sem protocolo)'}`,
    `Órgão já classificado pelo Agente 4: ${canalLabel}`,
    '',
    'Texto do ticket (mensagem original + histórico):',
    texto,
  ].join('\n');
}

/**
 * Extrai campos do ticket via LLM e preenche só os campos que ainda estiverem vazios no
 * documento da reclamação — fail-soft: qualquer problema (IA desligada, sem API key, erro de
 * parsing) só loga e retorna `ran: false`/`error`, nunca derruba o fluxo de roteamento do Agente 4.
 */
export async function extractCasosEspeciaisFields(params: {
  chamado: IChamadoN1;
  orgao: CasoEspecialExtracaoOrgao;
  reclamacaoId: Types.ObjectId;
}): Promise<CasosEspeciaisExtracaoResult> {
  const { chamado, orgao, reclamacaoId } = params;

  if (!env.agentCasosEspeciaisExtracaoEnabled) {
    return { ran: false };
  }
  if (!isOpenAiApiKeyConfigured()) {
    return { ran: false, error: 'OpenAI não configurado' };
  }

  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return { ran: false, error: 'Órgão inválido' };

  try {
    const doc = await Model.findById(reclamacaoId).exec();
    if (!doc) return { ran: false, error: 'Reclamação não encontrada' };

    const personaFn = PERSONA_BY_ORGAO[orgao];
    const canalLabel = orgao === 'procon' ? 'Procon' : orgao === 'bacen' ? 'Bacen' : 'Consumidor.gov';

    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: personaFn() },
        { role: 'user', content: buildUserBlock(chamado, canalLabel) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_casos_especiais_extracao',
          schema: EXTRACAO_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const modelUsed = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model: modelUsed,
        feature: 'casos_especiais_extracao',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: String(chamado._id),
        protocolo: chamado.chamadoProtocolo,
      });
    }

    const parsed = parseAiJson<ExtracaoParsed>(extractOutputText(response));
    if (!parsed) {
      return { ran: true, error: 'Resposta de extração inválida' };
    }

    // Nunca sobrescreve o que já está preenchido (ex.: parser determinístico de Bacen/CGov que
    // rodou antes, ou preenchimento manual de um agente).
    const set: Record<string, unknown> = {};
    const filled: string[] = [];

    const maybeSetString = (docField: string, currentValue: unknown, extracted: string | undefined) => {
      const value = String(extracted ?? '').trim();
      if (!value) return;
      if (String(currentValue ?? '').trim()) return;
      set[docField] = value;
      filled.push(docField);
    };

    maybeSetString('consumidor', doc.consumidor, parsed.consumidor);
    maybeSetString('cpf', doc.cpf, parsed.cpf ? normalizeCpfDigits(parsed.cpf) : undefined);
    maybeSetString('telefoneWhatsapp', doc.telefoneWhatsapp, parsed.telefone);
    maybeSetString('cidade', doc.cidade, parsed.cidade);
    maybeSetString('uf', doc.uf, parsed.uf);
    maybeSetString('orgaoInstituicao', doc.orgaoInstituicao, parsed.orgaoInstituicao);
    maybeSetString('assunto', doc.assunto, parsed.assunto);
    maybeSetString('descricao', doc.descricao, parsed.descricao);
    maybeSetString('produto', doc.produto, parsed.produto);
    maybeSetString('protocoloExterno', doc.protocoloExterno, parsed.protocolo);
    maybeSetString('idDemandaExterna', doc.idDemandaExterna, parsed.protocolo);

    const currentEmail = Array.isArray(doc.email) ? doc.email.filter(Boolean) : [];
    const extractedEmail = String(parsed.email ?? '').trim();
    if (!currentEmail.length && extractedEmail) {
      set.email = [extractedEmail];
      filled.push('email');
    }

    if (!doc.prazoLegal) {
      const prazo = parseIsoDateOnly(parsed.prazoLegalData);
      if (prazo) {
        set.prazoLegal = prazo;
        filled.push('prazoLegal');
      }
    }
    if (!doc.dataReclamacao) {
      const abertura = parseIsoDateOnly(parsed.dataAberturaData);
      if (abertura) {
        set.dataReclamacao = abertura;
        filled.push('dataReclamacao');
      }
    }

    if (!Object.keys(set).length) {
      return { ran: true, filledFields: [] };
    }

    await Model.updateOne({ _id: reclamacaoId }, { $set: set }).exec();

    console.info('[casos-especiais-extracao]', {
      protocolo: chamado.chamadoProtocolo,
      orgao,
      confianca: parsed.confianca,
      filledFields: filled,
    });

    return { ran: true, filledFields: filled };
  } catch (err) {
    const message = mapOpenAiErrorMessage(err);
    console.warn('[casos-especiais-extracao] fail-soft:', message);
    return { ran: true, error: message };
  }
}
