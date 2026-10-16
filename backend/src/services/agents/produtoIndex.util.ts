/**
 * produtoIndex.util v1.0.0 — descobre o produto de um ticket SEM chamada de IA.
 *
 * Ordem: (1) produto/motivo que a ORIGEM do ticket enviou, validados contra o catálogo ativo;
 * (2) varredura mecânica do texto (assunto + mensagens do cliente) procurando o nome de algum
 * produto da árvore de tabulação. Só devolve produto quando for inequívoco (exatamente um);
 * ambíguo ou ausente ⇒ o chamador cai na classificação por LLM, como hoje.
 *
 * Indexação por frase inteira do nome do produto (sem acento/caixa/pontuação, palavra inteira,
 * plural tolerado) — não inventa sinônimos: só reconhece o que está escrito no catálogo.
 */
import type { TabulationActiveDto } from '../tabulation.service';
import { validateTabulationResult } from './agentTabulation.util';

export type ProdutoHintFonte = 'origem' | 'indice';

export interface ProdutoHint {
  fonte: ProdutoHintFonte;
  produto: string;
  /** Só vem preenchido quando a origem enviou motivo válido dentro do produto. */
  motivo: string;
  /** Trecho do texto que disparou o índice (vazio quando a fonte é a origem). */
  trecho: string;
}

export interface ProdutoIndexResult {
  status: 'unico' | 'ambiguo' | 'nenhum';
  produto?: string;
  trecho?: string;
  candidatos: string[];
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Plural tolerado nos dois lados ("seguros" ↔ "seguro"): remove 's' final de palavras longas. */
function stemTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function activeProductNames(config: TabulationActiveDto): string[] {
  return (config.produtos || [])
    .filter((p) => p.ativo !== false)
    .map((p) => p.produto)
    .filter(Boolean);
}

export function detectProdutoNoTexto(texto: string, config: TabulationActiveDto): ProdutoIndexResult {
  const textTokens = stemTokens(normalize(texto));
  if (!textTokens.length) return { status: 'nenhum', candidatos: [] };
  const haystack = ` ${textTokens.join(' ')} `;

  const hits: Array<{ produto: string; phrase: string }> = [];
  for (const produto of activeProductNames(config)) {
    const phrase = stemTokens(normalize(produto)).join(' ');
    if (!phrase) continue;
    if (haystack.includes(` ${phrase} `)) hits.push({ produto, phrase });
  }

  // Nome contido em outro nome já encontrado ("Antecipação" dentro de "Antecipação do Salário")
  // não conta — vale o mais específico.
  const specific = hits.filter(
    (h) => !hits.some((o) => o !== h && o.phrase.length > h.phrase.length && ` ${o.phrase} `.includes(` ${h.phrase} `)),
  );

  if (!specific.length) return { status: 'nenhum', candidatos: [] };
  if (specific.length > 1) return { status: 'ambiguo', candidatos: specific.map((h) => h.produto) };
  return { status: 'unico', produto: specific[0].produto, trecho: specific[0].phrase, candidatos: [specific[0].produto] };
}

/**
 * Produto "de graça" para um ticket: origem primeiro, índice depois. Retorna null quando não
 * há produto confiável (nesse caso a classificação por LLM continua sendo a primeira leitura).
 */
export function resolveProdutoHint(
  params: {
    tabulacaoOrigem?: { produto?: string; motivo?: string } | null;
    texto: string;
  },
  config: TabulationActiveDto,
): ProdutoHint | null {
  const origemProduto = String(params.tabulacaoOrigem?.produto ?? '').trim();
  if (origemProduto) {
    const validated = validateTabulationResult(
      { produto: origemProduto, motivo: String(params.tabulacaoOrigem?.motivo ?? '').trim() },
      config,
    );
    if (validated.produto) {
      return { fonte: 'origem', produto: validated.produto, motivo: validated.motivo || '', trecho: '' };
    }
  }

  const found = detectProdutoNoTexto(params.texto, config);
  if (found.status === 'unico' && found.produto) {
    return { fonte: 'indice', produto: found.produto, motivo: '', trecho: found.trecho ?? '' };
  }
  return null;
}
