/**
 * ia v1.0.0 — devolutiva sugerida por IA para a coluna "Devolutiva"
 *
 * Uma única chamada por rodada, com todos os casos que não passaram. Se não
 * houver chave configurada, ou se a chamada falhar, cai na orientação base do
 * catálogo (src/orientacoes.ts) — a coluna nunca fica vazia.
 *
 * Usa a mesma configuração de IA do projeto: OPENAI_API_KEY / OPENAI_MODEL e,
 * como alternativa, GEMINI_API_KEY / GEMINI_MODEL.
 */
import { opt } from './config';
import { orientacaoBase } from './orientacoes';
import type { Resultado } from './resultado';

/** Ordem de prioridade quando é preciso cortar a lista enviada à IA. */
const PESO: Record<string, number> = {
  Nao: 0,
  Bloqueado: 1,
  Parcial: 2,
  'Falha conhecida': 3,
  'Nao testado': 4,
  'Nao testavel': 5,
  Sim: 9,
};

const MAX_CASOS = 25;
const LIMITE_CARACTERES = 260;

const INSTRUCAO = [
  'Você é o revisor de QA do Velodesk, um CRM de atendimento de uma fintech brasileira.',
  'Para cada caso de teste que não passou, escreva UMA orientação curta de correção para o time de desenvolvimento.',
  'Regras:',
  '- Português do Brasil, tom direto e profissional, no imperativo ("confira", "reative", "verifique").',
  '- No máximo 240 caracteres por orientação. Uma frase, no máximo duas.',
  '- Diga ONDE olhar primeiro e por que aquilo importa para a operação. Seja concreto.',
  '- Não repita a observação que já está na planilha e não reescreva o problema: vá direto ao que fazer.',
  '- Se o caso está bloqueado ou não testado, diga o que precisa existir para ele voltar a ser testável.',
  '- Se a situação é "Falha conhecida", oriente a acompanhar a correção já mapeada, sem tratar como novidade.',
  '- Nunca invente nome de arquivo, rota ou variável que não esteja no contexto recebido.',
  'Responda apenas com JSON no formato {"devolutivas":[{"id":"S01","texto":"..."}]}.',
].join('\n');

interface CasoParaIa {
  id: string;
  area: string;
  funcionalidade: string;
  esperado: string;
  situacao: string;
  observacao: string;
  orientacaoBase: string;
}

function montarCasos(resultados: Resultado[]): CasoParaIa[] {
  return resultados
    .filter((r) => r.situacao !== 'Sim')
    .sort((a, b) => (PESO[a.situacao] ?? 8) - (PESO[b.situacao] ?? 8))
    .slice(0, MAX_CASOS)
    .map((r) => ({
      id: r.caso.id,
      area: r.caso.area,
      funcionalidade: r.caso.funcionalidade,
      esperado: r.caso.esperado,
      situacao: r.situacao,
      observacao: r.observacao.slice(0, 400),
      orientacaoBase: orientacaoBase(r.caso.id),
    }));
}

function limpar(texto: unknown): string {
  const t = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.length > LIMITE_CARACTERES ? `${t.slice(0, LIMITE_CARACTERES - 1).trimEnd()}…` : t;
}

function extrairJson(bruto: string): Array<{ id?: string; texto?: string }> {
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return [];
  const dados = JSON.parse(bruto.slice(inicio, fim + 1));
  const lista = Array.isArray(dados?.devolutivas) ? dados.devolutivas : [];
  return lista;
}

async function chamarOpenai(instrucao: string, payload: unknown, chave: string, modelo: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: instrucao },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`OpenAI respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body: any = await res.json();
  return String(body?.choices?.[0]?.message?.content ?? '');
}

async function chamarGemini(instrucao: string, payload: unknown, chave: string, modelo: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelo,
  )}:generateContent?key=${encodeURIComponent(chave)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instrucao }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Gemini respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body: any = await res.json();
  return String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

export interface Devolutivas {
  /** id do caso → texto da devolutiva */
  textos: Map<string, string>;
  /** 'ia' quando a sugestão veio do modelo, 'catalogo' quando é a orientação base. */
  fonte: 'ia' | 'catalogo';
  /** Preenchido quando a IA foi tentada e não deu — vai para o log e para o resumo. */
  aviso?: string;
}

/**
 * Monta a devolutiva de cada caso que não passou. Só passa "Sim" quando não há
 * nada a corrigir — nesse caso a coluna fica em branco.
 */
export async function gerarDevolutivas(resultados: Resultado[]): Promise<Devolutivas> {
  const casos = montarCasos(resultados);
  const textos = new Map<string, string>();

  // Base garantida: todo caso que não passou já sai com orientação do catálogo.
  for (const r of resultados) {
    if (r.situacao === 'Sim') continue;
    textos.set(r.caso.id, orientacaoBase(r.caso.id));
  }

  if (!casos.length) return { textos, fonte: 'catalogo' };

  const desativada = ['1', 'true', 'sim'].includes(opt('QA_IA_DESATIVADA').toLowerCase());
  if (desativada) return { textos, fonte: 'catalogo' };

  const chaveOpenai = opt('OPENAI_API_KEY');
  const chaveGemini = opt('GEMINI_API_KEY') || opt('GOOGLE_API_KEY');
  if (!chaveOpenai && !chaveGemini) {
    return {
      textos,
      fonte: 'catalogo',
      aviso: 'Sem OPENAI_API_KEY ou GEMINI_API_KEY: a devolutiva saiu da orientação base do catálogo.',
    };
  }

  try {
    const bruto = chaveOpenai
      ? await chamarOpenai(INSTRUCAO, { casos }, chaveOpenai, opt('QA_IA_MODELO') || opt('OPENAI_MODEL', 'gpt-4.1-mini'))
      : await chamarGemini(INSTRUCAO, { casos }, chaveGemini, opt('QA_IA_MODELO') || opt('GEMINI_MODEL', 'gemini-2.5-flash'));

    const lista = extrairJson(bruto);
    let aproveitadas = 0;
    for (const item of lista) {
      const id = String(item?.id ?? '').trim().toUpperCase();
      const texto = limpar(item?.texto);
      if (!id || !texto || !textos.has(id)) continue;
      textos.set(id, texto);
      aproveitadas += 1;
    }
    if (!aproveitadas) {
      return { textos, fonte: 'catalogo', aviso: 'A IA respondeu sem nenhuma devolutiva aproveitável.' };
    }
    return { textos, fonte: 'ia' };
  } catch (err) {
    return {
      textos,
      fonte: 'catalogo',
      aviso: `Não foi possível gerar a devolutiva por IA (${
        err instanceof Error ? err.message : String(err)
      }); a coluna usou a orientação base do catálogo.`,
    };
  }
}

/**
 * revisarMensageria v1.0.0 — caso E07: qualidade do texto dos e-mails automáticos
 *
 * Diferente da devolutiva, aqui não há orientação base de fallback — é um
 * julgamento de texto que só a IA faz. Sem chave, ou se a chamada falhar, o
 * caso E07 sai como Bloqueado (não "Sim" por omissão: sem revisão, não dá
 * para afirmar que o texto está correto).
 */
const INSTRUCAO_MENSAGERIA = [
  'Você é o revisor de mensageria do Velodesk, um CRM de atendimento de uma fintech brasileira.',
  'Vai receber a lista de modelos de e-mail automático ATIVOS (nome, saudação, corpo e o tipo de gatilho).',
  'Contexto importante que você não vê no texto de cada modelo, mas que o sistema aplica IGUAL em',
  'todo e-mail enviado, sem exceção: depois do corpo, todo e-mail recebe automaticamente um convite',
  'fixo — "É só responder este e-mail. A sua mensagem chega direto para quem está cuidando do seu',
  'caso." — seguido da assinatura institucional "Time de Atendimento Velotax".',
  'Sua tarefa: apontar, para cada modelo, se o texto dele soa estranho, contraditório ou com',
  'instrução errada quando combinado com esse convite fixo e essa assinatura. Exemplos do que',
  'procurar (não são os únicos): um modelo do tipo pesquisa/avaliação (csat) pedindo para o cliente',
  '"responder o e-mail" quando a ação esperada é clicar num link de nota; um modelo cujo texto fala',
  'na primeira pessoa do singular ("eu", "gostaria") de um jeito que destoa da assinatura em nome de',
  'um time; instrução de resposta que não faz sentido para o tipo de aviso; saudação e corpo que se',
  'contradizem; erro de português que muda o sentido da frase.',
  'Não aponte problema de formatação HTML nem estilo visual — só o texto e o sentido.',
  'Se um modelo estiver correto, não o inclua nos achados.',
  'Responda apenas com JSON no formato {"achados":[{"nome":"Nome do modelo","problema":"..."}]}.',
  'Cada "problema" deve ter no máximo 220 caracteres, uma frase direta dizendo o que ajustar.',
  'Se nenhum modelo tiver problema, responda {"achados":[]}.',
].join('\n');

export interface TemplateParaIa {
  nome: string;
  saudacao: string;
  corpo: string;
  tipoGatilho: string;
}

export interface RevisaoMensageria {
  achados: Array<{ nome: string; problema: string }>;
  /** Preenchido quando a revisão não pôde ser feita — o caso sai como Bloqueado. */
  erro?: string;
}

function extrairAchados(bruto: string): Array<{ nome?: string; problema?: string }> {
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return [];
  const dados = JSON.parse(bruto.slice(inicio, fim + 1));
  return Array.isArray(dados?.achados) ? dados.achados : [];
}

/**
 * revisarEmailsReais v1.0.0 — caso E08: e-mail de verdade que saiu para cliente
 *
 * Igual à E07, mas em vez do modelo cadastrado, revisa uma amostra pequena de
 * e-mails que REALMENTE saíram para cliente (nunca ticket de QA). O nome do
 * cliente já chega redigido (trocado por "[cliente]") — esta função nunca
 * deve receber CPF, nome real ou qualquer outro dado que identifique a
 * pessoa; quem monta a amostra em checks/mensageria.ts é responsável por
 * isso antes de chamar aqui.
 */
const INSTRUCAO_EMAILS_REAIS = [
  'Você é o revisor de mensageria do Velodesk, um CRM de atendimento de uma fintech brasileira.',
  'Vai receber uma amostra pequena de e-mails automáticos que JÁ FORAM ENVIADOS de verdade para',
  'clientes reais (o nome do cliente foi trocado por "[cliente]" antes de chegar até você — não tente',
  'adivinhar quem é, isso não importa para a revisão).',
  'Contexto importante que não aparece no texto, mas que o sistema aplica igual em todo e-mail',
  'enviado, sem exceção: depois do corpo, todo e-mail recebe automaticamente um convite fixo — "É só',
  'responder este e-mail. A sua mensagem chega direto para quem está cuidando do seu caso." — seguido',
  'da assinatura institucional "Time de Atendimento Velotax".',
  'Sua tarefa: apontar, para cada item da amostra, se o texto que foi enviado soa estranho,',
  'contraditório, incompleto ou com instrução errada — considerando também como ele combina com o',
  'convite fixo e a assinatura acima. Não aponte nada sobre o nome do cliente ter sido trocado por',
  '"[cliente]" — isso é só uma proteção de privacidade desta revisão, não um erro do e-mail de verdade.',
  'Se um item estiver correto, não o inclua nos achados.',
  'Responda apenas com JSON no formato {"achados":[{"referencia":"protocolo ou modelo recebido",',
  '"problema":"..."}]}. Cada "problema" tem no máximo 220 caracteres, uma frase direta.',
  'Se nenhum item tiver problema, responda {"achados":[]}.',
].join('\n');

export interface AmostraParaIa {
  referencia: string;
  modelo: string;
  textoRedigido: string;
}

export async function revisarEmailsReais(amostras: AmostraParaIa[]): Promise<RevisaoMensageria> {
  const desativada = ['1', 'true', 'sim'].includes(opt('QA_IA_DESATIVADA').toLowerCase());
  if (desativada) return { achados: [], erro: 'QA_IA_DESATIVADA está ativo — revisão de e-mail real pulada.' };

  const chaveOpenai = opt('OPENAI_API_KEY');
  const chaveGemini = opt('GEMINI_API_KEY') || opt('GOOGLE_API_KEY');
  if (!chaveOpenai && !chaveGemini) {
    return { achados: [], erro: 'Sem OPENAI_API_KEY ou GEMINI_API_KEY — a revisão de e-mail real exige IA, não tem orientação base de reserva.' };
  }

  try {
    const bruto = chaveOpenai
      ? await chamarOpenai(INSTRUCAO_EMAILS_REAIS, { amostras }, chaveOpenai, opt('QA_IA_MODELO') || opt('OPENAI_MODEL', 'gpt-4.1-mini'))
      : await chamarGemini(INSTRUCAO_EMAILS_REAIS, { amostras }, chaveGemini, opt('QA_IA_MODELO') || opt('GEMINI_MODEL', 'gemini-2.5-flash'));

    const lista = extrairAchados(bruto);
    const achados = lista
      .map((item: any) => ({ nome: String(item?.referencia ?? '').trim(), problema: limpar(item?.problema) }))
      .filter((item) => item.nome && item.problema);
    return { achados };
  } catch (err) {
    return {
      achados: [],
      erro: `chamada à IA falhou (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

export async function revisarMensageria(templates: TemplateParaIa[]): Promise<RevisaoMensageria> {
  const desativada = ['1', 'true', 'sim'].includes(opt('QA_IA_DESATIVADA').toLowerCase());
  if (desativada) return { achados: [], erro: 'QA_IA_DESATIVADA está ativo — revisão de mensageria pulada.' };

  const chaveOpenai = opt('OPENAI_API_KEY');
  const chaveGemini = opt('GEMINI_API_KEY') || opt('GOOGLE_API_KEY');
  if (!chaveOpenai && !chaveGemini) {
    return { achados: [], erro: 'Sem OPENAI_API_KEY ou GEMINI_API_KEY — a revisão de mensageria exige IA, não tem orientação base de reserva.' };
  }

  try {
    const bruto = chaveOpenai
      ? await chamarOpenai(INSTRUCAO_MENSAGERIA, { templates }, chaveOpenai, opt('QA_IA_MODELO') || opt('OPENAI_MODEL', 'gpt-4.1-mini'))
      : await chamarGemini(INSTRUCAO_MENSAGERIA, { templates }, chaveGemini, opt('QA_IA_MODELO') || opt('GEMINI_MODEL', 'gemini-2.5-flash'));

    const lista = extrairAchados(bruto);
    const achados = lista
      .map((item) => ({ nome: String(item?.nome ?? '').trim(), problema: limpar(item?.problema) }))
      .filter((item) => item.nome && item.problema);
    return { achados };
  } catch (err) {
    return {
      achados: [],
      erro: `chamada à IA falhou (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
