/**
 * dados.js v1.0.0 — proxy server-to-server pro Sentinela Velodesk
 *
 * Guarda o segredo (QA_INBOUND_QA_TESTE_SECRET) do lado do servidor e chama
 * as rotas de leitura do backend do Velodesk (mesmas 2 que o dashboard em
 * claude.ai/artifact usa) — nunca expõe o segredo pro navegador.
 *
 * Variáveis de ambiente necessárias no projeto Vercel (Settings → Environment
 * Variables): QA_INBOUND_QA_TESTE_SECRET (obrigatória) e QA_BASE_URL
 * (opcional — usa a URL de produção do Velodesk como padrão).
 */

const QA_BASE_URL_PADRAO = 'https://velodesk-278491073220.us-east1.run.app';

module.exports = async function handler(req, res) {
  const base = (process.env.QA_BASE_URL || QA_BASE_URL_PADRAO).replace(/\/+$/, '');
  const secret = process.env.QA_INBOUND_QA_TESTE_SECRET;

  if (!secret) {
    res.status(500).json({ message: 'QA_INBOUND_QA_TESTE_SECRET não configurado no projeto Vercel.' });
    return;
  }

  const headers = { 'x-inbound-qa-teste-secret': secret };

  try {
    const [estadoRes, runsRes] = await Promise.all([
      fetch(`${base}/api/inbound/qa-sentinela/estado`, { headers }),
      fetch(`${base}/api/inbound/qa-sentinela/runs?limit=14`, { headers }),
    ]);

    if (!estadoRes.ok) {
      const detalhe = await estadoRes.text().catch(() => '');
      res.status(estadoRes.status).json({ message: 'Falha ao buscar estado do Sentinela', detalhe });
      return;
    }

    const estadoJson = await estadoRes.json();
    const runsJson = runsRes.ok ? await runsRes.json() : { runs: [] };

    // Cache curto na borda da Vercel — a rodada só muda 2x por dia, não faz
    // sentido bater no backend a cada pageview; stale-while-revalidate evita
    // que o viewer espere a rede numa visita repetida.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(200).json({ estado: estadoJson.estado ?? null, runs: runsJson.runs ?? [] });
  } catch (err) {
    res.status(502).json({ message: 'Falha ao contatar o backend do Velodesk', detalhe: String(err) });
  }
}
