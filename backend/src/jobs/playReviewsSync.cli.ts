/**
 * playReviewsSync.cli v1.0.0 — entrypoint do Cloud Run Job "scheduler" do Google Play.
 *
 * Roda UM ciclo (API do parceiro → classificação → Mongo) e encerra com exit code:
 * 0 = ok, 1 = falha (Cloud Run Job registra a execução como falha e o alerta dispara).
 * Sem porta, sem rota, sem URL de entrada — só o cron (Cloud Scheduler a cada 10 min).
 * Mesma imagem do backend; só muda o comando: `node dist/jobs/playReviewsSync.cli.js`.
 * Precisa sair pelo IP fixo liberado pelo parceiro (egress VPC + Cloud NAT).
 */
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase, isDeskConfigConnected } from '../config/database';
import { rodarCicloGooglePlay } from '../services/redesSociais/orquestrador.service';

async function main(): Promise<number> {
  if (!env.mongoUri) {
    console.error('[play-sync] MONGODB_URI ausente.');
    return 1;
  }

  try {
    await connectDatabase();
    if (!isDeskConfigConnected()) {
      console.error('[play-sync] desk_config indisponível.');
      return 1;
    }
    const inicio = Date.now();
    await rodarCicloGooglePlay();
    console.info(`[play-sync] ciclo concluído em ${Date.now() - inicio}ms.`);
    return 0;
  } catch (err) {
    console.error('[play-sync] ciclo falhou:', (err as Error).message);
    return 1;
  } finally {
    await disconnectDatabase().catch(() => undefined);
  }
}

void main().then((code) => process.exit(code));
