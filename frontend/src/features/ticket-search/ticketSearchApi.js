/**
 * Client HTTP da Busca de Tickets
 * VERSION: v1.1.0 | DATE: 2026-10-02
 */
import { ticketSearchApi } from '../../api/client';

/**
 * @param {{ criterios: Array, limit?: number, incluirLegadoOcta?: boolean }} params
 * @returns {Promise<{ success: boolean, tickets: Array, total: number, limit: number, message?: string, legadoOcta?: { incluido: boolean, total: number, aviso?: string } }>}
 */
export async function searchTicketsApi({ criterios, limit = 100 } = {}) {
  return ticketSearchApi.search({ criterios, limit });
}
