/**
 * moduleStatus.service v1.1.0 — lê o array `servicos` (formato atual do VeloHub)
 * VERSION: v1.1.0 | DATE: 2026-09-11
 *
 * Lê o snapshot mais recente de VeloHubCentral/console_config/module_status (mesma
 * coleção que alimenta o "mostrador de serviços" do VeloHub). O documento é um
 * singleton (_id: "status") atualizado in-place, com a lista de serviços em
 * `servicos: [{ key, nome, status, ordem }, ...]`.
 *
 * Formato antigo (campos soltos prefixados com "_", ex.: "_pessoal": "on") não é mais
 * usado pelo VeloHub — se `servicos` não existir, caímos nesse formato como fallback
 * só por segurança, mas não deveria mais ocorrer em produção.
 *
 * A lista de módulos NÃO é fixa aqui: vem inteira do array `servicos`, então um módulo
 * novo/removido no VeloHub aparece/some do Painel 360° sem precisar mexer no Desk.
 */
import { getConsoleConfigConnection, isConsoleConfigConnected } from '../config/database';

const COLLECTION_NAME = 'module_status';

export type ModuleStatusValue = 'on' | 'off' | 'revisao' | string;

export interface ModuleStatusItem {
  key: string;
  label: string;
  status: ModuleStatusValue;
}

function moduleStatusCollection() {
  return getConsoleConfigConnection().db!.collection(COLLECTION_NAME);
}

/** "_pgtoAntecip" → "Pgto Antecip" — genérico, sem dicionário por módulo. */
function labelFromFieldKey(field: string): string {
  const withoutPrefix = field.replace(/^_/, '');
  const spaced = withoutPrefix.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function getModuleStatusItems(): Promise<ModuleStatusItem[]> {
  if (!isConsoleConfigConnected()) return [];

  const doc = await moduleStatusCollection().findOne({}, { sort: { createdAt: -1 } });
  if (!doc) return [];

  const servicos = (doc as Record<string, unknown>).servicos;
  if (Array.isArray(servicos)) {
    return servicos
      .map((item) => {
        const s = (item ?? {}) as Record<string, unknown>;
        const key = String(s.key ?? '').trim();
        return {
          key,
          label: String(s.nome ?? '').trim() || labelFromFieldKey(key),
          status: String(s.status ?? ''),
        };
      })
      .filter((item) => item.label);
  }

  // Fallback — formato antigo (campos soltos prefixados com "_"). Nunca deveria
  // ser necessário em produção; mantido só por segurança durante a transição.
  return Object.keys(doc)
    .filter((key) => key.startsWith('_') && key !== '_id' && key !== '__v')
    .map((key) => ({
      key: key.replace(/^_/, ''),
      label: labelFromFieldKey(key),
      status: String((doc as Record<string, unknown>)[key] ?? ''),
    }))
    .filter((item) => item.label);
}
