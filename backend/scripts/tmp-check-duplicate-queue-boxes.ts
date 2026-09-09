/**
 * tmp-check-duplicate-queue-boxes v1.0.0
 * Investiga caixas personalizadas (desk_agent_boxex) que aparecem sob mais de um
 * e-mail com o mesmo conteúdo — sintoma do bug de auto-migração que "compartilhava"
 * caixas entre agentes num navegador comum. Apenas leitura, não apaga nada.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getDeskAgentQueueBoxModel } from '../src/models/DeskAgentQueueBox';

function criteriosFingerprint(criterios: any[]): string {
  return JSON.stringify(
    (criterios || [])
      .map((c) => ({
        tipo: c.tipo,
        campo: c.campo || '',
        operador: c.operador || 'equals',
        valores: [...(c.valores?.length ? c.valores : [c.valor])].map(String).sort(),
      }))
      .sort((a, b) => (a.tipo + a.campo).localeCompare(b.tipo + b.campo)),
  );
}

async function main() {
  await connectDatabase();
  const Model = getDeskAgentQueueBoxModel();

  const docs = await Model.find({}).sort({ name: 1, createdAt: 1 }).lean();
  console.log(`Total de caixas personalizadas: ${docs.length}`);

  // Agrupa por "conteúdo" (nome + critérios), não por boxId — boxId embute
  // timestamp e não repete entre migrações, mas nome+critérios sim.
  const groups = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = `${String(doc.name || '').trim().toLowerCase()}::${criteriosFingerprint(doc.criterios || [])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }

  const suspects = [...groups.entries()].filter(([, list]) => {
    const emails = new Set(list.map((d) => d.email));
    return emails.size > 1;
  });

  if (!suspects.length) {
    console.log('\nNenhuma caixa com o mesmo nome/critérios em e-mails diferentes encontrada.');
  } else {
    console.log(`\n${suspects.length} grupo(s) de caixa(s) duplicada(s) entre usuários diferentes:\n`);
    for (const [key, list] of suspects) {
      const [name] = key.split('::');
      console.log(`— "${name}" (${list.length} cópias):`);
      for (const doc of list.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) {
        console.log(
          `    email=${doc.email}  boxId=${doc.boxId}  criado em=${new Date(doc.createdAt).toISOString()}`,
        );
      }
      console.log('');
    }
    console.log(
      'Para cada grupo, a cópia com a data de criação MAIS ANTIGA costuma ser a original;',
      'as demais provavelmente vieram da auto-migração indevida e são candidatas a remoção manual.',
    );
  }

  // Também lista boxIds duplicados (mesmo boxId em e-mails diferentes) — não deveria
  // acontecer dado o índice único {email, boxId}, mas serve de checagem de sanidade.
  const byBoxId = new Map<string, typeof docs>();
  for (const doc of docs) {
    if (!byBoxId.has(doc.boxId)) byBoxId.set(doc.boxId, []);
    byBoxId.get(doc.boxId)!.push(doc);
  }
  const boxIdCollisions = [...byBoxId.entries()].filter(([, list]) => list.length > 1);
  if (boxIdCollisions.length) {
    console.log(`\nAtenção: ${boxIdCollisions.length} boxId(s) repetido(s) entre e-mails diferentes:`);
    for (const [boxId, list] of boxIdCollisions) {
      console.log(`  boxId=${boxId} -> emails: ${list.map((d) => d.email).join(', ')}`);
    }
  }

  await disconnectDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDatabase();
  process.exit(1);
});
