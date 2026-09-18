/**
 * db v1.1.0 — leitura direta do MongoDB para as checagens por dados
 *
 * Duas escritas, ambas de propósito único:
 *  1. Marca csat.enviado no ticket criado pelo próprio QA, para poder testar o
 *     registro da nota de ponta a ponta. Nenhuma escrita toca ticket que não
 *     seja de QA (ver `exigirTicketDeQa`).
 *  2. Grava o retrato da rodada (estadoSentinela.ts) numa coleção própria do
 *     agente (qa_sentinela_*) — nunca toca dado de cliente/ticket real.
 */
import { MongoClient, type Db, type Document, ObjectId } from 'mongodb';
import { cfg, ehEmailSeguro, TravaDeSegurancaError } from './config';

export const MARCA_QA = 'qa-velodesk';

let cliente: MongoClient | null = null;

export async function conectar(): Promise<MongoClient> {
  if (cliente) return cliente;
  if (!cfg.mongo.uri) throw new Error('MONGODB_URI ausente — checagens por dados desativadas.');
  cliente = new MongoClient(cfg.mongo.uri, { serverSelectionTimeoutMS: 20_000 });
  await cliente.connect();
  return cliente;
}

export async function desconectar() {
  if (cliente) {
    await cliente.close().catch(() => undefined);
    cliente = null;
  }
}

export const dbChamados = async (): Promise<Db> => (await conectar()).db(cfg.mongo.dbChamados);
export const dbCadastros = async (): Promise<Db> => (await conectar()).db(cfg.mongo.dbCadastros);
export const dbConfig = async (): Promise<Db> => (await conectar()).db(cfg.mongo.dbConfig);

export const colChamados = async () => (await dbChamados()).collection('chamados_n1');
export const colClientes = async () => (await dbCadastros()).collection('clientes');
export const colDisparos = async () => (await dbConfig()).collection('email_disparos_log');
export const colConteudos = async () => (await dbConfig()).collection('email_conteudos');
export const colTransporte = async () => (await dbConfig()).collection('email_transport');
export const colContadores = async () => (await dbChamados()).collection('sequence_counters');

// ── Sentinela Velodesk (dashboard) — coleção própria, nunca toca dado real ──
// _id é string própria (ex.: "atual", ou o runId) nessas duas coleções, não o
// ObjectId padrão do Mongo — daí o generic explícito.
export const colQaSentinelaEstado = async () =>
  (await dbConfig()).collection<Document & { _id: string }>('qa_sentinela_estado');
export const colQaSentinelaRuns = async () =>
  (await dbConfig()).collection<Document & { _id: string }>('qa_sentinela_runs');

// ── filtros reaproveitados do backend ──────────────────────────────────────

/** Status corrente = status do último item de registro[]. */
export const filtroStatusAtual = (status: string): Document => ({
  $expr: { $eq: [{ $arrayElemAt: ['$registro.status', -1] }, status] },
});

export const filtroStatusAtualEm = (statuses: string[]): Document => ({
  $expr: { $in: [{ $arrayElemAt: ['$registro.status', -1] }, statuses] },
});

/** Tickets criados pelo agente de QA (marca gravada em registro[].metadados). */
export const filtroQa = (): Document => ({
  registro: { $elemMatch: { 'metadados.inboundTicketMetadata.origemQa': MARCA_QA } },
});

/**
 * Repete uma leitura no Mongo até a condição bater, ou desiste depois de
 * `tentativas`. Existe porque o agente lê o banco por uma conexão separada da
 * do backend — a escrita já foi confirmada (`await save()`) antes da API
 * responder sucesso, mas no cluster compartilhado pode levar uma fração de
 * segundo pra ficar visível numa leitura vinda de outro lugar. Sem isso, o
 * agente reportava falso negativo (ação correta, só lida cedo demais) em
 * qualquer checagem no formato "chama a API, depois confere no banco".
 */
export async function buscarComRetry<T>(
  buscar: () => Promise<T>,
  condicaoOk: (valor: T) => boolean,
  tentativas = 4,
  intervaloMs = 400,
): Promise<T> {
  let valor: T;
  for (let i = 0; i < tentativas; i += 1) {
    valor = await buscar();
    if (condicaoOk(valor)) return valor;
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return valor!;
}

/**
 * Trava: só devolve o ticket se ele foi criado pelo QA. Qualquer escrita passa
 * por aqui — é o que impede o agente de mexer em ticket de cliente real.
 */
export async function exigirTicketDeQa(ticketId: string): Promise<Document> {
  const col = await colChamados();
  const doc = await buscarComRetry(
    () => col.findOne({ _id: new ObjectId(ticketId) }),
    (d) => Boolean(d),
  );
  if (!doc) throw new TravaDeSegurancaError(`Ticket ${ticketId} não encontrado.`);
  const ehQa = (doc.registro ?? []).some(
    (r: any) => r?.metadados?.inboundTicketMetadata?.origemQa === MARCA_QA,
  );
  if (!ehQa) {
    throw new TravaDeSegurancaError(
      `Ticket ${ticketId} não é de QA. O agente não escreve em ticket de cliente real.`,
    );
  }
  return doc;
}

/** Marca csat.enviado no ticket de QA para permitir testar o registro da nota. */
export async function prepararCsatDoTicketQa(ticketId: string): Promise<void> {
  await exigirTicketDeQa(ticketId);
  const col = await colChamados();
  await col.updateOne(
    { _id: new ObjectId(ticketId) },
    {
      $set: {
        csat: {
          enviado: true,
          enviadoEm: new Date(),
          nota: null,
          comentario: '',
          respondido: false,
          respondidoEm: null,
          repescagemEnviada: false,
          repescagemEnviadaEm: null,
        },
      },
    },
  );
}

/**
 * Garante um cadastro de cliente de QA apontando apenas para e-mail seguro.
 * Se o CPF já existir com e-mail fora da lista, aborta em vez de sobrescrever.
 */
export async function garantirClienteQa(cpf: string, email: string, nome: string): Promise<void> {
  if (!ehEmailSeguro(email)) {
    throw new TravaDeSegurancaError(`E-mail de cliente de QA fora da lista segura: ${email}`);
  }
  const col = await colClientes();
  const existente = await col.findOne({ 'clienteDados.clienteCpf': cpf });
  if (existente) {
    const dados = (existente.clienteDados ?? []).find((d: any) => d?.clienteCpf === cpf);
    const emails: string[] = dados?.clienteEmail?.lista ?? [];
    const forasDaLista = emails.filter((e) => !ehEmailSeguro(e));
    if (forasDaLista.length) {
      throw new TravaDeSegurancaError(
        `O CPF de QA ${cpf} já existe no cadastro com e-mail fora da lista segura ` +
          `(${forasDaLista.join(', ')}). Troque QA_CLIENT_CPF ou corrija o cadastro.`,
      );
    }
    if (emails.includes(email)) return;
    await col.updateOne(
      { 'clienteDados.clienteCpf': cpf },
      {
        $set: {
          'clienteDados.$.clienteEmail.lista': [email],
          'clienteDados.$.clienteEmail.resposta': email,
        },
      },
    );
    return;
  }
  await col.insertOne({
    clienteDados: [
      {
        clienteCpf: cpf,
        clienteNome: nome,
        clienteEmail: { lista: [email], resposta: email },
        clienteTelefone: { lista: [], whatsapp: '' },
        produtosContratados: [],
      },
    ],
    criadoPor: MARCA_QA,
    createdAt: new Date(),
  });
}

export interface AmostraEmailReal {
  protocolo: string;
  /** Nome do modelo que disparou (emailPadraoNome), quando houver. */
  modelo: string;
  /** Texto composto (saudação + corpo) que foi de fato enviado. */
  texto: string;
  /** CPF do cliente — usado só para localizar o nome a redigir, nunca sai desta função. */
  cpfParaRedigir: string;
}

/**
 * Amostra recente de e-mails automáticos que saíram para CLIENTE REAL (nunca
 * ticket de QA — filtroQa() é excluído explicitamente). Usada pelo caso E08
 * para conferir o texto que de fato chegou ao cliente, não só o modelo
 * cadastrado. O nome do cliente é resolvido aqui só para o chamador poder
 * redigir (trocar por "[cliente]") antes de mandar para a IA — esta função
 * não decide o que sai para fora, só devolve o material bruto.
 */
export async function amostraEmailsReais(limite = 5): Promise<AmostraEmailReal[]> {
  const col = await colChamados();
  const filtroEmailAutomatico: Document = {
    registro: {
      $elemMatch: {
        $or: [{ 'metadados.emailPadraoId': { $exists: true } }, { 'metadados.emailOutboundMessageId': { $exists: true } }],
      },
    },
  };
  const docs = await col
    .find({ $and: [filtroEmailAutomatico, { $nor: [filtroQa()] }] })
    .project({ chamadoProtocolo: 1, registro: 1, cliente: 1 })
    .sort({ updatedAt: -1 })
    .limit(limite)
    .toArray();

  const amostras: AmostraEmailReal[] = [];
  for (const doc of docs) {
    const registros: any[] = doc.registro ?? [];
    const envio = [...registros].reverse().find((r) => r?.metadados?.emailPadraoId || r?.metadados?.emailOutboundMessageId);
    const texto = String(envio?.mensagemPublica ?? '').trim();
    if (!texto) continue;
    amostras.push({
      protocolo: String(doc.chamadoProtocolo ?? ''),
      modelo: String(envio?.metadados?.emailPadraoNome ?? 'resposta de agente'),
      texto,
      cpfParaRedigir: String(doc.cliente?.[0]?.clienteCpf ?? ''),
    });
  }
  return amostras;
}

/** Nome do cliente para um CPF — só para o chamador redigir antes de mandar texto para fora. */
export async function nomeClienteParaRedigir(cpf: string): Promise<string> {
  if (!cpf) return '';
  const col = await colClientes();
  const doc = await col.findOne({ 'clienteDados.clienteCpf': cpf });
  const dados = (doc?.clienteDados ?? []).find((d: any) => d?.clienteCpf === cpf);
  return String(dados?.clienteNome ?? '').trim();
}

export { ObjectId };
