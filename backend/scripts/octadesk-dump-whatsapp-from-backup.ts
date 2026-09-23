/**
 * octadesk-dump-whatsapp-from-backup.ts v1.0.0
 * Processa o backup bruto do Mongo do Octadesk (chat_chat + message_chat, dentro do zip
 * fornecido pelo usuário) diretamente para o cluster dedicado (legado_octa.whatsapp) — mesmo
 * padrão de octadesk-dump-from-backup.ts (scanner char-a-char, sem staging, sem tradução de
 * schema). Filtra só canal WhatsApp, descarta ruído sem conteúdo real, resolve CPF por
 * telefone via Cliente (melhor esforço) e gera um protocoloExibicao sintético sequencial.
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-whatsapp-from-backup.ts --chatZip="<caminho chat_chat.zip>" --messageZip="<caminho message_chat.zip>" --since-months=18
 *   npx tsx scripts/octadesk-dump-whatsapp-from-backup.ts ... --max=1000
 */
import { spawn } from 'child_process';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { connectLegacyOcta, disconnectLegacyOcta } from '../src/config/legacyOctaConnection';
import { getWhatsappLegadoOctaModel } from '../src/models/WhatsappLegadoOcta';
import { getClienteModel } from '../src/models/Cliente';

const CHAT_PARTS = ['part_0001.json', 'part_0002.json'];
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

function binaryBase64(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  const bin = (v as Record<string, unknown>).$binary as Record<string, unknown> | undefined;
  return bin && typeof bin.base64 === 'string' ? bin.base64 : '';
}

/**
 * Scanner char-a-char de objetos de 1º nível do array `[ {...}, {...} ]`, sensível a
 * contexto de string (mesma técnica validada no import de tickets — evita corromper
 * valores com quebra de linha crua embutida).
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

      if (ch === '{') {
        capturing = true;
        depth = 1;
        buf = '{';
      }
    }
  };
}

async function scanZipParts(
  zipPath: string,
  parts: string[],
  onObject: (text: string, partName: string) => void,
): Promise<void> {
  for (const partName of parts) {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('unzip', ['-p', zipPath, partName]);
      proc.stdout.setEncoding('utf8');
      const feed = extractTopLevelObjects((text) => onObject(text, partName));
      proc.stdout.on('data', (chunk: string) => feed(chunk));
      proc.stdout.on('end', () => resolve());
      proc.on('error', reject);
      proc.stderr.on('data', (d) => process.stderr.write(d));
    });
  }
}

interface RoomInfo {
  octadeskRoomId: string;
  startedAt: Date | null;
  lastMessageAt: Date | null;
  fallbackName: string;
  fallbackPhone: string;
  protocoloExibicao: string;
}

interface RawMessage {
  dateCreation: Date;
  isAgent: boolean;
  authorName: string;
  content: string;
  clientPhone: string;
  clientName: string;
}

function onlyDigits(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

async function main(): Promise<void> {
  const chatZip = parseArg('chatZip');
  const messageZip = parseArg('messageZip');
  if (!chatZip || !messageZip) {
    throw new Error('--chatZip=<...> e --messageZip=<...> são obrigatórios');
  }
  const sinceMonths = Number(parseArg('since-months') || '18') || 18;
  const fromArg = parseArg('from');
  const maxTotal = Number(parseArg('max') || '0') || 0;
  const cutoff = fromArg ? new Date(`${fromArg}T00:00:00.000Z`) : sinceDate(sinceMonths);

  console.log(`[wa-backup] janela: lastMessageAt >= ${cutoff.toISOString()}`);

  await connectDatabase();
  await connectLegacyOcta();
  const Model = getWhatsappLegadoOctaModel();
  const Cliente = getClienteModel();

  // ---- Pass A: chat_chat -> mapa de salas WhatsApp dentro da janela ----
  const rooms = new Map<string, RoomInfo>();
  let seq = 0;
  let scannedRooms = 0;

  await scanZipParts(chatZip, CHAT_PARTS, (text) => {
    scannedRooms += 1;
    try {
      const room = JSON.parse(text);
      if (room.channel !== 'whatsapp') return;
      const lastMessageAt = mongoDate(room.clientLastMessageDate) || mongoDate(room.created);
      if (!lastMessageAt || lastMessageAt < cutoff) return;

      const keyBase64 = binaryBase64(room.key);
      if (!keyBase64) return;

      seq += 1;
      const createdBy = room.createdBy || {};
      const phoneContact = Array.isArray(createdBy.phoneContacts) ? createdBy.phoneContacts[0] : null;

      rooms.set(keyBase64, {
        octadeskRoomId: room._id?.$oid || keyBase64,
        startedAt: mongoDate(room.clientFirstMessageDate),
        lastMessageAt,
        fallbackName: String(createdBy.name || ''),
        fallbackPhone: phoneContact ? String(phoneContact.number || '') : '',
        protocoloExibicao: `WA${String(seq).padStart(8, '0')}`,
      });
    } catch (err) {
      console.error('[wa-backup] falha ao parsear chat_chat:', (err as Error).message);
    }
  });

  console.log(`[wa-backup] chat_chat escaneado: ${scannedRooms} salas, ${rooms.size} são WhatsApp na janela`);

  // ---- Pass B: message_chat -> agrupa mensagens por sala ----
  const messagesByRoom = new Map<string, RawMessage[]>();
  let scannedMessages = 0;
  let matchedMessages = 0;

  await scanZipParts(messageZip, CHAT_PARTS, (text) => {
    scannedMessages += 1;
    try {
      const msg = JSON.parse(text);
      const roomKeyBase64 = binaryBase64(msg.roomKey);
      if (!roomKeyBase64 || !rooms.has(roomKeyBase64)) return;

      const content = String(msg.comment || '').trim();
      if (!content) return;

      const contact = msg.customFields?.contacts?.[0];
      const isCustomerMessage = Boolean(contact?.wa_id);

      matchedMessages += 1;
      const list = messagesByRoom.get(roomKeyBase64) || [];
      list.push({
        dateCreation: mongoDate(msg.time) || new Date(0),
        isAgent: !isCustomerMessage,
        authorName: isCustomerMessage
          ? String(contact.profile?.name || '')
          : String(msg.user?.name || (msg.origin === 'USER' ? 'Atendimento Velotax' : 'Sistema')),
        content,
        clientPhone: isCustomerMessage ? String(contact.wa_id || '') : '',
        clientName: isCustomerMessage ? String(contact.profile?.name || '') : '',
      });
      messagesByRoom.set(roomKeyBase64, list);
    } catch (err) {
      console.error('[wa-backup] falha ao parsear message_chat:', (err as Error).message);
    }
  });

  console.log(`[wa-backup] message_chat escaneado: ${scannedMessages}, ${matchedMessages} com conteúdo real em salas da janela`);

  // ---- Resolve CPF por telefone (melhor esforço, cache por telefone único) ----
  const cpfCache = new Map<string, string>();
  async function resolveCpf(phoneDigits: string): Promise<string> {
    if (!phoneDigits) return '';
    if (cpfCache.has(phoneDigits)) return cpfCache.get(phoneDigits)!;
    const suffix = phoneDigits.slice(-8); // últimos 8 dígitos, tolera prefixo de país/DDI variável
    try {
      const doc = await Cliente.findOne({
        $or: [
          { 'clienteDados.clienteTelefone.whatsapp': { $regex: `${suffix}$` } },
          { 'clienteDados.clienteTelefone.lista': { $regex: `${suffix}$` } },
        ],
      }).lean();
      const dados = doc?.clienteDados?.find((d: any) => d.clienteCpf);
      const cpf = dados?.clienteCpf ? String(dados.clienteCpf) : '';
      cpfCache.set(phoneDigits, cpf);
      return cpf;
    } catch {
      cpfCache.set(phoneDigits, '');
      return '';
    }
  }

  // ---- Monta e grava em lotes ----
  let buffer: Array<Record<string, unknown>> = [];
  let totalWritten = 0;

  async function flush() {
    if (!buffer.length) return;
    const ops = buffer.map((doc) => ({
      updateOne: {
        filter: { octadeskRoomId: doc.octadeskRoomId },
        update: { $set: doc },
        upsert: true,
      },
    }));
    await Model.collection.bulkWrite(ops as never, { ordered: false });
    totalWritten += ops.length;
    buffer = [];
    console.log(`[wa-backup] gravados=${totalWritten}`);
  }

  let processed = 0;
  for (const [roomKey, room] of rooms) {
    if (maxTotal > 0 && processed >= maxTotal) break;
    const msgs = (messagesByRoom.get(roomKey) || []).sort((a, b) => a.dateCreation.getTime() - b.dateCreation.getTime());
    if (!msgs.length) continue;

    const firstCustomerMsg = msgs.find((m) => !m.isAgent);
    const clientPhoneDigits = onlyDigits(firstCustomerMsg?.clientPhone || room.fallbackPhone);
    const clientName = firstCustomerMsg?.clientName || room.fallbackName;
    const clientCpf = await resolveCpf(clientPhoneDigits);

    buffer.push({
      octadeskRoomId: room.octadeskRoomId,
      protocoloExibicao: room.protocoloExibicao,
      clientPhone: clientPhoneDigits,
      clientName,
      clientCpf,
      startedAt: room.startedAt,
      lastMessageAt: room.lastMessageAt,
      messages: msgs.map((m) => ({
        dateCreation: m.dateCreation,
        isAgent: m.isAgent,
        authorName: m.authorName,
        content: m.content,
      })),
      importadoEm: new Date(),
    });
    processed += 1;

    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(JSON.stringify({ scannedRooms, whatsappRoomsInWindow: rooms.size, scannedMessages, matchedMessages, totalWritten }, null, 2));
}

main()
  .catch((err) => { console.error('[wa-backup] falhou:', err); process.exitCode = 1; })
  .finally(async () => {
    await disconnectLegacyOcta().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  });
