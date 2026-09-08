/** cliente.service v1.7.0 — enriquecimento parcial de email/telefone via Customer Data API */
import mongoose from 'mongoose';
import { getClienteModel, ICliente, IClienteDados } from '../models/Cliente';
import type { IClienteRef } from '../models/ChamadoN1';
import {
  fetchOverview,
  isCustomerDataApiConfigured,
  type ConsultaSnapshotResult,
} from './customerDataApi.service';
import { extractContractedProductSlugs } from './consultaProductMap';
import { normalizeBrPhoneLocal } from './phone.util';

export function normalizeCpf(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function parseEmailAddress(raw: unknown): { email: string; name?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { email: '' };

  const bracketMatch = text.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracketMatch) {
    const name = bracketMatch[1].trim().replace(/^["']|["']$/g, '');
    return { email: normalizeEmail(bracketMatch[2]), name: name || undefined };
  }

  return { email: normalizeEmail(text) };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean);
    return items.length > 0 ? items : fallback;
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return fallback;
}

/** Lista de telefones, com o DDI +55 descartado quando presente — indiferente à fonte. */
function normalizePhoneList(value: unknown): string[] {
  return normalizeStringList(value).map((item) => normalizeBrPhoneLocal(item)).filter(Boolean);
}

function normalizeTelefoneWhatsapp(value: unknown, phoneList: string[]): string {
  const selected = normalizeBrPhoneLocal(value);
  if (selected && phoneList.includes(selected)) return selected;
  if (phoneList.length === 1) return phoneList[0];
  return '';
}

function normalizeEmailResposta(value: unknown, emailList: string[]): string {
  const selected = normalizeEmail(value);
  if (selected && emailList.some((item) => normalizeEmail(item) === selected)) return selected;
  if (emailList.length === 1) return normalizeEmail(emailList[0]);
  return '';
}

function dadosFromBody(body: Record<string, unknown>): IClienteDados | null {
  const lateral = (body.lateralForm ?? {}) as Record<string, unknown>;
  const cpf = normalizeCpf(body.clientCPF ?? lateral.clienteCpf ?? lateral.cpf);
  const nome = String(body.clientName ?? lateral.clienteNome ?? '').trim();
  const emailLista = [
    ...new Set([
      ...normalizeStringList(lateral.clienteEmail),
      ...normalizeStringList(body.clientEmail),
    ].filter(Boolean)),
  ];
  const telLista = [
    ...new Set([
      ...normalizePhoneList(lateral.clienteTelefone),
      ...normalizePhoneList(body.clientPhone),
    ].filter(Boolean)),
  ];
  const whatsappRaw =
    lateral.clienteTelefoneWhatsapp
    ?? (lateral.clienteTelefone as { whatsapp?: unknown } | undefined)?.whatsapp
    ?? (body.clienteTelefoneWhatsapp as unknown);
  const emailRespostaRaw =
    lateral.clienteEmailResposta
    ?? (lateral.clienteEmail as { resposta?: unknown } | undefined)?.resposta
    ?? (body.clienteEmailResposta as unknown);

  if (!cpf && !nome) return null;

  const emailResposta = normalizeEmailResposta(emailRespostaRaw, emailLista);
  const dados: IClienteDados = {
    clienteCpf: cpf,
    clienteNome: nome,
    clienteEmail: {
      lista: emailLista,
      ...(emailResposta ? { resposta: emailResposta } : {}),
    },
    clienteTelefone: {
      lista: telLista,
      whatsapp: normalizeTelefoneWhatsapp(whatsappRaw, telLista),
    },
  };

  if (!cpf) {
    delete (dados as { clienteCpf?: string }).clienteCpf;
  }

  return dados;
}

export function getPrimaryDados(cliente: ICliente | null): IClienteDados | null {
  if (!cliente?.clienteDados?.length) return null;
  return cliente.clienteDados[0];
}

export async function findClienteByCpf(cpfRaw: unknown): Promise<ICliente | null> {
  const cpf = normalizeCpf(cpfRaw);
  if (!cpf) return null;
  const Cliente = getClienteModel();
  return Cliente.findOne({ 'clienteDados.clienteCpf': cpf });
}

export type ClienteLookupSource = 'cadastro_local' | 'api_velotax_created';

function clienteDadosHasEmail(dados: IClienteDados | null | undefined): boolean {
  return (dados?.clienteEmail?.lista ?? []).some((item) => String(item ?? '').trim().length > 0);
}

function clienteDadosHasPhone(dados: IClienteDados | null | undefined): boolean {
  return (dados?.clienteTelefone?.lista ?? []).some(
    (item) => normalizePhoneDigits(item).length >= 8,
  );
}

function isOverviewCustomerFound(overview: ConsultaSnapshotResult): boolean {
  return overview.ok === true
    && overview.data != null
    && overview.status !== 'customer_not_found';
}

export function mapOverviewToClienteDados(
  overviewData: Record<string, unknown>,
  cpfFallback: string,
): IClienteDados {
  const cpf = normalizeCpf(overviewData.cpf) || cpfFallback;
  const nome = String(overviewData.name ?? '').trim();
  const emailRaw = normalizeEmail(overviewData.email);
  const phoneRaw = normalizeBrPhoneLocal(overviewData.phone);
  const emailList = emailRaw ? [emailRaw] : [];
  const phoneList = phoneRaw ? [phoneRaw] : [];
  const produtosContratados = extractContractedProductSlugs(
    overviewData.products as Record<string, boolean> | null | undefined,
  );

  return {
    clienteCpf: cpf,
    clienteNome: nome,
    clienteEmail: {
      lista: emailList,
      ...(emailList.length === 1 ? { resposta: emailList[0] } : {}),
    },
    clienteTelefone: {
      lista: phoneList,
      whatsapp: phoneList.length === 1 ? phoneList[0] : '',
    },
    produtosContratados,
  };
}

/**
 * Reconsulta a Customer Data API para manter o cadastro em dia:
 * preenche e-mail/telefone/nome só se estiverem ausentes, mas SEMPRE atualiza
 * `produtosContratados` — inclusive quando o contato já está completo — para
 * o badge de produtos do painel superior refletir a contratação mais recente.
 */
export async function enrichClienteContactFromApiIfNeeded(
  cliente: ICliente,
  cpfRaw: unknown,
  protocolo = 'lookup',
): Promise<{ cliente: ICliente; enriched: boolean }> {
  const cpf = normalizeCpf(cpfRaw);
  if (!cpf) return { cliente, enriched: false };

  const dados = getPrimaryDados(cliente);
  if (!dados) return { cliente, enriched: false };

  const hasEmail = clienteDadosHasEmail(dados);
  const hasPhone = clienteDadosHasPhone(dados);

  if (!isCustomerDataApiConfigured()) return { cliente, enriched: false };

  try {
    const overview = await fetchOverview(cpf, protocolo);
    if (!isOverviewCustomerFound(overview)) return { cliente, enriched: false };

    const fromApi = mapOverviewToClienteDados(
      (overview.data || {}) as Record<string, unknown>,
      cpf,
    );

    let changed = false;

    if (!hasEmail && fromApi.clienteEmail.lista.length > 0) {
      dados.clienteEmail = {
        lista: fromApi.clienteEmail.lista,
        ...(fromApi.clienteEmail.lista.length === 1
          ? { resposta: fromApi.clienteEmail.lista[0] }
          : {}),
      };
      changed = true;
    }

    if (!hasPhone && fromApi.clienteTelefone.lista.length > 0) {
      dados.clienteTelefone = {
        lista: fromApi.clienteTelefone.lista,
        whatsapp: fromApi.clienteTelefone.lista.length === 1
          ? fromApi.clienteTelefone.lista[0]
          : '',
      };
      changed = true;
    }

    if (!String(dados.clienteNome ?? '').trim() && fromApi.clienteNome) {
      dados.clienteNome = fromApi.clienteNome;
      changed = true;
    }

    const currentProdutos = dados.produtosContratados ?? [];
    const fromApiProdutos = fromApi.produtosContratados ?? [];
    const produtosDiffer = currentProdutos.length !== fromApiProdutos.length
      || fromApiProdutos.some((slug) => !currentProdutos.includes(slug));
    if (produtosDiffer) {
      dados.produtosContratados = fromApiProdutos;
      changed = true;
    }

    if (changed) {
      await cliente.save();
      console.info(
        '[cliente] cadastro enriquecido cpf=***%s email=%s tel=%s',
        cpf.slice(-4),
        !hasEmail && fromApi.clienteEmail.lista.length > 0 ? 'sim' : 'nao',
        !hasPhone && fromApi.clienteTelefone.lista.length > 0 ? 'sim' : 'nao',
      );
    }

    return { cliente, enriched: changed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cliente] enriquecimento API cpf=***${cpf.slice(-4)} falhou:`, message);
    return { cliente, enriched: false };
  }
}

export async function findOrCreateClienteFromCpfLookup(
  cpfRaw: unknown,
  hydrateFromApi = true,
): Promise<{ cliente: ICliente | null; source?: ClienteLookupSource }> {
  const cpf = normalizeCpf(cpfRaw);
  if (!cpf) return { cliente: null };

  const existing = await findClienteByCpf(cpf);
  if (existing) {
    if (hydrateFromApi) {
      const { cliente: enriched } = await enrichClienteContactFromApiIfNeeded(existing, cpf, 'lookup');
      return { cliente: enriched, source: 'cadastro_local' };
    }
    return { cliente: existing, source: 'cadastro_local' };
  }

  if (!hydrateFromApi || !isCustomerDataApiConfigured()) {
    return { cliente: null };
  }

  try {
    const overview = await fetchOverview(cpf, 'lookup');
    if (!isOverviewCustomerFound(overview)) {
      return { cliente: null };
    }

    const dados = mapOverviewToClienteDados(
      (overview.data || {}) as Record<string, unknown>,
      cpf,
    );

    const raced = await findClienteByCpf(cpf);
    if (raced) {
      const { cliente: enriched } = await enrichClienteContactFromApiIfNeeded(raced, cpf, 'lookup');
      return { cliente: enriched, source: 'cadastro_local' };
    }

    const Cliente = getClienteModel();
    const created = await Cliente.create({
      clienteDados: [{
        clienteCpf: cpf,
        clienteNome: dados.clienteNome,
        clienteEmail: dados.clienteEmail,
        clienteTelefone: dados.clienteTelefone,
        produtosContratados: dados.produtosContratados,
      }],
      atendimentoHistorico: [],
    });

    return { cliente: created, source: 'api_velotax_created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cliente] lookup API fallback cpf=***${cpf.slice(-4)} falhou:`, message);
    return { cliente: null };
  }
}

function normalizePhoneDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export async function findClienteByPhone(phoneRaw: unknown): Promise<ICliente | null> {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone || phone.length < 8) return null;
  const Cliente = getClienteModel();
  const suffix = phone.slice(-8);
  return Cliente.findOne({
    $or: [
      { 'clienteDados.clienteTelefone.lista': phone },
      { 'clienteDados.clienteTelefone.lista': { $regex: new RegExp(`${suffix}$`) } },
      { 'clienteDados.clienteTelefone.whatsapp': phone },
    ],
  });
}

export async function findClienteByEmail(emailRaw: unknown): Promise<ICliente | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const Cliente = getClienteModel();
  const exact = await Cliente.findOne({ 'clienteDados.clienteEmail.lista': email });
  if (exact) return exact;

  return Cliente.findOne({
    'clienteDados.clienteEmail.lista': { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
  });
}

export async function resolveClienteRefFromEmail(
  emailRaw: unknown,
  displayName?: string
): Promise<IClienteRef | null> {
  const parsed = parseEmailAddress(emailRaw);
  const email = parsed.email;
  if (!email) return null;

  const cliente = await findClienteByEmail(email);
  if (!cliente) return null;

  const dados = getPrimaryDados(cliente);
  const cpf = normalizeCpf(dados?.clienteCpf);
  return {
    clienteCpf: cpf,
    clienteId: cliente._id as mongoose.Types.ObjectId,
  };
}

export async function findClienteById(id: unknown): Promise<ICliente | null> {
  const idStr = String(id ?? '').trim();
  if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) return null;
  const Cliente = getClienteModel();
  return Cliente.findById(idStr);
}

export async function loadDadosForRef(ref?: IClienteRef | null): Promise<IClienteDados | null> {
  if (!ref) return null;

  if (ref.clienteId) {
    const byId = await findClienteById(ref.clienteId);
    const dados = getPrimaryDados(byId);
    if (dados) return dados;
  }

  if (ref.clienteCpf) {
    const byCpf = await findClienteByCpf(ref.clienteCpf);
    return getPrimaryDados(byCpf);
  }

  return null;
}

export interface ClienteDadosBatchContext {
  byClienteId: Map<string, IClienteDados>;
  byCpf: Map<string, IClienteDados>;
}

export async function batchLoadDadosForRefs(
  refs: Array<IClienteRef | null | undefined>,
): Promise<ClienteDadosBatchContext> {
  const byClienteId = new Map<string, IClienteDados>();
  const byCpf = new Map<string, IClienteDados>();

  const ids = new Set<string>();
  const cpfs = new Set<string>();

  refs.forEach((ref) => {
    if (!ref) return;
    const idStr = String(ref.clienteId ?? '').trim();
    if (idStr && mongoose.Types.ObjectId.isValid(idStr)) ids.add(idStr);
    const cpf = normalizeCpf(ref.clienteCpf);
    if (cpf) cpfs.add(cpf);
  });

  const Cliente = getClienteModel();
  const [clientesById, clientesByCpf] = await Promise.all([
    ids.size
      ? Cliente.find({ _id: { $in: [...ids] } })
      : Promise.resolve([] as ICliente[]),
    cpfs.size
      ? Cliente.find({ 'clienteDados.clienteCpf': { $in: [...cpfs] } })
      : Promise.resolve([] as ICliente[]),
  ]);

  clientesById.forEach((cliente) => {
    const dados = getPrimaryDados(cliente);
    if (!dados) return;
    byClienteId.set(String(cliente._id), dados);
    const cpf = normalizeCpf(dados.clienteCpf);
    if (cpf && !byCpf.has(cpf)) byCpf.set(cpf, dados);
  });

  clientesByCpf.forEach((cliente) => {
    const dados = getPrimaryDados(cliente);
    if (!dados) return;
    const cpf = normalizeCpf(dados.clienteCpf);
    if (cpf && !byCpf.has(cpf)) byCpf.set(cpf, dados);
  });

  return { byClienteId, byCpf };
}

export function resolveDadosFromBatch(
  ref: IClienteRef | null | undefined,
  batch: ClienteDadosBatchContext,
): IClienteDados | null {
  if (!ref) return null;

  const idStr = String(ref.clienteId ?? '').trim();
  if (idStr && batch.byClienteId.has(idStr)) {
    return batch.byClienteId.get(idStr)!;
  }

  const cpf = normalizeCpf(ref.clienteCpf);
  if (cpf && batch.byCpf.has(cpf)) {
    return batch.byCpf.get(cpf)!;
  }

  return null;
}

function applyDadosToCliente(existing: ICliente, dados: IClienteDados): void {
  if (!existing.clienteDados?.length) {
    const entry: Record<string, unknown> = {
      clienteNome: dados.clienteNome,
      clienteEmail: dados.clienteEmail,
      clienteTelefone: dados.clienteTelefone,
    };
    if (dados.clienteCpf) entry.clienteCpf = dados.clienteCpf;
    existing.clienteDados = [entry as unknown as IClienteDados];
    return;
  }
  if (dados.clienteNome) existing.clienteDados[0].clienteNome = dados.clienteNome;
  if (dados.clienteCpf) existing.clienteDados[0].clienteCpf = dados.clienteCpf;
  if (dados.clienteEmail.lista.length || dados.clienteEmail.resposta) {
    existing.clienteDados[0].clienteEmail = {
      lista: dados.clienteEmail.lista.length
        ? dados.clienteEmail.lista
        : (existing.clienteDados[0].clienteEmail?.lista ?? []),
      ...(dados.clienteEmail.resposta
        ? { resposta: dados.clienteEmail.resposta }
        : {}),
    };
  }
  if (dados.clienteTelefone.lista.length) existing.clienteDados[0].clienteTelefone = dados.clienteTelefone;
}

export async function upsertClienteFromBody(body: Record<string, unknown>): Promise<ICliente | null> {
  const dados = dadosFromBody(body);
  if (!dados) return null;

  const Cliente = getClienteModel();
  const cpf = dados.clienteCpf || normalizeCpf(body.clientCPF);
  const clienteIdRaw = body.clienteId ?? (body.cliente as { clienteId?: unknown }[] | undefined)?.[0]?.clienteId;

  if (clienteIdRaw && mongoose.Types.ObjectId.isValid(String(clienteIdRaw))) {
    const byId = await findClienteById(clienteIdRaw);
    if (byId) {
      applyDadosToCliente(byId, dados);
      await byId.save();
      return byId;
    }
  }

  if (cpf) {
    const existing = await Cliente.findOne({ 'clienteDados.clienteCpf': cpf });
    if (existing) {
      applyDadosToCliente(existing, dados);
      await existing.save();
      return existing;
    }
  }

  const emails = dados.clienteEmail?.lista ?? [];
  if (!cpf && emails.length) {
    const byEmail = await findClienteByEmail(emails[0]);
    if (byEmail) {
      applyDadosToCliente(byEmail, dados);
      await byEmail.save();
      return byEmail;
    }
    return null;
  }

  if (!cpf) return null;

  const createDados: Record<string, unknown> = {
    clienteNome: dados.clienteNome,
    clienteEmail: dados.clienteEmail,
    clienteTelefone: dados.clienteTelefone,
  };
  if (cpf) createDados.clienteCpf = cpf;

  return Cliente.create({ clienteDados: [createDados], atendimentoHistorico: [] });
}

export async function resolveClienteRefFromBody(
  body: Record<string, unknown>,
  existing?: IClienteRef | null
): Promise<IClienteRef[]> {
  const lateral = (body.lateralForm ?? {}) as Record<string, unknown>;
  const cpfFromBody = normalizeCpf(body.clientCPF ?? lateral.clienteCpf ?? lateral.cpf);
  const clienteIdRaw = body.clienteId ?? (body.cliente as { clienteId?: unknown }[] | undefined)?.[0]?.clienteId;
  const cpf = cpfFromBody || normalizeCpf(existing?.clienteCpf);

  if (!cpf && !clienteIdRaw && !existing?.clienteId) return [];

  let cliente: ICliente | null = null;

  if (clienteIdRaw && mongoose.Types.ObjectId.isValid(String(clienteIdRaw))) {
    cliente = await findClienteById(clienteIdRaw);
  }

  if (!cliente && cpf) {
    cliente = await findClienteByCpf(cpf);
  }

  const hasContactData =
    body.clientName !== undefined ||
    body.clientCPF !== undefined ||
    body.clientPhone !== undefined ||
    body.clientEmail !== undefined ||
    lateral.clienteNome !== undefined ||
    lateral.cpf !== undefined ||
    lateral.clienteEmail !== undefined ||
    lateral.clienteTelefone !== undefined;

  const payloadDados = dadosFromBody(body);
  if (cliente && payloadDados) {
    applyDadosToCliente(cliente, payloadDados);
    await cliente.save();
  } else if (!cliente && cpf && hasContactData) {
    cliente = await upsertClienteFromBody(body);
  }

  if (cliente && cpf) {
    const { cliente: enriched } = await enrichClienteContactFromApiIfNeeded(cliente, cpf, 'lookup');
    cliente = enriched;
  }

  if (!cliente && !cpf) {
    const emailList = normalizeStringList(lateral.clienteEmail);
    for (const item of emailList) {
      cliente = await findClienteByEmail(item);
      if (cliente) break;
    }
  }

  const resolvedCpf = cpf || normalizeCpf(getPrimaryDados(cliente)?.clienteCpf);
  const resolvedId = cliente?._id ?? existing?.clienteId ?? null;

  if (!resolvedCpf && !resolvedId) return [];

  return [
    {
      clienteCpf: resolvedCpf,
      clienteId: resolvedId as mongoose.Types.ObjectId | null,
    },
  ];
}
