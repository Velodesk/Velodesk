#!/usr/bin/env bash
# Reexecuta run-hugme-import-real.ts até o lote terminar de verdade (running:false, processed==total).
# Import é idempotente (dedupe por Id Origem), então retomar do zero a cada retry é seguro —
# linhas já inseridas só são reprocessadas como "updated". Reinicia o backend se ele não responder
# (o processo dev compartilhado às vezes cai por edição de outra sessão no mesmo repo).
set -uo pipefail
cd "$(dirname "$0")/.."

MAX_ATTEMPTS=15
for attempt in $(seq 1 $MAX_ATTEMPTS); do
  echo "=== tentativa $attempt/$MAX_ATTEMPTS ==="

  if ! curl -sf http://localhost:8001/api/health > /dev/null 2>&1; then
    echo "[resume] backend não responde — subindo…"
    (cd .. && nohup npm start > /tmp/velodesk-dev.log 2>&1 &)
    for i in $(seq 1 20); do
      sleep 2
      if curl -sf http://localhost:8001/api/health > /dev/null 2>&1; then
        echo "[resume] backend no ar."
        break
      fi
    done
  fi

  npx tsx scripts/run-hugme-import-real.ts
  code=$?
  if [ $code -eq 0 ]; then
    echo "[resume] script terminou com sucesso (lote concluído)."
    exit 0
  fi
  echo "[resume] tentativa $attempt falhou (code=$code) — aguardando 5s antes de retomar…"
  sleep 5
done

echo "[resume] esgotou $MAX_ATTEMPTS tentativas sem concluir."
exit 1
