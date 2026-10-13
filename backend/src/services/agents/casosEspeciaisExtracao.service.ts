/**
 * casosEspeciaisExtracao.service v1.1.0 — Agente 5 também associa cliente por CPF e preenche
 * tabulacao.produto/motivo do chamado (catálogo ativo)
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
import { resolveClienteRefFromBody } from '../cliente.service';
import { readTabulacaoSnapshot } from '../chamado.mapper';
import { buildTabulationCatalog, loadTabulationConfig, validateTabulationResult } from './agentTabulation.util';
import type { TabulationActiveDto } from '../tabulation.service';

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
    tabulacaoProduto: { type: 'string' },
    tabulacaoMotivo: { type: 'string' },
    prazoLegalData: { type: 'string' },
    dataAberturaData: { type: 'string' },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
  },
  required: [
    'consumidor', 'cpf', 'email', 'telefone', 'cidade', 'uf', 'protocolo', 'orgaoInstituicao',
    'assunto', 'descricao', 'produto', 'tabulacaoProduto', 'tabulacaoMotivo',
    'prazoLegalData', 'dataAberturaData', 'confianca',
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
  tabulacaoProduto?: string;
  tabulacaoMotivo?: string;
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

/** Mesmo algoritmo de `consultaCpfResolver.service.ts`/`chamado.mapper.ts` — evita associar
 * cliente a partir de uma sequência de dígitos alucinada pela LLM que nem chega a ser um CPF
 * matematicamente válido. */
function isValidCpfDigits(cpf: string): boolean {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += parseInt(cpf[i], 10) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== parseInt(cpf[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += parseInt(cpf[i], 10) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === parseInt(cpf[10], 10);
}

/** Só aceita AAAA-MM-DD explícito da LLM — nunca deixa ela "inventar" um formato ambíguo. */
function parseIsoDateOnly(value: string | undefined): Date | undefined {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T12:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function buildUserBlock(chamado: IChamadoN1, canalLabel: string, tabConfig: TabulationActiveDto): string {
  const payload = adaptChamadoToTicketIa(chamado);
  const texto = payload ? buildTicketIaText(payload, 6000) : String(chamado.chamadoTitulo ?? '');
  return [
    `Protocolo interno Velodesk: ${chamado.chamadoProtocolo || '(sem protocolo)'}`,
    `Órgão já classificado pelo Agente 4: ${canalLabel}`,
    '',
    'Texto do ticket (mensagem original + histórico):',
    texto,
    '',
    '## Catálogo de tabulação (lista fechada)',
    '',
    buildTabulationCatalog(tabConfig) || '(catálogo indisponível — deixe tabulacaoProduto e tabulacaoMotivo vazios)',
  ].join('\n');
}

/**
 * Aplica ao CHAMADO (não ao doc de reclamação) o que a extração encontrou: associação de
 * cliente por CPF e preenchimento de tabulacao.produto/motivo. Sempre "não sobrescreve" o que já
 * está identificado — exceção única: `motivo` pode substituir o placeholder que
 * `updateTabulacaoCanal` grava ali antes do Agente 5 rodar (o nome do próprio canal/órgão,
 * ex.: "Bacen"), porque isso não é uma tabulação de verdade, é só um fallback pra não deixar o
 * campo vazio até algo melhor aparecer.
 */
async function applyExtractedFieldsToChamado(
  chamado: IChamadoN1,
  parsed: ExtracaoParsed,
  canalLabel: string,
  tabConfig: TabulationActiveDto,
): Promise<string[]> {
  const filled: string[] = [];

  const currentCliente = chamado.cliente?.[0] ?? null;
  const extractedCpf = normalizeCpfDigits(parsed.cpf ?? '');
  if (!String(currentCliente?.clienteCpf ?? '').trim() && extractedCpf && isValidCpfDigits(extractedCpf)) {
    const clienteRefs = await resolveClienteRefFromBody({ clientCPF: extractedCpf }, currentCliente);
    if (clienteRefs.length > 0) {
      chamado.cliente = clienteRefs;
      filled.push('chamado.cliente');
    }
  }

  // Prefere a escolha da LLM feita direto sobre o catálogo fechado; cai pro texto livre
  // (produto/assunto) só se ela não escolheu nada.
  const produtoExtraido = String(parsed.tabulacaoProduto || parsed.produto || '').trim();
  const motivoExtraido = String(parsed.tabulacaoMotivo || parsed.assunto || '').trim();
  if (produtoExtraido || motivoExtraido) {
    const idx = chamado.tabulacao?.length ? chamado.tabulacao.length - 1 : 0;
    const snapshot = readTabulacaoSnapshot(chamado.tabulacao?.[idx]);

    const produtoVazio = !snapshot.produto.trim();
    const motivoEhPlaceholder = !snapshot.motivo.trim()
      || snapshot.motivo.trim().toLowerCase() === canalLabel.trim().toLowerCase();

    if (produtoVazio || motivoEhPlaceholder) {
      // Motivo só é validado pelo catálogo DENTRO do produto — se o chamado já tem um produto
      // (não vazio), resolve o motivo extraído contra ESSE produto, não contra o que a LLM
      // eventualmente também tenha citado (que pode divergir do que já está tabulado).
      const produtoParaContexto = produtoVazio ? produtoExtraido : snapshot.produto;
      const resolved = validateTabulationResult(
        { produto: produtoParaContexto, motivo: motivoExtraido },
        tabConfig,
      );

      // `validateTabulationResult` só valida motivo contra o catálogo DENTRO do produto já
      // resolvido (é uma árvore produto→motivo) — sem produto resolvido, o motivo devolvido
      // é só o texto bruto da LLM sem checagem nenhuma, então não é seguro gravar.
      const next = { ...snapshot };
      if (produtoVazio && resolved.produto) {
        next.produto = resolved.produto;
        filled.push('chamado.tabulacao.produto');
      }
      if (motivoEhPlaceholder && resolved.produto && resolved.motivo) {
        next.motivo = resolved.motivo;
        filled.push('chamado.tabulacao.motivo');
      }

      if (next.produto !== snapshot.produto || next.motivo !== snapshot.motivo) {
        if (!chamado.tabulacao?.length) {
          chamado.tabulacao = [next];
        } else {
          chamado.tabulacao[idx] = next;
        }
        chamado.markModified('tabulacao');
      }
    }
  }

  if (filled.length > 0) {
    await chamado.save();
  }

  return filled;
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

    const tabConfig = await loadTabulationConfig();
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: personaFn() },
        { role: 'user', content: buildUserBlock(chamado, canalLabel, tabConfig) },
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

    if (Object.keys(set).length) {
      await Model.updateOne({ _id: reclamacaoId }, { $set: set }).exec();
    }

    // Cliente (CPF) e tabulação (produto/motivo) vivem no CHAMADO, não no doc de reclamação —
    // roda independente de `set` ter algo pro doc de reclamação (ex.: doc já veio todo
    // preenchido pelo parser determinístico, mas o chamado ainda não tem cliente identificado).
    const chamadoFilled = await applyExtractedFieldsToChamado(chamado, parsed, canalLabel, tabConfig);
    filled.push(...chamadoFilled);

    if (!filled.length) {
      return { ran: true, filledFields: [] };
    }

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
