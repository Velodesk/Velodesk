/**
 * casosEspeciaisExtracaoProconPersona v1.0.0 — Agente 5, extração de campos do Procon
 */
import { buildCasosEspeciaisExtracaoPersona } from './casosEspeciaisExtracaoBase';

export function getCasosEspeciaisExtracaoProconPersona(): string {
  return buildCasosEspeciaisExtracaoPersona({
    canalLabel: 'Procon',
    protocoloHint:
      'número do processo/reclamação/CIP no Procon (às vezes chamado de "nº do processo", '
      + '"protocolo", "CIP", "registro")',
    notasEspecificas:
      'Procons de estados e municípios diferentes NÃO seguem um template fixo de e-mail — cada '
      + 'unidade (Procon-SP, Procon-RJ, Procon municipal, etc.) formata a notificação à sua '
      + 'maneira. Por isso a extração precisa ser por compreensão do texto, nunca por posição fixa '
      + 'de coluna/linha.',
  });
}
