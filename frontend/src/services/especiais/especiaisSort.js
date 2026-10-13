/** Ordenação padrão dos casos especiais: mais antigo no topo, mais novo no fim (sem data vai pro fim). */
function toTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : Number.POSITIVE_INFINITY;
}

export function sortOldestFirst(items, dateField) {
  return [...items].sort((a, b) => {
    const ta = toTime(a?.[dateField]);
    const tb = toTime(b?.[dateField]);
    if (ta === tb) return 0;
    return ta < tb ? -1 : 1;
  });
}
