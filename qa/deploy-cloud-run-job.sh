#!/usr/bin/env bash
# deploy-cloud-run-job.sh v1.0.0 — cria/atualiza o Cloud Run Job do Claudio Q.A.
# e os dois Cloud Scheduler que o disparam (07h e 17h BRT), substituindo o
# workflow do GitHub Actions (.github/workflows/qa-velodesk.yml) como motor
# de execução. A lógica de teste em src/ não muda nada — só troca onde roda.
#
# Rodar manualmente, uma vez pra criar e depois sempre que qa/ mudar (rebuild).
# Precisa do gcloud autenticado num usuário/service-account com permissão de
# Cloud Run Admin, Artifact Registry Writer, Secret Manager Admin e Cloud
# Scheduler Admin no projeto.
#
# ── Pré-requisitos (uma vez só, antes de rodar este script) ──────────────────
# 1. Preencher PROJECT_ID abaixo (ou exportar como variável de ambiente antes).
# 2. Criar os secrets no Secret Manager com os MESMOS valores que hoje estão
#    nos GitHub Secrets (Settings → Secrets and variables → Actions do repo):
#      gcloud secrets create qa-email-allowlist      --project "$PROJECT_ID"
#      gcloud secrets create qa-login-email           --project "$PROJECT_ID"
#      gcloud secrets create qa-login-password        --project "$PROJECT_ID"
#      gcloud secrets create qa-responsavel           --project "$PROJECT_ID"
#      gcloud secrets create qa-inbound-secret        --project "$PROJECT_ID"
#      gcloud secrets create qa-client-cpf            --project "$PROJECT_ID"
#      gcloud secrets create qa-openai-key            --project "$PROJECT_ID"
#      gcloud secrets create qa-gemini-key            --project "$PROJECT_ID"
#      gcloud secrets create qa-telegram-token        --project "$PROJECT_ID"
#      gcloud secrets create qa-telegram-chat-id      --project "$PROJECT_ID"
#      gcloud secrets create qa-mongodb-uri           --project "$PROJECT_ID"
#    (depois de criar cada um, `echo -n "<valor>" | gcloud secrets versions add <nome> --data-file=-`)
#
#    IMPORTANTE sobre qa-mongodb-uri: essa ainda é a pendência em aberto —
#    confirmar qual cluster é produção antes de preencher (ver conversa sobre
#    velodesk-dev vs. o cluster novo). Sem isso, as checagens que leem direto
#    do Mongo (e-mails, mesclas) ficam bloqueadas — o resto do agente
#    continua funcionando (testa pela API normalmente).
#
# ── Uso ────────────────────────────────────────────────────────────────────
#   PROJECT_ID=meu-projeto-gcp ./deploy-cloud-run-job.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?defina PROJECT_ID (ex: PROJECT_ID=velodesk-278491073220 ./deploy-cloud-run-job.sh)}"
REGION="southamerica-east1"
REPOSITORY="velodesk"
JOB_NAME="velodesk-qa"
SCHEDULER_SA="qa-scheduler-invoker"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/velodesk-qa:latest"

echo "== 1/4 — build + push da imagem =="
gcloud builds submit . --tag "$IMAGE" --project "$PROJECT_ID"

echo "== 2/4 — cria ou atualiza o Cloud Run Job =="
# --max-retries 0: uma falha aqui é quase sempre um bug real achado pelo QA,
# não uma falha transitória de infra — repetir só criaria ticket de teste
# duplicado sem achar nada novo.
gcloud run jobs deploy "$JOB_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --max-retries 0 \
  --task-timeout 25m \
  --memory 2Gi \
  --set-env-vars "QA_BASE_URL=https://velodesk-278491073220.us-east1.run.app" \
  --set-secrets "QA_EMAIL_ALLOWLIST=qa-email-allowlist:latest,QA_LOGIN_EMAIL=qa-login-email:latest,QA_LOGIN_PASSWORD=qa-login-password:latest,QA_RESPONSAVEL=qa-responsavel:latest,QA_INBOUND_QA_TESTE_SECRET=qa-inbound-secret:latest,QA_CLIENT_CPF=qa-client-cpf:latest,OPENAI_API_KEY=qa-openai-key:latest,GEMINI_API_KEY=qa-gemini-key:latest,TELEGRAM_BOT_TOKEN=qa-telegram-token:latest,TELEGRAM_CHAT_ID=qa-telegram-chat-id:latest,MONGODB_URI=qa-mongodb-uri:latest"

echo "== 3/4 — service account dedicada pro Scheduler disparar o Job =="
gcloud iam service-accounts create "$SCHEDULER_SA" \
  --project "$PROJECT_ID" \
  --display-name "Dispara o Cloud Run Job do Claudio Q.A." \
  || echo "  (já existe, seguindo)"

gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "roles/run.invoker"

echo "== 4/4 — Cloud Scheduler: 07h e 17h BRT (10h/20h UTC), seg-sex =="
JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

for par in "qa-velodesk-manha:0 10 * * 1-5" "qa-velodesk-tarde:0 20 * * 1-5"; do
  nome="${par%%:*}"
  cron="${par#*:}"
  if gcloud scheduler jobs describe "$nome" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$nome" \
      --location "$REGION" --project "$PROJECT_ID" --schedule "$cron" --uri "$JOB_URI"
  else
    gcloud scheduler jobs create http "$nome" \
      --location "$REGION" --project "$PROJECT_ID" \
      --schedule "$cron" --uri "$JOB_URI" --http-method POST \
      --oauth-service-account-email "${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
  fi
done

echo ""
echo "Pronto. Teste manual (roda agora, sem esperar o horário):"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT_ID"
