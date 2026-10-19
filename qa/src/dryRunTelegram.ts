/**
 * dryRunTelegram v1.0.0 — gera as 4 variantes da notificação do Telegram com dados de
 * exemplo e imprime no console. Não conecta no banco, não chama a API do Velodesk e não
 * envia nada ao Telegram de verdade.
 *
 * Uso: npm run qa:dry-telegram
 */
import { caso, CATALOGO, type Situacao } from './catalogo';
import type { Resultado, Metrica } from './resultado';
import type { CasoAnterior } from './estadoSentinela';
import { montarMensagemResumo } from './telegram';

function resultado(id: string, situacao: Situacao, observacao: string, extra: Partial<Resultado> = {}): Resultado {
  return { caso: caso(id), situacao, observacao, duracaoMs: 0, ...extra };
}

function titulo(texto: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(texto);
  console.log('='.repeat(72));
}

// ── Cenário 1 — 🔴 Falha encontrada ──────────────────────────────────────────
// Mesmo exemplo que gerou a rodada de 07/10 recebida no Telegram real.
const falhaE09 = resultado(
  'E09',
  'Nao',
  '1. "Abertura de protocolo de atendimento": gatilho não cobre o canal "Bacen" (1), "E-mail" (1) — esses tickets nunca são avaliados.\n' +
    '2. "Abertura de protocolo de atendimento - e-mail": gatilho não cobre o canal "Bacen" (1), "App" (31) — esses tickets nunca são avaliados.\n' +
    '3. "Encerramento s/CSAT": gatilho não cobre o canal "Portal" (6), "Chat" (4), "(vazio)" (1) — esses tickets nunca são avaliados.\n' +
    '4. "Encerramento s/CSAT": prazo (imediato) não cumprido em 23/489 ticket(s) elegível(eis) nos últimos 7 dias — ex.: protocolo 2610010441.',
  {
    ocorrencias: [
      {
        item: 'Abertura de protocolo de atendimento',
        resumo: '2 ticket(s) sem e-mail',
        canais: ['Bacen', 'E-mail'],
        impacto: 2,
      },
      {
        item: 'Abertura de protocolo de atendimento - e-mail',
        resumo: '32 ticket(s) sem e-mail',
        canais: ['Bacen', 'App'],
        impacto: 32,
      },
      {
        item: 'Encerramento s/CSAT',
        resumo: '11 ticket(s) sem e-mail',
        canais: ['Portal', 'Chat', '(vazio)'],
        impacto: 11,
      },
      {
        item: 'Encerramento s/CSAT',
        resumo: '23 de 489 e-mails atrasados (5%, últimos 7 dias)',
        impacto: 23,
      },
    ],
  },
);

titulo('CENÁRIO 1 — 🔴 Falha encontrada (só E09, 4 ocorrências internas, Envios de e-mail)');
const r1 = montarMensagemResumo([falhaE09], [], null);
console.log(r1.texto);
console.log(`\n[inline keyboard "Ver no Sentinela"? ${r1.comBotaoDetalhes}]`);

// ── Cenário 1b — reproduz a rodada real de 19/10 às 13:10 (7 falhas, 3 áreas) ────────────────
const f01 = resultado('F01', 'Nao', 'O ticket foi ENCERRADO sem responsável definido.');
const f04 = resultado('F04', 'Nao', '26 tickets resolvidos há mais de 3 dias sem fechar.');
const x07 = resultado(
  'X07',
  'Nao',
  '28 ticket(s) em "novo" parado(s) há mais de 2h — 28 já passam de 5h.',
  {
    ocorrencias: Array.from({ length: 28 }, (_, i) => ({
      item: `Ticket 261019${String(i).padStart(4, '0')}`,
      resumo: 'criado às 06:40 (madrugada) — 5.3h sem tratamento desde a abertura do expediente, sem responsável.',
      impacto: 5.3,
    })),
  },
);

// Preenche o resto da rodada com os demais casos do catálogo passando — pra "De X somente Y"
// mostrar o universo real analisado, não só os 4 que falharam.
const idsComFalha = new Set(['E09', 'F01', 'F04', 'X07']);
const restanteOk = CATALOGO.filter((c) => !idsComFalha.has(c.id)).map((c) => resultado(c.id, 'Sim', 'ok'));

titulo(`CENÁRIO 1b — 🔴 Falha (reprodução da rodada real de 19/10, rodada completa de ${CATALOGO.length} casos)`);
const r1b = montarMensagemResumo([falhaE09, f01, f04, x07, ...restanteOk], [], null);
console.log(r1b.texto);
console.log(`\n[inline keyboard "Ver no Sentinela"? ${r1b.comBotaoDetalhes}]`);

// ── Cenário 2 — 🟡 Atenção ───────────────────────────────────────────────────
// Nada de novo quebrado, mas uma métrica saiu do normal.
const metricaAtencao: Metrica = {
  nome: 'Taxa de resposta do CSAT (7 dias)',
  valor: '12.0%',
  situacao: 'Atenção',
};

titulo('CENÁRIO 2 — 🟡 Atenção (métrica fora do normal)');
const r2 = montarMensagemResumo([], [metricaAtencao], null);
console.log(r2.texto);
console.log(`\n[inline keyboard "Ver no Sentinela"? ${r2.comBotaoDetalhes}]`);

// ── Cenário 3 — 🟢 Resolvido ─────────────────────────────────────────────────
// Rodada anterior tinha E09 falhando; nesta rodada o mesmo caso passou.
const anteriorComFalha = new Map<string, CasoAnterior>([
  ['E09', { situacao: 'Nao', observacao: 'texto da rodada anterior (qualquer coisa diferente da atual)' }],
]);

titulo('CENÁRIO 3 — 🟢 Resolvido');
const r3 = montarMensagemResumo([resultado('E09', 'Sim', 'canal e prazo cumpridos nesta rodada')], [], anteriorComFalha);
console.log(r3.texto);
console.log(`\n[inline keyboard "Ver no Sentinela"? ${r3.comBotaoDetalhes}]`);

// ── Cenário 4 — 🟢 Tudo certo ────────────────────────────────────────────────
titulo('CENÁRIO 4 — 🟢 Tudo certo');
const resultadosOk = ['S01', 'S02', 'E02', 'E09', 'C06'].map((id) => resultado(id, 'Sim', 'ok'));
const r4 = montarMensagemResumo(resultadosOk, [], null);
console.log(r4.texto);
console.log(`\n[inline keyboard "Ver no Sentinela"? ${r4.comBotaoDetalhes}]`);
