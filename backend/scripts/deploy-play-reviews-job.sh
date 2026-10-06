#!/usr/bin/env bash
# deploy-play-reviews-job.sh v1.0.0 — cria/atualiza o Cloud Run Job "scheduler" do Google Play
# (captura reviews na API do parceiro a cada 10 min e grava em redes_sociais_comentarios)
# e o Cloud Scheduler que o dispara. Sem porta, sem URL: só o cron.
#
# NÃO é executado automaticamente. Rodar manualmente, primeiro em DEV, validar, e só então PROD
# (mesmos parâmetros, PROJECT_ID/secrets do ambiente alvo).
#
# Pré-requisitos (uma vez, por ambiente):
#   1. Secrets no Secret Manager (valores do ambiente alvo):
#        play-reviews-api-key   → x-api-key fornecida pelo parceiro
#        velodesk-mongodb-uri   → mesma URI do serviço principal
#        velodesk-openai-key    → classificação por IA (mesma do serviço principal)
#   2. Egress com IP fixo LIBERADO PELO PARCEIRO. O Job só sai pelo IP fixo se for criado com
#      rede VPC (Direct VPC egress) roteando TODO o tráfego por um Cloud NAT com IP estático.
#      Informe NETWORK e SUBNET abaixo; sem eles o script aborta (evita subir um Job que
#      sairia por IP dinâmico e tomaria 401/403 do parceiro).
#
# Uso:
#   PROJECT_ID=meu-projeto PLAY_REVIEWS_API_URL=https://... PACKAGE_NAME=br.com.velotax.irpf.app \
#   NETWORK=minha-vpc SUBNET=minha-subnet ./deploy-play-reviews-job.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?defina PROJECT_ID}"
PLAY_REVIEWS_API_URL="${PLAY_REVIEWS_API_URL:?defina PLAY_REVIEWS_API_URL (base URL da API do parceiro)}"
PACKAGE_NAME="${PACKAGE_NAME:?defina PACKAGE_NAME (ex.: br.com.velotax.irpf.app)}"
NETWORK="${NETWORK:?defina NETWORK (VPC com Cloud NAT de IP estático)}"
SUBNET="${SUBNET:?defina SUBNET}"
REGION="${REGION:-southamerica-east1}"
REPOSITORY="${REPOSITORY:-velodesk}"
JOB_NAME="${JOB_NAME:-velodesk-play-reviews-sync}"
SCHEDULE="${SCHEDULE:-*/10 * * * *}"
SCHEDULER_SA="${SCHEDULER_SA:-play-sync-scheduler-invoker}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/velodesk-api:play-sync-$(date +%Y%m%d%H%M%S)"

# Contexto de build = backend/ (a imagem da API já contém dist/jobs/playReviewsSync.cli.js).
cd "$(dirname "$0")/.."

echo "== 1/4 — build + push da imagem da API =="
gcloud builds submit . --tag "$IMAGE" --project "$PROJECT_ID"

echo "== 2/4 — cria ou atualiza o Cloud Run Job =="
# --max-retries 0: o próprio cron de 10 min é o retry; repetir na hora só martela o parceiro.
# --parallelism 1 / --tasks 1: um único ciclo por execução.
gcloud run jobs deploy "$JOB_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --command node \
  --args dist/jobs/playReviewsSync.cli.js \
  --max-retries 0 \
  --tasks 1 \
  --parallelism 1 \
  --task-timeout 5m \
  --memory 512Mi \
  --network "$NETWORK" \
  --subnet "$SUBNET" \
  --vpc-egress all-traffic \
  --set-env-vars "NODE_ENV=production,PLAY_REVIEWS_API_URL=${PLAY_REVIEWS_API_URL},GOOGLE_PLAY_PACKAGE_NAME=${PACKAGE_NAME}" \
  --set-secrets "PLAY_REVIEWS_API_KEY=play-reviews-api-key:latest,MONGODB_URI=velodesk-mongodb-uri:latest,OPENAI_API_KEY=velodesk-openai-key:latest"

echo "== 3/4 — service account dedicada pro Scheduler disparar o Job =="
gcloud iam service-accounts create "$SCHEDULER_SA" \
  --project "$PROJECT_ID" \
  --display-name "Dispara o Cloud Run Job de sync do Google Play" \
  || echo "  (já existe, seguindo)"

gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "roles/run.invoker"

echo "== 4/4 — Cloud Scheduler: ${SCHEDULE} =="
JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"
SCHED_NAME="${JOB_NAME}-cron"

if gcloud scheduler jobs describe "$SCHED_NAME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHED_NAME" \
    --location "$REGION" --project "$PROJECT_ID" --schedule "$SCHEDULE" --uri "$JOB_URI"
else
  gcloud scheduler jobs create http "$SCHED_NAME" \
    --location "$REGION" --project "$PROJECT_ID" \
    --schedule "$SCHEDULE" --uri "$JOB_URI" --http-method POST \
    --oauth-service-account-email "${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
fi

echo ""
echo "Pronto. Execução manual (roda agora, sem esperar o cron):"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT_ID --wait"
echo "Logs:"
echo "  gcloud run jobs executions list --job $JOB_NAME --region $REGION --project $PROJECT_ID"
