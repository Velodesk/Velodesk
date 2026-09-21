/**
 * octadesk-dump-transform.ts v1.0.0
 * Passada D — legado_tickets.importados_octadesk → cluster dedicado
 * (módulo "Legado Octa"). Sem tradução/mapeamento de enum/taxonomia: grava
 * o ticket "quase-cru", exatamente com os campos definidos no plano de
 * migração (ver C:\Users\lucas\.claude\plans\agora-vamos-abordar-uma-iridescent-lake.md).
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-transform.ts
 *   npx tsx scripts/octadesk-dump-transform.ts --max=50
 *   npx tsx scripts/octadesk-dump-transform.ts --reset-checkpoint
 */
import {
  connectLegadoTickets,
  disconnectLegadoTickets,
  getCheckpoint,
  setCheckpoint,
  importadosCol,
  parseArg,
  hasFlag,
  type ImportadoAttachment,
  type ImportadoOctadeskDoc,
} from './lib/octadeskDumpShared';
import { toProtocoloDesk } from '../src/utils/octadeskProtocolo';
import { connectLegacyOcta, disconnectLegacyOcta } from '../src/config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../src/models/TicketLegadoOcta';

const PASS = 'passD-transform';
const BATCH_SIZE = 200;

/** CPF real e estável do solicitante — vive no CustomField do ticket, nunca em propertiesChanges. */
const CPF_CUSTOM_FIELD_KEY = 'cpf_do_titular';

/**
 * "Categoria de assunto" e "assunto" (topicGroupName/topicName) — confirmado contra a API
 * real que eles NÃO existem no ticket em si: só aparecem dentro de propertiesChanges de
 * interações específicas (changelog), com grafia de chave inconsistente ao longo do tempo.
 * Por isso são varridos com os mesmos candidatos usados no dump de referência.
 */
const TOPIC_GROUP_KEY_CANDIDATES = ['topicgroupname', 'categoria de assunto', 'categoria_de_assunto'];
const TOPIC_NAME_KEY_CANDIDATES = ['topicname', 'assunto'];

function attachmentKeyOf(a: { octadeskId?: string; source?: string; interactionId?: string; originUrl?: string }): string {
  return a.octadeskId || `${a.source || ''}|${a.interactionId || ''}|${a.originUrl || ''}`;
}

/**
 * ticket.customField chega da API real como array [{key, value}], não como objeto — só
 * chaves com valor preenchido (!= null, != "") entram, por decisão do usuário (evita ruído
 * de campos de outros formulários que não se aplicam a este ticket).
 */
function filledCustomFields(customField: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const list = Array.isArray(customField) ? customField : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, value } = entry as { key?: unknown; value?: unknown };
    if (key == null || String(key).trim() === '') continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[String(key)] = value;
  }
  return out;
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/** Varre propertiesChanges de todas as interações (ordem cronológica) e devolve o valor mais recente da 1ª chave candidata encontrada. */
function latestPropertyChangeValue(
  rawInteractions: unknown[],
  keyCandidates: string[],
): string {
  const ordered = (Array.isArray(rawInteractions) ? rawInteractions : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .slice()
    .sort((a, b) => {
      const da = new Date(String(a.dateCreation ?? a.createdAt ?? '')).getTime() || 0;
      const db = new Date(String(b.dateCreation ?? b.createdAt ?? '')).getTime() || 0;
      return da - db;
    });

  let found = '';
  for (const interaction of ordered) {
    const changes = (interaction.propertiesChanges && typeof interaction.propertiesChanges === 'object'
      ? interaction.propertiesChanges as Record<string, unknown>
      : {});
    for (const [key, value] of Object.entries(changes)) {
      if (!keyCandidates.includes(key.trim().toLowerCase())) continue;
      if (value === null || value === undefined) continue;
      const str = String(value).trim();
      if (str) found = str;
    }
  }
  return found;
}

function parseDateSafe(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildInteractions(
  ticket: Record<string, unknown>,
  rawInteractions: unknown[],
  okAttachmentsByKey: Map<string, ImportadoAttachment>,
) {
  const interactions = (Array.isArray(rawInteractions) ? rawInteractions : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((interaction) => {
      const interactionId = String(
        (interaction._id as string) || (interaction.id as string) || '',
      );
      // Autor da interação: API real usa "user" (não "person" do Swagger v1).
      const person = (interaction.user && typeof interaction.user === 'object'
        ? interaction.user
        : {}) as Record<string, unknown>;
      const comments = (Array.isArray(interaction.comments) ? interaction.comments : [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          // contentHtml não é gravado — texto plano basta para o painel somente-leitura,
          // e cortar HTML reduz ~27% do tamanho do documento (medido nos dados reais).
          content: String(c.content ?? ''),
          isPublic: toBool(c.isPublic), // vem boolean ou string "true"/"false" dependendo do endpoint
        }));

      const rawAttachments = Array.isArray(interaction.attachments) ? interaction.attachments : [];
      const attachments = rawAttachments
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => {
          const key = attachmentKeyOf({
            octadeskId: a.id != null ? String(a.id) : a._id != null ? String(a._id) : undefined,
            source: 'interaction',
            interactionId,
            originUrl: String(a.url || '').trim(),
          });
          const processed = okAttachmentsByKey.get(key);
          if (!processed || processed.status !== 'ok' || !processed.url) return null;
          return { name: processed.name || String(a.name || 'anexo'), url: processed.url };
        })
        .filter((a): a is { name: string; url: string } => a !== null);

      return {
        // API real usa "createdAt" na interação (dateCreation só aparece no dump de referência/legado)
        dateCreation: parseDateSafe(interaction.createdAt ?? interaction.dateCreation) || new Date(0),
        personName: String(person.name ?? ''),
        personEmail: String(person.email ?? ''),
        comments,
        attachments,
        propertiesChanges: (interaction.propertiesChanges && typeof interaction.propertiesChanges === 'object'
          ? (interaction.propertiesChanges as Record<string, unknown>)
          : {}),
      };
    });

  // Anexos anexados direto no ticket (antes da 1ª interação) — ex. comprovante enviado na abertura via
  // e-mail. Sem interação própria no Octadesk, então entram na primeira interação por falta de melhor lugar.
  const ticketLevelAttachments = (Array.isArray(ticket.attachments) ? ticket.attachments : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => {
      const key = attachmentKeyOf({
        octadeskId: a.id != null ? String(a.id) : a._id != null ? String(a._id) : undefined,
        source: 'ticket',
        originUrl: String(a.url || '').trim(),
      });
      const processed = okAttachmentsByKey.get(key);
      if (!processed || processed.status !== 'ok' || !processed.url) return null;
      return { name: processed.name || String(a.name || 'anexo'), url: processed.url };
    })
    .filter((a): a is { name: string; url: string } => a !== null);

  if (ticketLevelAttachments.length) {
    if (interactions.length) {
      interactions[0].attachments = [...interactions[0].attachments, ...ticketLevelAttachments];
    } else {
      const requester = (ticket.requester && typeof ticket.requester === 'object' ? ticket.requester : {}) as Record<string, unknown>;
      interactions.push({
        dateCreation: parseDateSafe(ticket.createdAt) || new Date(0),
        personName: String(requester.name ?? ''),
        personEmail: String(requester.email ?? ''),
        comments: [],
        attachments: ticketLevelAttachments,
        propertiesChanges: {},
      });
    }
  }

  interactions.sort((a, b) => a.dateCreation.getTime() - b.dateCreation.getTime());
  return interactions;
}

async function main(): Promise<void> {
  const maxDocs = Number(parseArg('max') || '0') || 0;

  const stagingDb = await connectLegadoTickets();
  const col = importadosCol(stagingDb);

  await connectLegacyOcta();
  const Model = getTicketLegadoOctaModel();

  if (hasFlag('reset-checkpoint')) {
    await setCheckpoint(stagingDb, PASS, { lastOctadeskNumber: 0, done: false });
    console.log('[passD] checkpoint resetado');
  }

  const cp = (await getCheckpoint(stagingDb, PASS)) || {};
  let lastOctadeskNumber = Number(cp.lastOctadeskNumber || 0);
  if (!Number.isFinite(lastOctadeskNumber) || lastOctadeskNumber < 0) lastOctadeskNumber = 0;

  let processed = 0;
  let written = 0;
  let skipped = 0;

  console.log(`[passD] iniciando após octadeskNumber=${lastOctadeskNumber}`);

  while (true) {
    if (maxDocs > 0 && processed >= maxDocs) {
      console.log(`[passD] --max=${maxDocs} atingido`);
      break;
    }

    const batch = await col
      .find({ octadeskNumber: { $gt: lastOctadeskNumber } })
      .sort({ octadeskNumber: 1 })
      .limit(Math.min(BATCH_SIZE, maxDocs > 0 ? maxDocs - processed : BATCH_SIZE))
      .toArray();

    if (!batch.length) {
      console.log('[passD] staging esgotado — concluído');
      break;
    }

    const ops: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }> = [];

    for (const doc of batch as ImportadoOctadeskDoc[]) {
      lastOctadeskNumber = Number(doc.octadeskNumber);
      processed += 1;

      const ticket = (doc.ticket && typeof doc.ticket === 'object' ? doc.ticket : {}) as Record<string, unknown>;
      if (!doc.octadeskNumber || !Number.isFinite(Number(doc.octadeskNumber))) {
        skipped += 1;
        continue;
      }

      const okAttachmentsByKey = new Map<string, ImportadoAttachment>();
      for (const a of doc.attachments || []) {
        okAttachmentsByKey.set(attachmentKeyOf(a), a);
      }

      const customField = filledCustomFields(ticket.customField);
      const requesterCpf = String(customField[CPF_CUSTOM_FIELD_KEY] ?? '').trim();

      const rawInteractions = doc.interactions || [];
      const form = (ticket.form && typeof ticket.form === 'object' ? ticket.form : {}) as Record<string, unknown>;
      // topicGroupName/topicName não existem no ticket — só em propertiesChanges de
      // interações específicas. form.name (sempre presente no ticket) é o fallback.
      const topicGroupName = latestPropertyChangeValue(rawInteractions, TOPIC_GROUP_KEY_CANDIDATES)
        || String(form.name ?? '');
      const topicName = latestPropertyChangeValue(rawInteractions, TOPIC_NAME_KEY_CANDIDATES)
        || String(form.name ?? '');

      const requester = (ticket.requester && typeof ticket.requester === 'object' ? ticket.requester : {}) as Record<string, unknown>;

      const ticketDoc = {
        octadeskNumber: Number(doc.octadeskNumber),
        octadeskId: doc.octadeskId || (ticket.id != null ? String(ticket.id) : ''),
        protocoloExibicao: toProtocoloDesk(doc.octadeskNumber),
        summary: String(ticket.summary ?? ''),
        topicGroupName,
        topicName,
        requesterName: String(requester.name ?? ''),
        requesterMail: String(requester.email ?? ''),
        requesterCpf,
        openDate: parseDateSafe(ticket.createdAt), // API real não expõe "openDate" — createdAt é a abertura
        customField,
        interactions: buildInteractions(ticket, doc.interactions || [], okAttachmentsByKey),
        importadoEm: new Date(),
      };

      ops.push({
        updateOne: {
          filter: { octadeskNumber: ticketDoc.octadeskNumber },
          update: { $set: ticketDoc },
          upsert: true,
        },
      });
    }

    if (ops.length) {
      const bulk = await Model.collection.bulkWrite(ops as never, { ordered: false });
      written += ops.length;

      // Staging é só um buffer de passagem, não um arquivo — depois de gravar com sucesso
      // no destino final, o doc é removido do staging. Isso mantém o staging sempre pequeno
      // (só o volume em trânsito), em vez de acumular os ~700MB do dataset completo.
      const writtenNumbers = ops.map((op) => op.updateOne.filter.octadeskNumber as number);
      await col.deleteMany({ octadeskNumber: { $in: writtenNumbers } });

      console.log(
        `[passD] lote processado=${batch.length} gravados=${ops.length} `
        + `(upserted=${bulk.upsertedCount} mod=${bulk.modifiedCount}) acumulado=${written} `
        + `staging-liberado=${writtenNumbers.length}`,
      );
    }

    await setCheckpoint(stagingDb, PASS, {
      lastOctadeskNumber,
      done: false,
      processed,
      written,
      skipped,
    });
  }

  await setCheckpoint(stagingDb, PASS, {
    lastOctadeskNumber,
    done: true,
    processed,
    written,
    skipped,
    finishedAt: new Date(),
  });

  console.log(JSON.stringify({ pass: PASS, processed, written, skipped }, null, 2));
}

main()
  .catch(async (err) => {
    console.error('[passD] falhou:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLegadoTickets().catch(() => undefined);
    await disconnectLegacyOcta().catch(() => undefined);
  });
