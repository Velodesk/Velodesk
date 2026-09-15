/**
 * casosEspeciaisExtracaoBacenPersona v1.0.0 — Agente 5, extração de campos do Bacen
 */
import { buildCasosEspeciaisExtracaoPersona } from './casosEspeciaisExtracaoBase';

export function getCasosEspeciaisExtracaoBacenPersona(): string {
  return buildCasosEspeciaisExtracaoPersona({
    canalLabel: 'Bacen',
    protocoloHint:
      'número da demanda/RDR (Registro de Demandas) do Banco Central, geralmente citado como '
      + '"número da demanda", "RDR" ou "protocolo Bacen"',
    notasEspecificas:
      'Este ticket já passou por um parser determinístico que tenta reconhecer o template padrão '
      + 'de e-mail do RDR do Bacen; se você está recebendo este texto para extração, é porque o '
      + 'e-mail não bateu exatamente nesse template (variação de formatação, encaminhamento, corpo '
      + 'colado sem HTML original, etc.) — extraia pelo que conseguir entender do texto livre.',
  });
}
