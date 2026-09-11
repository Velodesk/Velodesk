/** seed.service v1.10.1 — remove regex de purge não-ancorada que podia apagar dados reais (ex.: cliente real "Maria Silva") */
import { ChamadoN1 } from '../models/ChamadoN1';
import { getClienteModel } from '../models/Cliente';
import { getTabulacaoProdutoModel } from '../models/TabulacaoProduto';
import { getDeskFuncaoPermissaoModel } from '../models/DeskFuncaoPermissao';
import { invalidateTabulationCache } from './tabulation.service';
import { ensureOrgaoMotivoCategorias } from './tabulationOpcoes.service';
import { seedFuncoesPermissoes, invalidateFuncaoPermissaoCache } from './funcaoPermissao.service';
import { migrateGrupoToFuncao } from './migrateGrupoToFuncao.service';
import { env } from '../config/env';

const WORKFLOW_TEST_PROTOCOL_PREFIX = 'WF-TEST-';

const DEMO_CPFS = ['12345678901', '11122233300'];

const TEST_CLIENT_CPFS = [
  '90100000001', '90100000002', '90100000003', '90100000004', '90100000005',
  '90100000006', '90100000007', '90100000008', '90100000009',
];

const ALL_DEMO_CPFS = [...DEMO_CPFS, ...TEST_CLIENT_CPFS];

/** Remove tickets e clientes mock (legado + WF-TEST + [TESTE]) */
export async function purgeAllMockTickets(): Promise<{ tickets: number; clients: number }> {
  const ticketFilter = {
    $or: [
      { chamadoProtocolo: { $regex: `^${WORKFLOW_TEST_PROTOCOL_PREFIX}` } },
      { chamadoTitulo: { $regex: /^\[TESTE\]/i } },
      { 'cliente.clienteCpf': { $in: ALL_DEMO_CPFS } },
      { 'registro.metadados.seedSource': 'workflow-test-seed' },
    ],
  };

  const tickets = await ChamadoN1.deleteMany(ticketFilter);

  const Cliente = getClienteModel();
  const clients = await Cliente.deleteMany({
    $or: [
      { 'clienteDados.clienteCpf': { $in: ALL_DEMO_CPFS } },
      { 'clienteDados.clienteEmail.lista': { $regex: /@email-teste\.com$/i } },
    ],
  });

  console.log(
    `Purge mock tickets: chamados removidos=${tickets.deletedCount ?? 0}, clientes removidos=${clients.deletedCount ?? 0}`,
  );

  return {
    tickets: tickets.deletedCount ?? 0,
    clients: clients.deletedCount ?? 0,
  };
}

/** @deprecated use purgeAllMockTickets */
export async function purgeLegacyDemoData() {
  await purgeAllMockTickets();
}

/** Remove permissões legadas do mecanismo experimental escalonar */
async function purgeLegacyEscalonarPermissao(): Promise<void> {
  const Model = getDeskFuncaoPermissaoModel();
  const result = await Model.updateMany(
    {
      $or: [
        { 'permissoes.workspace.escalonar': { $exists: true } },
        { 'permissoes.tickets.escalonar': { $exists: true } },
      ],
    },
    {
      $unset: {
        'permissoes.workspace.escalonar': '',
        'permissoes.tickets.escalonar': '',
      },
    },
  );
  if (result.modifiedCount) {
    invalidateFuncaoPermissaoCache();
    console.log(`Purge: permissão escalonar removida de ${result.modifiedCount} função(ões)`);
  }
}

export async function runDeskConfigMigrations(): Promise<void> {
  await purgeLegacyEscalonarPermissao();
  await migrateGrupoToFuncao();
  // seedFuncoesPermissoes() é no-op se já existem funções (não recria seed), mas roda os
  // backfills de permissão (preferencias.visualizar, tickets.atuar_sempre) — precisa
  // rodar em prod também, não só em dev via seedDevelopmentData().
  await seedFuncoesPermissoes();
  const { seedEmailConteudosIfEmpty, seedCsatEmailConteudosIfMissing } = await import('./emailConteudo.service');
  await seedEmailConteudosIfEmpty();
  await seedCsatEmailConteudosIfMissing();
}

export async function seedDevelopmentData() {
  if (env.nodeEnv !== 'development') return;

  await seedTabulationConfig();
  await seedFuncoesPermissoes();
  await runDeskConfigMigrations();
}

async function seedTabulationConfig() {
  const Produto = getTabulacaoProdutoModel();
  const produtoCount = await Produto.countDocuments();
  if (produtoCount === 0) {
    console.log('Seed: nenhum produto de tabulação — configure em Configurações > Tabulação');
  }

  await ensureOrgaoMotivoCategorias();
  invalidateTabulationCache();
}
