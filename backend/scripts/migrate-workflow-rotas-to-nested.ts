/**
 * migrate-workflow-rotas-to-nested.ts v1.0.0
 * Converte workflows do formato antigo (lista única de `passos[]` com
 * `rota.proximoPassoId`/`acao.proximoPassoId` apontando pra outro item da
 * mesma lista) para bifurcação real em árvore (`rota.passos[]` aninhado,
 * sem ponteiros). Ver plano de bifurcação do Workflow.
 *
 * Percorre o grafo atual a partir do primeiro passo (ordem 0): cada etapa de
 * aprovação vira o início de duas sub-listas (approve/reject), que continuam
 * sendo preenchidas seguindo os mesmos sucessores (explícitos ou implícitos
 * por `ordem`) recursivamente. Se uma aresta apontar pra um nó já visitado em
 * outro lugar da árvore (convergência/ciclo — não representável como árvore),
 * corta ali e sinaliza o workflow inteiro como "requer revisão manual" no
 * relatório final, sem tentar adivinhar. Nós nunca alcançados (órfãos) também
 * entram no relatório.
 *
 * Uso: npm run migrate:workflow-rotas
 * Dry-run (só mostra o relatório, não grava): npm run migrate:workflow-rotas -- --dry-run
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getWorkflowDefinicaoModel } from '../src/models/WorkflowDefinicao';

type AnyPasso = {
  _id: unknown;
  ordem: number;
  passo: {
    nome?: string;
    acao?: {
      tipo?: string;
      rotas?: Array<{
        _id?: unknown;
        variavel: string;
        rotulo: string;
        proximoPassoId?: unknown;
        statusTicket?: unknown;
      }>;
      proximoPassoId?: unknown;
      automatica?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

interface MigrationIssue {
  workflowSlug: string;
  message: string;
}

function sortByOrdem(passos: AnyPasso[]): AnyPasso[] {
  return [...passos].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

function successorIdFor(node: AnyPasso, sortedRoot: AnyPasso[]): unknown {
  const explicit = node.passo?.acao?.proximoPassoId;
  if (explicit) return explicit;
  const idx = sortedRoot.findIndex((p) => String(p._id) === String(node._id));
  return idx >= 0 ? (sortedRoot[idx + 1]?._id ?? null) : null;
}

function walkChain(
  startId: unknown,
  visited: Set<string>,
  byId: Map<string, AnyPasso>,
  sortedRoot: AnyPasso[],
  slug: string,
  issues: MigrationIssue[],
): AnyPasso[] {
  const result: AnyPasso[] = [];
  let currentId = startId;

  while (currentId) {
    const key = String(currentId);
    if (visited.has(key)) {
      const nome = byId.get(key)?.passo?.nome || key;
      issues.push({
        workflowSlug: slug,
        message: `Etapa "${nome}" é alcançada por mais de um caminho (convergência/ciclo) — cortada aqui, requer revisão manual.`,
      });
      break;
    }

    const legacy = byId.get(key);
    if (!legacy) {
      issues.push({
        workflowSlug: slug,
        message: `Referência a uma etapa que não existe mais (id ${key}) — ignorada.`,
      });
      break;
    }

    visited.add(key);

    if (legacy.passo?.acao?.tipo === 'aprovacao') {
      const rotas = buildRotas(legacy, visited, byId, sortedRoot, slug, issues);
      result.push({
        _id: legacy._id,
        ordem: result.length,
        passo: {
          ...legacy.passo,
          acao: { tipo: 'aprovacao', rotas },
        },
      });
      // Etapa de aprovação sempre termina a cadeia linear atual — a
      // continuação vem de dentro das rotas (approve/reject), não daqui.
      break;
    }

    result.push({
      _id: legacy._id,
      ordem: result.length,
      passo: {
        ...legacy.passo,
        acao: {
          tipo: legacy.passo?.acao?.tipo || 'manual',
          rotas: [],
          automatica: legacy.passo?.acao?.automatica,
        },
      },
    });
    currentId = successorIdFor(legacy, sortedRoot);
  }

  return result;
}

function buildRotas(
  node: AnyPasso,
  visited: Set<string>,
  byId: Map<string, AnyPasso>,
  sortedRoot: AnyPasso[],
  slug: string,
  issues: MigrationIssue[],
) {
  const rotasSrc = node.passo?.acao?.rotas || [];
  return rotasSrc.map((rota) => {
    let nestedPassos: AnyPasso[] = [];
    if (rota.variavel === 'approve' || rota.variavel === 'reject') {
      let succ = rota.proximoPassoId || null;
      if (!succ && rota.variavel === 'approve') {
        // Approve sem destino explícito, no modelo antigo, caía implicitamente
        // na próxima posição do array — preserva esse comportamento migrando
        // esses passos pra dentro do ramo "Aprovar".
        succ = successorIdFor(node, sortedRoot);
      }
      if (succ) {
        nestedPassos = walkChain(succ, visited, byId, sortedRoot, slug, issues);
      }
    }
    return {
      _id: rota._id,
      variavel: rota.variavel,
      rotulo: rota.rotulo,
      statusTicket: rota.statusTicket ?? null,
      passos: nestedPassos,
    };
  });
}

async function migrateWorkflow(doc: { slug: string; passos: AnyPasso[] }, issues: MigrationIssue[]): Promise<AnyPasso[] | null> {
  const sortedRoot = sortByOrdem(doc.passos || []);
  if (!sortedRoot.length) return [];

  const byId = new Map(sortedRoot.map((p) => [String(p._id), p]));
  const visited = new Set<string>();

  const newRoot = walkChain(sortedRoot[0]._id, visited, byId, sortedRoot, doc.slug, issues);

  const orphans = sortedRoot.filter((p) => !visited.has(String(p._id)));
  orphans.forEach((p) => {
    issues.push({
      workflowSlug: doc.slug,
      message: `Etapa "${p.passo?.nome || String(p._id)}" nunca é alcançada a partir do início do workflow (órfã) — não migrada automaticamente.`,
    });
  });

  return newRoot;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('--- Migração: rotas de Workflow (proximoPassoId → passos aninhados) ---');
  console.log(`Modo: ${dryRun ? 'dry-run (sem gravar)' : 'execução'}`);

  await connectDatabase();

  const Model = getWorkflowDefinicaoModel();
  const docs = await Model.find({}).lean<Array<{ _id: unknown; slug: string; passos: AnyPasso[] }>>();

  console.log(`\n${docs.length} workflow(s) encontrado(s).\n`);

  const issues: MigrationIssue[] = [];
  const results: Array<{ slug: string; ok: boolean }> = [];

  for (const doc of docs) {
    const docIssuesBefore = issues.length;
    const newPassos = await migrateWorkflow(doc, issues);
    const hasIssues = issues.length > docIssuesBefore;
    results.push({ slug: doc.slug, ok: !hasIssues });

    if (newPassos === null) continue;

    console.log(`• ${doc.slug}: ${hasIssues ? 'migrado com ressalvas (ver relatório)' : 'migrado limpo'}`);

    if (!dryRun) {
      await Model.updateOne({ _id: doc._id }, { $set: { passos: newPassos } });
    }
  }

  console.log('\n--- Relatório ---');
  if (!issues.length) {
    console.log('Nenhuma ressalva. Todos os workflows migraram limpos.');
  } else {
    const bySlug = new Map<string, string[]>();
    issues.forEach((issue) => {
      if (!bySlug.has(issue.workflowSlug)) bySlug.set(issue.workflowSlug, []);
      bySlug.get(issue.workflowSlug)!.push(issue.message);
    });
    bySlug.forEach((messages, slug) => {
      console.log(`\n⚠ ${slug}:`);
      messages.forEach((m) => console.log(`  - ${m}`));
    });
    console.log('\nRevise manualmente os workflows acima na tela de configuração (os ramos afetados podem precisar de etapas recriadas nos cards Aprovar/Reprovar).');
  }

  if (dryRun) {
    console.log('\n[dry-run] Nenhuma alteração gravada. Rode sem --dry-run para aplicar.');
  } else {
    console.log('\nMigração concluída.');
  }

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('Falha na migração:', err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
