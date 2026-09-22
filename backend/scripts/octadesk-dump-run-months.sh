#!/usr/bin/env bash
# octadesk-dump-run-months.sh v1.0.0
# Orquestra a importação definitiva mês a mês: Pass A -> Pass B -> Pass C -> Pass D,
# sempre resetando o checkpoint por mês e deixando o Pass D liberar o staging antes
# de avançar. Para imediatamente se qualquer passo falhar (ex.: cota do Atlas esgotada).
set -e
cd "$(dirname "$0")/.."

MONTHS=(
  "2025-10" "2025-11" "2025-12" "2026-01" "2026-02" "2026-03" "2026-04"
  "2026-05" "2026-06" "2026-07" "2026-08" "2026-09"
)

next_month() {
  local ym="$1"
  local y="${ym%-*}"
  local m="${ym#*-}"
  m=$((10#$m + 1))
  if [ "$m" -gt 12 ]; then
    y=$((y + 1))
    m=1
  fi
  printf "%04d-%02d" "$y" "$m"
}

LOG_DIR="${OCTADESK_RUN_LOG_DIR:-/tmp}"
mkdir -p "$LOG_DIR"

for ym in "${MONTHS[@]}"; do
  from_date="${ym}-01"
  to_month="$(next_month "$ym")"
  to_date="${to_month}-01"

  echo "=== mês $ym (createdAt $from_date .. $to_date) ==="

  echo "--- Pass A ---"
  npx tsx scripts/octadesk-dump-tickets.ts --from="$from_date" --to="$to_date" --reset-checkpoint \
    > "$LOG_DIR/passA-$ym.log" 2>&1
  tail -3 "$LOG_DIR/passA-$ym.log"

  echo "--- Pass B ---"
  npx tsx scripts/octadesk-dump-interactions.ts --from="$ym" --to="$ym" --reset-checkpoint \
    > "$LOG_DIR/passB-$ym.log" 2>&1
  tail -3 "$LOG_DIR/passB-$ym.log"

  echo "--- Pass C ---"
  npx tsx scripts/octadesk-dump-attachments.ts \
    > "$LOG_DIR/passC-$ym.log" 2>&1
  tail -3 "$LOG_DIR/passC-$ym.log"

  echo "--- Pass D ---"
  npx tsx scripts/octadesk-dump-transform.ts --reset-checkpoint \
    > "$LOG_DIR/passD-$ym.log" 2>&1
  tail -3 "$LOG_DIR/passD-$ym.log"

  echo "=== mês $ym concluído ==="
done

echo "=== importação definitiva (18 meses) concluída ==="
