/**
 * Caixas customizadas — filtros multi-critério (desk_agent_boxes)
 * VERSION: v2.2.0 | DATE: 2026-07-31
 */
import { QUEUE_STATUSES } from './constants';
import { addCustomBox } from '../ticketsCache';
import { agentQueueBoxesApi } from '../../api/client';
import { isApiMode } from '../ticketsCache';
import { isBackendJwtUsable } from '../../utils/backendJwt';
import { normalizeCriterioRow } from './customQueueBoxCriteria';

const STORAGE_KEY = 'velodeskCustomQueues';
const MIGRATED_FLAG_KEY = 'velodeskCustomQueuesMigrated';

export const QUEUE_BOX_ACTIONS = [
  { id: 'novos', label: 'Receber tickets novos' },
  { id: 'em-andamento', label: 'Manter em andamento' },
  { id: 'pendente', label: 'Aguardar retorno / pendência' },
  { id: 'resolvidos', label: 'Encaminhar para resolvidos' },
  { id: 'notificar', label: 'Notificar supervisor' },
];

const ACTION_DOTS = {
  novos: '#1634FF',
  'em-andamento': '#15A237',
  pendente: '#FCC200',
  resolvidos: '#9ca3af',
  notificar: '#ea580c',
};

let queuesCache = null;
let hydratePromise = null;

function slugify(value) {
  return String(value || 'caixa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'caixa';
}

function readStorageOnly() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function normalizeCriterios(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCriterioRow).filter(Boolean);
}

function normalizeBox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.boxId || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  const action = QUEUE_BOX_ACTIONS.some((item) => item.id === raw.action) ? raw.action : 'em-andamento';
  const actionMeta = QUEUE_BOX_ACTIONS.find((item) => item.id === action);
  const criterios = normalizeCriterios(raw.criterios);
  return {
    id,
    name,
    action,
    actionLabel: String(raw.actionLabel || actionMeta?.label || action),
    dot: String(raw.dot || ACTION_DOTS[action] || '#6366f1'),
    boxes: Array.isArray(raw.boxes) && raw.boxes.length ? raw.boxes.map(String) : [id],
    isCustom: raw.isCustom !== false,
    criterios,
    virtual: true,
  };
}

function setQueuesCache(list) {
  queuesCache = (list || []).map(normalizeBox).filter(Boolean);
  writeStorage(queuesCache);
  return queuesCache;
}

function canUseRemotePersistence() {
  const token = localStorage.getItem('velodesk_token');
  return isApiMode() && isBackendJwtUsable(token);
}

export function loadCustomQueues() {
  if (Array.isArray(queuesCache)) return queuesCache;
  queuesCache = readStorageOnly().map(normalizeBox).filter(Boolean);
  return queuesCache;
}

export function saveCustomQueues(list) {
  return setQueuesCache(list);
}

export function getAllQueueStatuses() {
  return [...QUEUE_STATUSES, ...loadCustomQueues()];
}

export function getCustomQueueById(queueId) {
  return loadCustomQueues().find((item) => item.id === queueId) || null;
}

export function isCustomQueueId(queueId) {
  return Boolean(getCustomQueueById(queueId));
}

function buildLocalBox({ name, action, boxId, criterios, dot }) {
  const trimmedName = String(name || '').trim();
  const actionId = QUEUE_BOX_ACTIONS.some((item) => item.id === action) ? action : 'em-andamento';
  const id = String(boxId || '').trim() || `custom-${slugify(trimmedName)}-${Date.now().toString(36)}`;
  const actionMeta = QUEUE_BOX_ACTIONS.find((item) => item.id === actionId);
  return {
    id,
    name: trimmedName,
    action: actionId,
    actionLabel: actionMeta?.label || actionId,
    dot: String(dot || ACTION_DOTS[actionId] || '#6366f1'),
    boxes: [id],
    isCustom: true,
    criterios: normalizeCriterios(criterios),
    virtual: true,
  };
}

export async function fetchAndHydrateCustomQueues() {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const local = readStorageOnly().map(normalizeBox).filter(Boolean);

    if (!canUseRemotePersistence()) {
      setQueuesCache(local);
      restoreCustomBoxes();
      return loadCustomQueues();
    }

    try {
      let remote = await agentQueueBoxesApi.list();
      remote = (remote || []).map(normalizeBox).filter(Boolean);

      const alreadyMigrated = localStorage.getItem(MIGRATED_FLAG_KEY) === '1';
      if (!remote.length && local.length && !alreadyMigrated) {
        const migrated = await agentQueueBoxesApi.migrate(
          local.map((box) => ({
            boxId: box.id,
            name: box.name,
            action: box.action,
            criterios: box.criterios?.length
              ? box.criterios
              : [{ tipo: 'status', campo: 'status', operador: 'equals', valor: 'em-andamento' }],
          })),
        );
        remote = (migrated?.boxes || []).map(normalizeBox).filter(Boolean);
      }
      localStorage.setItem(MIGRATED_FLAG_KEY, '1');

      setQueuesCache(remote);
      restoreCustomBoxes();
      return loadCustomQueues();
    } catch (err) {
      console.warn('[customQueueBoxes] falha ao carregar do servidor — usando cache local', err?.message || err);
      setQueuesCache(local);
      restoreCustomBoxes();
      return loadCustomQueues();
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

export async function createCustomQueueBox({ name, action, criterios, dot }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Nome da caixa é obrigatório');
  const normalizedCriterios = normalizeCriterios(criterios);
  if (!normalizedCriterios.length) throw new Error('Informe ao menos um critério de filtragem');

  let box = buildLocalBox({ name: trimmedName, action, criterios: normalizedCriterios, dot });

  if (canUseRemotePersistence()) {
    const saved = await agentQueueBoxesApi.create({
      boxId: box.id,
      name: box.name,
      action: box.action,
      criterios: box.criterios,
      dot: box.dot,
    });
    const normalized = normalizeBox(saved);
    if (normalized) box = normalized;
  }

  const next = [...loadCustomQueues().filter((item) => item.id !== box.id), box];
  saveCustomQueues(next);
  addCustomBox({ id: box.id, name: box.name, action: box.action });

  return box;
}

export async function updateCustomQueueBox(boxId, { name, action, criterios, dot }) {
  const id = String(boxId || '').trim();
  if (!id) throw new Error('Caixa inválida');
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Nome da caixa é obrigatório');
  const normalizedCriterios = normalizeCriterios(criterios);
  if (!normalizedCriterios.length) throw new Error('Informe ao menos um critério de filtragem');

  let box = buildLocalBox({ name: trimmedName, action, boxId: id, criterios: normalizedCriterios, dot });

  if (canUseRemotePersistence()) {
    const saved = await agentQueueBoxesApi.update(id, {
      name: box.name,
      action: box.action,
      criterios: box.criterios,
      dot: box.dot,
    });
    const normalized = normalizeBox(saved);
    if (normalized) box = normalized;
  }

  const next = loadCustomQueues().map((item) => (item.id === id ? box : item));
  if (!next.some((item) => item.id === id)) next.push(box);
  saveCustomQueues(next);
  addCustomBox({ id: box.id, name: box.name, action: box.action });
  return box;
}

export async function deleteCustomQueueBox(boxId) {
  const id = String(boxId || '').trim();
  if (!id) return false;

  // Se a caixa existir no servidor mas a exclusão remota não puder ser confirmada,
  // remover só do cache local faria a caixa "voltar" na próxima sincronização.
  if (canUseRemotePersistence()) {
    await agentQueueBoxesApi.remove(id);
  } else if (isApiMode()) {
    throw new Error('Sessão indisponível para excluir a caixa no servidor. Faça login novamente e tente de novo.');
  }

  const next = loadCustomQueues().filter((item) => item.id !== id);
  saveCustomQueues(next);
  return true;
}

export function getQueueActionLabel(queueId) {
  const custom = getCustomQueueById(queueId);
  if (custom?.actionLabel) return custom.actionLabel;
  return null;
}

export function restoreCustomBoxes() {
  loadCustomQueues().forEach((box) => {
    addCustomBox({ id: box.id, name: box.name, action: box.action });
  });
}
