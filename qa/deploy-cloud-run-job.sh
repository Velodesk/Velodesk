#!/usr/bin/env bash
# deploy-cloud-run-job.sh v1.1.0 — cria/atualiza o Cloud Run Job do Claudio Q.A.
# e os três Cloud Scheduler que o disparam, substituindo o workflow do GitHub
# Actions (.github/workflows/qa-velodesk.yml) como motor de execução. A lógica
# de teste em src/ não muda nada — só troca onde roda.
#   - qa-velodesk-manha / qa-velodesk-tarde: rodadas oficiais, 07h/17h BRT,
#     catálogo completo (QA_MODO_EXECUCAO=oficial, o padrão do Job).
#   - qa-velodesk-vigilancia: rodada extra a cada 30 min, 07h-19h BRT, só
#     leitura, catálogo leve — dispara o MESMO Job, com QA_MODO_EXECUCAO=
#     vigilancia sobrescrito só naquela execução (sem redeploy, ver passo 5/5).
#
# Rodar manualmente, uma vez pra criar e depois sempre que qa/ mudar (rebuild).
# Precisa do gcloud autenticado num usuário/service-account com permissão de
# Cloud Run Admin, Artifact Registry Writer, Secret Manager Admin e Cloud
# Scheduler Admin no projeto.
#
# ── Pré-requisitos (uma vez só, antes de rodar este script) ──────────────────
# 1. Preencher PROJECT_ID abaixo (ou exportar como variável de ambiente antes).
# 2. Secrets já existentes no Secret Manager (velohub-471220), reaproveitados
#    tal como estão — nomes reais, não os genéricos de quando este script foi
#    escrito:
#      QA_LOGIN_PASSWORD, INBOUND_TICKET_QA_TESTE_SECRET, QA_CLIENT_CPF,
#      OPENAI_API_KEY, GEMINI_API_KEY, qa-telegram-token, qa-telegram-chat-id,
#      MONGO_URI (versão 2 — confirmada como o cluster de produção)
#
# ── Uso ────────────────────────────────────────────────────────────────────
#   PROJECT_ID=meu-projeto-gcp ./deploy-cloud-run-job.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?defina PROJECT_ID (ex: PROJECT_ID=velodesk-278491073220 ./deploy-cloud-run-job.sh)}"
REGION="southamerica-east1"
REPOSITORY="cloud-run-source-deploy"
JOB_NAME="velodesk-qa"
SCHEDULER_SA="qa-scheduler-invoker"
TZ_AGENDA="America/Sao_Paulo"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/velodesk-qa:latest"

echo "== 1/5 — build + push da imagem =="
gcloud builds submit . --tag "$IMAGE" --project "$PROJECT_ID"

echo "== 2/5 — cria ou atualiza o Cloud Run Job =="
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
  --set-env-vars "QA_BASE_URL=https://velodesk-278491073220.us-east1.run.app,QA_EMAIL_ALLOWLIST=villanova.nsv@gmail.com,QA_LOGIN_EMAIL=qateste@velotax.com.br,QA_RESPONSAVEL=Q.A.Velodesk,OPENAI_MODEL=gpt-4.1-mini,GEMINI_MODEL=gemini-2.5-flash,QA_PAINEL_URL=https://sentinela-hfsqj6konq-ue.a.run.app/" \
  --set-secrets "QA_LOGIN_PASSWORD=QA_LOGIN_PASSWORD:1,QA_INBOUND_QA_TESTE_SECRET=INBOUND_TICKET_QA_TESTE_SECRET:latest,QA_CLIENT_CPF=QA_CLIENT_CPF:1,OPENAI_API_KEY=OPENAI_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,TELEGRAM_BOT_TOKEN=qa-telegram-token:latest,TELEGRAM_CHAT_ID=qa-telegram-chat-id:latest,MONGODB_URI=MONGO_URI:2"

echo "== 3/5 — service account dedicada pro Scheduler disparar o Job =="
gcloud iam service-accounts create "$SCHEDULER_SA" \
  --project "$PROJECT_ID" \
  --display-name "Dispara o Cloud Run Job do Claudio Q.A." \
  || echo "  (já existe, seguindo)"

gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "roles/run.invoker"

# roles/run.invoker só cobre run.jobs.run (suficiente para os disparos oficiais
# em :run v1, passo 4/5). O gatilho de vigilância (passo 5/5) chama o :run v2
# com "overrides" no corpo — isso exige a permissão run.jobs.runWithOverrides,
# que roles/run.invoker NÃO inclui. Sem este binding extra, o Scheduler recebe
# "permission denied" e a vigilância nunca chega a rodar.
gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role "roles/run.jobsExecutorWithOverrides"

echo "== 4/5 — Cloud Scheduler: rodadas oficiais 07h e 17h (America/Sao_Paulo), seg-sex =="
JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB_NAME}:run"

for par in "qa-velodesk-manha:0 7 * * 1-5" "qa-velodesk-tarde:0 17 * * 1-5"; do
  nome="${par%%:*}"
  cron="${par#*:}"
  if gcloud scheduler jobs describe "$nome" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$nome" \
      --location "$REGION" --project "$PROJECT_ID" --schedule "$cron" --time-zone "$TZ_AGENDA" --uri "$JOB_URI"
  else
    gcloud scheduler jobs create http "$nome" \
      --location "$REGION" --project "$PROJECT_ID" \
      --schedule "$cron" --time-zone "$TZ_AGENDA" --uri "$JOB_URI" --http-method POST \
      --oauth-service-account-email "${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
  fi
done

echo "== 5/5 — Cloud Scheduler: vigilância a cada 30 min, 07h-19h (America/Sao_Paulo), seg-sex =="
# Mesmo Job (velodesk-qa), SEM redeployar nada: só esta execução sobrescreve
# QA_MODO_EXECUCAO=vigilancia via "overrides.containerOverrides[].env" da API
# de execução de Cloud Run Jobs v2 (a v1 usada acima, em :run, não aceita
# overrides no corpo da requisição). :15 e :45 de propósito — nunca cai em
# cima dos disparos oficiais de 07h00/17h00 acima.
JOB_URI_V2="https://${REGION}-run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}:run"
VIGILANCIA_NOME="qa-velodesk-vigilancia"
VIGILANCIA_CRON="15,45 7-18 * * 1-5"
VIGILANCIA_BODY='{"overrides":{"containerOverrides":[{"env":[{"name":"QA_MODO_EXECUCAO","value":"vigilancia"}]}]}}'

if gcloud scheduler jobs describe "$VIGILANCIA_NOME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$VIGILANCIA_NOME" \
    --location "$REGION" --project "$PROJECT_ID" \
    --schedule "$VIGILANCIA_CRON" --time-zone "$TZ_AGENDA" \
    --uri "$JOB_URI_V2" --message-body "$VIGILANCIA_BODY" --headers "Content-Type=application/json"
else
  gcloud scheduler jobs create http "$VIGILANCIA_NOME" \
    --location "$REGION" --project "$PROJECT_ID" \
    --schedule "$VIGILANCIA_CRON" --time-zone "$TZ_AGENDA" \
    --uri "$JOB_URI_V2" --http-method POST \
    --headers "Content-Type=application/json" --message-body "$VIGILANCIA_BODY" \
    --oauth-service-account-email "${SCHEDULER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
fi

echo ""
echo "Pronto. Teste manual (roda agora, sem esperar o horário):"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT_ID"
echo "Teste manual da vigilância (com o override de QA_MODO_EXECUCAO):"
echo "  gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT_ID --update-env-vars QA_MODO_EXECUCAO=vigilancia"
