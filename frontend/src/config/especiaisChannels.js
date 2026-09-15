/**
 * Canais do perfil Especiais
 */
import { getEspeciaisChannelTheme } from './especiaisTheme';

export const ESPECIAIS_CHANNELS = [
  {
    id: 'reclame-aqui',
    label: 'Reclame Aqui',
    desc: 'Reclamações publicadas no Reclame Aqui',
    icon: 'ti-messages',
    color: getEspeciaisChannelTheme('reclame-aqui').accent,
  },
  {
    id: 'procon',
    label: 'Procon',
    desc: 'Demandas e reclamações registradas no Procon',
    icon: 'ti-building-community',
    color: getEspeciaisChannelTheme('procon').accent,
  },
  {
    id: 'consumidor-gov',
    label: 'Consumidor.Gov',
    desc: 'Atendimentos do portal Consumidor.gov.br',
    icon: 'ti-world',
    color: getEspeciaisChannelTheme('consumidor-gov').accent,
  },
  {
    id: 'bacen',
    label: 'Bacen',
    desc: 'Demandas e reclamações do Banco Central',
    icon: 'ti-building-bank',
    color: getEspeciaisChannelTheme('bacen').accent,
  },
  {
    id: 'processos',
    label: 'Processos',
    desc: 'Acompanhamento de processos judiciais e administrativos',
    icon: 'ti-briefcase',
    color: '#B45309',
  },
  {
    id: 'redes-sociais',
    label: 'Redes Sociais',
    desc: 'Atendimento e monitoramento das redes sociais',
    icon: 'ti-device-desktop',
    color: '#0EA5E9',
  },
];

const LEGACY_CHANNEL_IDS = {
  'procon-bacen': 'procon',
};

const CHANNEL_MAP = Object.fromEntries(ESPECIAIS_CHANNELS.map((c) => [c.id, c]));

export function resolveEspeciaisChannelId(id) {
  const raw = String(id || '').trim();
  return LEGACY_CHANNEL_IDS[raw] || raw;
}

export function getEspeciaisChannel(id) {
  const resolved = resolveEspeciaisChannelId(id);
  return CHANNEL_MAP[resolved] || null;
}

export function isEspeciaisChannelId(id) {
  return Boolean(getEspeciaisChannel(id));
}

const STORAGE_KEY = 'velodeskEspeciaisChannel';

export function readEspeciaisChannel() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const resolved = resolveEspeciaisChannelId(saved);
    return isEspeciaisChannelId(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export function persistEspeciaisChannel(channelId) {
  const resolved = resolveEspeciaisChannelId(channelId);
  if (!isEspeciaisChannelId(resolved)) return;
  localStorage.setItem(STORAGE_KEY, resolved);
}

export function clearEspeciaisChannel() {
  localStorage.removeItem(STORAGE_KEY);
}
