/**
 * ConsultaStatusChip v1.0.0 — pill de status compartilhada pelas telas de Consultas
 * VERSION: v1.0.0 | DATE: 2026-09-22
 */
import React from 'react';
import { CONSULTA_STATUS_TONE, classifyConsultaStatusLabel } from '../../../services/desk/consultaFormatters';

export const ICON_BY_STATE = {
  done: 'ti-circle-check',
  pending: 'ti-clock',
  canceled: 'ti-circle-x',
  none: 'ti-minus',
};

export function StatusChip({ label, tone }) {
  if (!label) return null;
  const resolvedTone = tone || CONSULTA_STATUS_TONE[classifyConsultaStatusLabel(label)] || 'gray';
  return <span className={`crm-consultas-product__status-pill crm-consultas-product__status-pill--${resolvedTone}`}>{label}</span>;
}
