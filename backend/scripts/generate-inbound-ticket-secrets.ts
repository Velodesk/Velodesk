/** generate-inbound-ticket-secrets v1.0.0 — chaves [a-z0-9]{35} por origem */
import crypto from 'crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const KEY_LENGTH = 35;

export function generateInboundTicketSecret(): string {
  const bytes = crypto.randomBytes(KEY_LENGTH);
  let out = '';
  for (let i = 0; i < KEY_LENGTH; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

function main(): void {
  const app = generateInboundTicketSecret();
  const telefone = generateInboundTicketSecret();
  const agenteIa = generateInboundTicketSecret();
  const chat = generateInboundTicketSecret();
  const qaTeste = generateInboundTicketSecret();

  console.log('# Cole no Cloud Run / FONTE DA VERDADE/.env-velodesk (não commitar valores reais)\n');
  console.log(`INBOUND_TICKET_APP_SECRET=${app}`);
  console.log(`INBOUND_TICKET_TELEFONE_SECRET=${telefone}`);
  console.log(`INBOUND_TICKET_AGENTE_IA_SECRET=${agenteIa}`);
  console.log(`INBOUND_TICKET_CHAT_SECRET=${chat}`);
  console.log(`INBOUND_TICKET_QA_TESTE_SECRET=${qaTeste}`);
}

if (require.main === module) {
  main();
}
