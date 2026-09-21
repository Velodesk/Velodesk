/**
 * octadesk-dump-from-backup.ts v1.0.0
 * Processa o backup bruto do Mongo do Octadesk (13 arquivos part_000N.json dentro do zip
 * fornecido pelo usuário) diretamente para o cluster de prod (legado_octa.tickets) — sem
 * chamadas de API, sem staging intermediário. Elimina o gargalo de rede/DB round-trip por
 * ticket do Pass A/B (que levava dias para 12-18 meses de volume).
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-from-backup.ts --zip="<caminho>" --since-months=18
 *   npx tsx scripts/octadesk-dump-from-backup.ts --zip="<caminho>" --max=1000
 */
import { spawn } from 'child_process';
import { connectLegacyOcta, disconnectLegacyOcta } from '../src/config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../src/models/TicketLegadoOcta';
import { toProtocoloDesk } from '../src/utils/octadeskProtocolo';

const PARTS = Array.from({ length: 13 }, (_, i) => `part_${String(i + 1).padStart(4, '0')}.json`);
const CPF_CUSTOM_FIELD_KEY = 'cpf_do_titular';
const BATCH_SIZE = 500;

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function sinceDate(sinceMonths: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - sinceMonths);
  return d;
}

function mongoDate(v: unknown): Date | null {
  if (!v || typeof v !== 'object') return null;
  const raw = (v as Record<string, unknown>).$date;
  if (raw == null) return null;
  if (typeof raw === 'object') {
    const numberLong = (raw as Record<string, unknown>).$numberLong;
    if (numberLong != null) {
      const n = Number(numberLong);
      return Number.isFinite(n) ? new Date(n) : null;
    }
    return null;
  }
  const d = new Date(raw as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPdfAttachment(name: string, url: string): boolean {
  return `${name || ''} ${url || ''}`.toLowerCase().includes('.pdf');
}

function filledCustomFields(customField: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!customField || typeof customField !== 'object') return out;
  for (const [key, value] of Object.entries(customField as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

function transformTicket(ticket: Record<string, unknown>) {
  const number = Number(ticket.Number);
  if (!Number.isFinite(number) || number <= 0) return null;

  const customField = filledCustomFields(ticket.CustomField);
  const requesterCpf = String(customField[CPF_CUSTOM_FIELD_KEY] ?? '').trim();

  const rawInteractions = Array.isArray(ticket.Interactions) ? ticket.Interactions : [];
  const interactions = rawInteractions
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((interaction) => {
      const person = (interaction.Person && typeof interaction.Person === 'object'
        ? interaction.Person
        : {}) as Record<string, unknown>;
      const comments = (Array.isArray(interaction.Comments) ? interaction.Comments : [])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          content: String(c.Content ?? ''),
          isPublic: Boolean(c.IsPublic),
        }));
      const attachments = (Array.isArray(interaction.Attachments) ? interaction.Attachments : [])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({ name: String(a.Name ?? 'anexo'), url: String(a.Url ?? '') }))
        .filter((a) => a.url && isPdfAttachment(a.name, a.url));

      return {
        dateCreation: mongoDate(interaction.DateCreation) || new Date(0),
        personName: String(person.Name ?? ''),
        personEmail: String(person.Email ?? ''),
        comments,
        attachments,
        propertiesChanges: (interaction.PropertiesChanges && typeof interaction.PropertiesChanges === 'object'
          ? interaction.PropertiesChanges as Record<string, unknown>
          : {}),
      };
    })
    .sort((a, b) => a.dateCreation.getTime() - b.dateCreation.getTime());

  return {
    octadeskNumber: number,
    octadeskId: '',
    protocoloExibicao: toProtocoloDesk(number),
    summary: String(ticket.Summary ?? ''),
    topicGroupName: String(ticket.TopicGroupName ?? ''),
    topicName: String(ticket.TopicName ?? ''),
    requesterName: String(ticket.RequesterName ?? ''),
    requesterMail: String(ticket.RequesterMail ?? ''),
    requesterCpf,
    openDate: mongoDate(ticket.OpenDate),
    customField,
    interactions,
    importadoEm: new Date(),
  };
}

/**
 * Extrai o texto de cada objeto de 1º nível do array `[ {...}, {...} ]` com um scanner
 * char-a-char sensível a contexto de string (profundidade de chaves só conta fora de
 * strings; dentro de strings, escapa caracteres de controle crus — ex. quebra de linha
 * literal dentro de um valor tipo "Transferências realizadas\n" — em vez de corrompê-los).
 * Uma abordagem por linha (regex em `^  {`/`^  }`) quebra exatamente nesse caso: o valor
 * span múltiplas linhas físicas e o JSON.parse rejeita o \n cru dentro da string.
 */
function extractTopLevelObjects(onObject: (text: string) => void) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let buf = '';
  let capturing = false;

  return (chunk: string) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (capturing) {
        if (inString) {
          if (escapeNext) {
            escapeNext = false;
            buf += ch;
            continue;
          }
          if (ch === '\\') {
            escapeNext = true;
            buf += ch;
            continue;
          }
          if (ch === '"') {
            inString = false;
            buf += ch;
            continue;
          }
          // Caractere de controle cru dentro de uma string (ex.: \n literal colado no
          // valor) — escapar preserva o conteúdo sem quebrar o JSON.
          const code = ch.charCodeAt(0);
          if (code <= 0x1f) {
            if (ch === '\n') buf += '\\n';
            else if (ch === '\t') buf += '\\t';
            else if (ch === '\r') buf += '\\r';
            else buf += `\\u${code.toString(16).padStart(4, '0')}`;
            continue;
          }
          buf += ch;
          continue;
        }

        if (ch === '"') {
          inString = true;
          buf += ch;
          continue;
        }
        if (ch === '{') {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === '}') {
          depth -= 1;
          buf += ch;
          if (depth === 0) {
            capturing = false;
            onObject(buf);
            buf = '';
          }
          continue;
        }
        buf += ch;
        continue;
      }

      // Fora de um objeto de 1º nível: só o '{' de abertura interessa (ignora '[', ']',
      // ',' e whitespace entre elementos do array raiz).
      if (ch === '{') {
        capturing = true;
        depth = 1;
        buf = '{';
      }
    }
  };
}

/**
 * Varre a parte e devolve os tickets já transformados que caem na janela — tudo em memória,
 * sem I/O de banco durante o parse (evita a race condition de disparar bulkWrite dentro de
 * um callback síncrono chamado milhares de vezes sem aguardar). A gravação real acontece
 * depois, em main(), em lotes sequenciais.
 */
async function processPart(
  zipPath: string,
  partName: string,
  cutoff: Date,
): Promise<{ scanned: number; tickets: NonNullable<ReturnType<typeof transformTicket>>[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('unzip', ['-p', zipPath, partName]);
    proc.stdout.setEncoding('utf8');

    let scanned = 0;
    const tickets: NonNullable<ReturnType<typeof transformTicket>>[] = [];

    const feed = extractTopLevelObjects((text) => {
      scanned += 1;
      try {
        const ticket = JSON.parse(text);
        const openDate = mongoDate(ticket.OpenDate);
        if (openDate && openDate >= cutoff) {
          const transformed = transformTicket(ticket);
          if (transformed) tickets.push(transformed);
        }
      } catch (err) {
        console.error(`[backup] falha ao parsear objeto em ${partName}:`, (err as Error).message);
      }
    });

    proc.stdout.on('data', (chunk: string) => feed(chunk));
    proc.stdout.on('end', () => resolve({ scanned, tickets }));
    proc.on('error', reject);
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
}

async function main(): Promise<void> {
  const zipPath = parseArg('zip');
  if (!zipPath) throw new Error('--zip=<caminho do arquivo de partes .json dentro do zip> é obrigatório');

  const sinceMonths = Number(parseArg('since-months') || '18') || 18;
  const maxTotal = Number(parseArg('max') || '0') || 0;
  const cutoff = sinceDate(sinceMonths);

  console.log(`[backup] janela: OpenDate >= ${cutoff.toISOString()} (${sinceMonths} meses)`);

  await connectLegacyOcta();
  const Model = getTicketLegadoOctaModel();

  let totalWritten = 0;
  let totalScanned = 0;
  let totalMatched = 0;
  let stop = false;

  async function writeBatches(tickets: NonNullable<ReturnType<typeof transformTicket>>[]) {
    for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
      const slice = tickets.slice(i, i + BATCH_SIZE);
      const ops = slice.map((doc) => ({
        updateOne: {
          filter: { octadeskNumber: doc.octadeskNumber },
          update: { $set: doc },
          upsert: true,
        },
      }));
      await Model.collection.bulkWrite(ops as never, { ordered: false });
      totalWritten += ops.length;
      console.log(`[backup] gravados=${totalWritten} escaneados=${totalScanned}`);
    }
  }

  for (const partName of PARTS) {
    if (stop) break;
    console.log(`[backup] processando ${partName}...`);
    const { scanned, tickets } = await processPart(zipPath, partName, cutoff);
    totalScanned += scanned;
    totalMatched += tickets.length;

    const toWrite = maxTotal > 0
      ? tickets.slice(0, Math.max(0, maxTotal - (totalWritten)))
      : tickets;
    await writeBatches(toWrite);
    if (maxTotal > 0 && totalWritten >= maxTotal) stop = true;

    console.log(`[backup] ${partName}: escaneados=${scanned} no-período=${tickets.length}`);
  }

  console.log(JSON.stringify({ totalScanned, totalMatched, totalWritten }, null, 2));
}

main()
  .catch((err) => {
    console.error('[backup] falhou:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLegacyOcta().catch(() => undefined);
  });
