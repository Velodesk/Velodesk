/**
 * atendimentoRevisaoPersona v1.4.0 — revisão só núcleo (envelope fora da IA)
 * VERSION: v1.4.0 | DATE: 2026-08-10
 */
import { getAtendimentoPersona } from './atendimentoPersona';
import { getAgentNomeOficial } from '../agentRegistry';

export interface RevisaoPersonaParams {
  origemRevisao: 'automatica_baixo_compliance' | 'solicitada_operador' | 'reprovada_humano';
  inputOperador?: string;
  violacoes?: string[];
  recomendacoes?: string[];
  respostaAnterior?: string;
  isPrimeiroContato?: boolean;
  canal?: string;
  clientFirstName?: string;
}

export function getAtendimentoRevisaoPersona(params: RevisaoPersonaParams): string {
  const base = getAtendimentoPersona();
  const origemLabel = params.origemRevisao === 'solicitada_operador'
    ? 'solicitada_operador: o agente humano solicitou revisão. Considere OBRIGATORIAMENTE o input do operador.'
    : params.origemRevisao === 'reprovada_humano'
      ? 'reprovada_humano: um auditor humano REPROVOU esta resposta antes do envio ao cliente. Se houver input do operador, ele é o feedback do auditor e deve ser considerado OBRIGATORIAMENTE; sem input, reescreva buscando mais aderência ao POP, clareza e precisão.'
      : `automatica_baixo_compliance: o ${getAgentNomeOficial(2)} atribuiu score abaixo do threshold. Corrija as violações e recomendações listadas — use-as como feedback obrigatório de aprendizado — sem alterar o que já estava correto.`;

  const extraBlocks: string[] = [
    '',
    '# MODO REVISÃO',
    '',
    'Você está em modo REVISÃO. Uma resposta anterior foi reprovada ou solicitada para melhoria.',
    '',
    'Prioridades da revisão:',
    '- Corrigir violações e recomendacoes da auditoria / input do operador.',
    '- Eliminar eco ou paráfrase da pergunta/reclamação do cliente.',
    '- Eliminar saudação, apresentação, protocolo, CTA, despedida ou assinatura do núcleo.',
    '- Manter SOMENTE conteúdo operacional direto (POP) em parágrafos com quebras de linha.',
    '- NÃO confundir anti-eco com remover conteúdo operacional legítimo.',
    '',
    `## Origem da revisão: ${origemLabel}`,
    '',
    '## ENVELOPE (FORA DA IA)',
    '',
    'Abertura mecânica (saudação + apresentação no 1º contato) e fechamento visual (protocolo, CTA, assinatura) são montados pelo sistema — NÃO inclua em respostaSugerida.',
    params.isPrimeiroContato
      ? 'Este chamado ainda não tem mensagem pública do agente — mesmo assim, retorne só o núcleo; a abertura será injetada no composer.'
      : 'Conversa em andamento — retorne só o núcleo, sem saudação nem apresentação.',
  ];

  if (params.canal?.trim()) {
    extraBlocks.push('', `## Canal: ${params.canal.trim()}`);
  }

  if (params.inputOperador?.trim()) {
    extraBlocks.push('', '## Input do operador (OBRIGATÓRIO considerar)', '', params.inputOperador.trim());
  }
  if (params.violacoes?.length) {
    extraBlocks.push('', '## Violações a corrigir', '', params.violacoes.map((v) => `- ${v}`).join('\n'));
  }
  if (params.recomendacoes?.length) {
    extraBlocks.push('', '## Recomendações da auditoria', '', params.recomendacoes.map((r) => `- ${r}`).join('\n'));
  }
  if (params.respostaAnterior?.trim()) {
    extraBlocks.push(
      '',
      '## Resposta anterior (referência — melhorar núcleo, não repetir erros; remover envelope se presente)',
      '',
      params.respostaAnterior.trim(),
    );
  }

  return base + extraBlocks.join('\n');
}
