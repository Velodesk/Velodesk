/**
 * casosEspeciaisExtracaoConsumidorGovPersona v1.0.0 — Agente 5, extração de campos do Consumidor.gov
 */
import { buildCasosEspeciaisExtracaoPersona } from './casosEspeciaisExtracaoBase';

export function getCasosEspeciaisExtracaoConsumidorGovPersona(): string {
  return buildCasosEspeciaisExtracaoPersona({
    canalLabel: 'Consumidor.gov',
    protocoloHint:
      'número de protocolo da plataforma Consumidor.gov.br, geralmente no formato '
      + '"AAAA.MM/NNNNNNNNN" (ex.: 2026.07/00015790834), às vezes citado no assunto do e-mail como '
      + '"CGOV - <protocolo>"',
    notasEspecificas:
      'Este ticket já passou por um parser determinístico que reconhece o template oficial de '
      + 'e-mail do Consumidor.gov; se você está recebendo este texto para extração, é porque o '
      + 'e-mail não bateu exatamente nesse template — extraia pelo que conseguir entender do texto livre.',
  });
}
