/**
 * test-play-reviews — valida o fluxo Google Play ponta a ponta SEM tocar Google/parceiro real:
 * sobe um servidor HTTP falso no contrato da API do parceiro (API.md) + MongoDB em memória
 * e exercita cliente, sincronização (novo/edição/resposta externa/idempotência/falha) e reply.
 *
 * Uso: npm run test:play-reviews
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const API_KEY = 'chave-de-teste';

interface FakeReview {
  reviewId: string; authorName: string; starRating: number; title: string; text: string;
  lastModified: string; reply: { text: string; lastModified: string } | null;
}

const estado = {
  reviews: [] as FakeReview[],
  modoFalha: null as null | 500 | 403,
  chamadas: { get: 0, reply: 0 },
  ultimaResposta: null as null | { reviewId: string; text: string },
};

function subirParceiroFalso(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const enviar = (status: number, corpo: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (req.headers['x-api-key'] !== API_KEY) return enviar(401, { error: 'API key invalida ou ausente (header x-api-key).' });

    if (req.method === 'GET' && req.url === '/reviews') {
      estado.chamadas.get += 1;
      if (estado.modoFalha === 500) return enviar(500, { error: 'erro interno' });
      return enviar(200, { reviews: estado.reviews });
    }

    const m = req.method === 'POST' && req.url?.match(/^\/reviews\/([^/]+)\/reply$/);
    if (m) {
      estado.chamadas.reply += 1;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (estado.modoFalha === 500) return enviar(500, { error: 'erro interno' });
        if (estado.modoFalha === 403) return enviar(403, { error: 'sem permissão Reply to reviews' });
        const { text } = JSON.parse(body) as { text: string };
        estado.ultimaResposta = { reviewId: decodeURIComponent(m[1]), text };
        return enviar(200, { reviewId: decodeURIComponent(m[1]), replyText: text, lastEdited: { seconds: '1', nanos: 0 } });
      });
      return undefined;
    }
    return enviar(404, { error: 'rota inexistente' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const review = (id: string, over: Partial<FakeReview> = {}): FakeReview => ({
  reviewId: id, authorName: 'Fulano', starRating: 2, title: '', text: 'App travando',
  lastModified: '2026-09-28T10:00:00.000Z', reply: null, ...over,
});

async function main() {
  const parceiro = await subirParceiroFalso();
  const porta = (parceiro.address() as AddressInfo).port;
  // Isolamento: sem MONGO_ENV o backend não abre as conexões do cluster central (Atlas real).
  process.env.MONGO_ENV = '';
  process.env.PLAY_REVIEWS_API_URL = `http://127.0.0.1:${porta}`;
  process.env.PLAY_REVIEWS_API_KEY = API_KEY;
  process.env.PLAY_REVIEWS_TIMEOUT_MS = '3000';
  process.env.GOOGLE_PLAY_PACKAGE_NAME = 'br.com.teste.app';

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongo = await MongoMemoryServer.create();
  const { connectDatabase, disconnectDatabase } = await import('../src/config/database');
  await connectDatabase(mongo.getUri('velodesk'));

  const cliente = await import('../src/services/redesSociais/captacao/playReviewsApi.client');
  const { sincronizarReviewsPlay } = await import('../src/services/redesSociais/playReviewsSync.service');
  const { responderComentario, ErroResposta } = await import('../src/services/redesSociais/redesSociaisComentario.service');
  const { getRedesSociaisComentarioModel } = await import('../src/models/RedesSociaisComentario');
  const Model = getRedesSociaisComentarioModel();

  const classificador = (async (c: { mensagem: string }) => ({
    sentimento: c.mensagem.includes('ótimo') ? 'positivo' : 'negativo',
    motivo: 'problema_tecnico_bug', confianca: 90,
  })) as Parameters<typeof sincronizarReviewsPlay>[0];
  let ok = 0;
  const passo = (nome: string) => { ok += 1; console.log(`  ✓ ${nome}`); };

  console.log('Cliente');
  estado.reviews = [review('r1')];
  assert.equal((await cliente.buscarReviewsDoParceiro()).length, 1); passo('GET /reviews com x-api-key');

  const chaveOriginal = process.env.PLAY_REVIEWS_API_KEY;
  // A env é lida no import; valida o 401 pelo contrato do servidor falso direto.
  const r401 = await fetch(`${process.env.PLAY_REVIEWS_API_URL}/reviews`, { headers: { 'x-api-key': 'errada' } });
  assert.equal(r401.status, 401); passo('parceiro rejeita key errada (401)');
  assert.equal(process.env.PLAY_REVIEWS_API_KEY, chaveOriginal);

  estado.modoFalha = 500; estado.chamadas.get = 0;
  await assert.rejects(cliente.buscarReviewsDoParceiro(), (e: Error) => e.name === 'ErroPlayReviewsApi');
  assert.equal(estado.chamadas.get, 3); passo('leitura faz 3 tentativas em 5xx e então falha');
  estado.modoFalha = null;

  estado.chamadas.reply = 0;
  await assert.rejects(cliente.responderReviewNoParceiro('r1', 'x'.repeat(351)));
  await assert.rejects(cliente.responderReviewNoParceiro('r1', '   '));
  assert.equal(estado.chamadas.reply, 0); passo('reply vazio/>350 é barrado SEM chamar o parceiro');

  console.log('Sincronização');
  estado.reviews = [
    review('n1'),
    review('n2', { text: 'ótimo app', starRating: 5, reply: { text: 'Obrigado!', lastModified: '2026-09-28T12:00:00.000Z' } }),
  ];
  let r = await sincronizarReviewsPlay(classificador);
  assert.deepEqual([r.novos, r.falhas.length], [2, 0]);
  const n2 = await Model.findOne({ idOrigem: 'n2' }).lean();
  assert.equal(n2?.respondido, true); assert.equal(n2?.origemResposta, 'play_console'); assert.equal(n2?.sentimento, 'positivo');
  passo('insere novos; resposta já publicada no Play entra como respondida (play_console)');

  r = await sincronizarReviewsPlay(classificador);
  assert.deepEqual([r.novos, r.editados, r.respostasImportadas, r.semMudanca], [0, 0, 0, 2]);
  assert.equal(await Model.countDocuments({ canal: 'google_play' }), 2); passo('idempotente: 2º ciclo não muda nada nem duplica');

  estado.reviews = [review('n1', { text: 'Agora funciona, ótimo', starRating: 4, lastModified: '2026-09-29T09:00:00.000Z' }), estado.reviews[1]];
  r = await sincronizarReviewsPlay(classificador);
  assert.equal(r.editados, 1);
  const n1 = await Model.findOne({ idOrigem: 'n1' }).lean();
  assert.equal(n1?.mensagem, 'Agora funciona, ótimo'); assert.equal(n1?.notaEstrelas, 4); assert.equal(n1?.sentimento, 'positivo');
  assert.equal(n1?.editadoAposResposta, false); passo('edição do usuário atualiza texto/nota e reclassifica');

  estado.reviews = [review('n3', { text: 'falha na IA' })];
  r = await sincronizarReviewsPlay((async () => null) as unknown as Parameters<typeof sincronizarReviewsPlay>[0]);
  assert.equal(r.falhas.length, 1); assert.equal(await Model.countDocuments({ idOrigem: 'n3' }), 0);
  passo('falha de classificação não insere (tenta de novo no próximo ciclo)');
  r = await sincronizarReviewsPlay(classificador);
  assert.equal(r.novos, 1); passo('review que falhou entra no ciclo seguinte');

  estado.modoFalha = 500;
  await assert.rejects(sincronizarReviewsPlay(classificador));
  estado.modoFalha = null; passo('parceiro fora do ar: ciclo falha (exit 1 no Job) sem corromper dados');

  console.log('Reply');
  const alvo = await Model.findOne({ idOrigem: 'n1' });
  assert.ok(alvo);
  estado.chamadas.reply = 0;
  await assert.rejects(responderComentario(String(alvo._id), 'y'.repeat(351), 'Agente'), (e: Error) => e instanceof ErroResposta && (e as InstanceType<typeof ErroResposta>).status === 400);
  assert.equal(estado.chamadas.reply, 0); passo('>350 caracteres → 400 sem chamar o parceiro');

  estado.modoFalha = 500;
  await assert.rejects(responderComentario(String(alvo._id), 'Olá!', 'Agente'), (e: Error) => e instanceof ErroResposta && (e as InstanceType<typeof ErroResposta>).status === 502);
  let depois = await Model.findById(alvo._id).lean();
  assert.equal(depois?.respondido, false); assert.ok(depois?.erroPublicacao); passo('parceiro falha → NÃO marca respondido e grava erroPublicacao (502)');

  estado.modoFalha = 403;
  await assert.rejects(responderComentario(String(alvo._id), 'Olá!', 'Agente'));
  depois = await Model.findById(alvo._id).lean();
  assert.equal(depois?.respondido, false); passo('403 (sem permissão) → não marca respondido');

  estado.modoFalha = null;
  await responderComentario(String(alvo._id), '  Olá, já corrigimos!  ', 'Agente X');
  depois = await Model.findById(alvo._id).lean();
  assert.equal(depois?.respondido, true); assert.equal(depois?.resposta, 'Olá, já corrigimos!'); assert.equal(depois?.origemResposta, 'desk');
  assert.ok(depois?.publicadoEm); assert.equal(depois?.erroPublicacao, undefined);
  assert.deepEqual(estado.ultimaResposta, { reviewId: 'n1', text: 'Olá, já corrigimos!' }); passo('sucesso: publica (trim), marca respondido/publicadoEm e limpa erro');

  estado.reviews = [review('n1', { text: 'Agora funciona, ótimo', starRating: 4, lastModified: '2026-09-30T09:00:00.000Z', reply: { text: 'Olá, já corrigimos!', lastModified: '2026-09-30T09:05:00.000Z' } })];
  await sincronizarReviewsPlay(classificador);
  depois = await Model.findById(alvo._id).lean();
  assert.equal(depois?.origemResposta, 'desk'); passo('sync posterior não sobrescreve a resposta registrada pelo Desk');

  estado.reviews = [review('n1', { text: 'Voltou a travar', starRating: 1, lastModified: '2026-09-30T18:00:00.000Z', reply: { text: 'Olá, já corrigimos!', lastModified: '2026-09-30T09:05:00.000Z' } })];
  await sincronizarReviewsPlay(classificador);
  depois = await Model.findById(alvo._id).lean();
  assert.equal(depois?.editadoAposResposta, true); assert.equal(depois?.respondido, true); passo('edição depois de respondida marca editadoAposResposta');

  await disconnectDatabase();
  await mongo.stop();
  parceiro.close();
  console.log(`\n${ok} verificações OK`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('\nFALHOU:', err); process.exit(1); });
