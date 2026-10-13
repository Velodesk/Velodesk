/**
 * tabulationConfig v1.11.0 — CE: produto da árvore + motivo do órgão (sem cascata POP)
 * VERSION: v1.11.0 | DATE: 2026-08-21 | AUTHOR: VeloHub Development Team
 */

/** Rótulos de visão/perfil e termos genéricos nunca representam atribuição real. */
const GENERIC_RESPONSAVEL = new Set([
  'agente',
  'agent',
  'atendimento',
  'sistema',
  'system',
  'admin',
  'admin velodesk',
  'administrador',
  'nenhum',
  'sem responsavel',
  'n/a',
  'na',
  '-',
  '--',
  '—',
]);

function normalizeResponsavel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isRealResponsavel(value) {
  const normalized = normalizeResponsavel(value);
  if (!normalized) return false;
  if (normalized.startsWith('visao ')) return false;
  return !GENERIC_RESPONSAVEL.has(normalized);
}

/** Responsável real ou string vazia — nunca preenchimento de fachada. */
export function sanitizeResponsavel(value) {
  return isRealResponsavel(value) ? String(value).trim() : '';
}

export const EMPTY_TABULATION = {
  produtos: [],
  opcoes: {
    tipoChamado: [],
    canalContato: [],
  },
};

export const TABULACAO_OPCOES_CATEGORIAS = {
  TIPO_CHAMADO: 'tipo_chamado',
  CANAL_CONTATO: 'canal_contato',
  MOTIVO_RECLAME_AQUI: 'motivo_reclame_aqui',
  MOTIVO_PROCON: 'motivo_procon',
  MOTIVO_CONSUMIDOR_GOV: 'motivo_consumidor_gov',
  MOTIVO_BACEN: 'motivo_bacen',
};

export const FALLBACK_TIPO_OPTIONS = ['Reclamação', 'Solicitação', 'Dúvida', 'Informação'];
export const FALLBACK_CANAL_OPTIONS = ['WhatsApp', 'Telefone', 'E-mail', 'Portal'];

export const DEFAULT_TIPO = 'Solicitação';

export function isReclameAquiCanal(canal) {
  const raw = String(canal ?? '').trim().toLowerCase();
  return raw.includes('reclame') && raw.includes('aqui');
}

export function isProconCanal(canal) {
  return String(canal ?? '').trim().toLowerCase().includes('procon');
}

export function isBacenCanal(canal) {
  return String(canal ?? '').trim().toLowerCase().includes('bacen');
}

export function isConsumidorGovCanal(canal) {
  const raw = String(canal ?? '').trim().toLowerCase();
  return raw.includes('consumidor') && (raw.includes('gov') || raw.includes('.gov'));
}

/** Canais CE: tabulação = produto (árvore) + motivo (lista do órgão), sem cascata POP. */
export function isCasosEspeciaisCanal(canal) {
  return isReclameAquiCanal(canal)
    || isProconCanal(canal)
    || isBacenCanal(canal)
    || isConsumidorGovCanal(canal);
}

/** Categoria TabulacaoOpcoes do motivo do órgão (ou null se não for CE). */
export function resolveOrgaoMotivoCategoria(canal) {
  if (isReclameAquiCanal(canal)) return TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI;
  if (isProconCanal(canal)) return TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON;
  if (isBacenCanal(canal)) return TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN;
  if (isConsumidorGovCanal(canal)) return TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV;
  return null;
}

export function getActiveProdutos(config) {
  return (config?.produtos || []).filter((p) => p.ativo !== false);
}

export function getProdutoNames(config) {
  return getActiveProdutos(config).map((p) => p.produto);
}

export function findProduto(config, produtoName) {
  const name = String(produtoName || '').trim();
  if (!name) return null;
  return getActiveProdutos(config).find((p) => String(p.produto || '').trim() === name) || null;
}

export function getMotivos(config, produtoName) {
  const produto = findProduto(config, produtoName);
  if (!produto) return [];
  return (produto.motivos || [])
    .filter((m) => m.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map((m) => m.motivo);
}

export function getDetalhes(config, produtoName, motivoName) {
  const produto = findProduto(config, produtoName);
  if (!produto) return [];
  const motivo = (produto.motivos || []).find((m) => m.motivo === motivoName && m.ativo !== false);
  if (!motivo) return [];
  return (motivo.detalhes || [])
    .filter((d) => d.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map((d) => d.detalhe);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Todos os motivos ativos — agregado de todos os produtos */
export function getAllMotivos(config) {
  const values = [];
  for (const produto of getActiveProdutos(config)) {
    for (const motivo of produto.motivos || []) {
      if (motivo.ativo === false) continue;
      values.push(motivo.motivo);
    }
  }
  return uniqueSorted(values);
}

/** Todos os detalhes ativos — agregado de toda a árvore */
export function getAllDetalhes(config) {
  const values = [];
  for (const produto of getActiveProdutos(config)) {
    for (const motivo of produto.motivos || []) {
      if (motivo.ativo === false) continue;
      for (const detalhe of motivo.detalhes || []) {
        if (detalhe.ativo === false) continue;
        values.push(detalhe.detalhe);
      }
    }
  }
  return uniqueSorted(values);
}

/**
 * Opções de motivo para gatilho: filtra por produto quando informado;
 * senão retorna todos os motivos cadastrados.
 */
export function resolveMotivoOptions(config, produtoName) {
  const produto = String(produtoName || '').trim();
  if (produto) {
    const scoped = getMotivos(config, produto);
    if (scoped.length) return scoped;
  }
  return getAllMotivos(config);
}

/**
 * Opções de detalhe para gatilho: filtra por produto/motivo quando informados;
 * senão retorna todos os detalhes cadastrados.
 */
export function resolveDetalheOptions(config, produtoName, motivoName) {
  const produto = String(produtoName || '').trim();
  const motivo = String(motivoName || '').trim();
  if (produto && motivo) {
    const scoped = getDetalhes(config, produto, motivo);
    if (scoped.length) return scoped;
  }
  if (produto) {
    const fromProduto = uniqueSorted(
      getMotivos(config, produto).flatMap((m) => getDetalhes(config, produto, m)),
    );
    if (fromProduto.length) return fromProduto;
  }
  return getAllDetalhes(config);
}

export function getTipoChamadoOptions(config) {
  const values = (config?.opcoes?.tipoChamado || []).filter(Boolean);
  return values.length ? values : FALLBACK_TIPO_OPTIONS;
}

export function getCanalContatoOptions(config) {
  const values = (config?.opcoes?.canalContato || []).filter(Boolean);
  return values.length ? values : FALLBACK_CANAL_OPTIONS;
}

function hasSavedTabulationValue(value) {
  return Boolean(String(value ?? '').trim());
}

export function buildDefaultRightFields(_config, ticket, getAgentName) {
  const lf = ticket?.lateralForm || {};
  const canal = lf.canal || ticket?.channel || 'Portal';
  const skipTreeMotivo = isCasosEspeciaisCanal(canal);
  const produto = hasSavedTabulationValue(lf.produto) ? String(lf.produto).trim() : '';
  const savedMotivo = String(lf.motivo || lf.reclameAqui?.motivo || '').trim();
  const motivo = (skipTreeMotivo || produto) && hasSavedTabulationValue(savedMotivo)
    ? savedMotivo
    : '';
  const detalhe = !skipTreeMotivo && motivo && hasSavedTabulationValue(lf.detalhe)
    ? String(lf.detalhe).trim()
    : '';
  const tipo = String(lf.classificacaoTipo || lf.tipoChamado || DEFAULT_TIPO).trim() || DEFAULT_TIPO;
  // Sem fallback para agente logado: só preenche se houver atribuição real (roleta/manual)
  const responsavel = sanitizeResponsavel(lf.responsavel) || sanitizeResponsavel(ticket?.responsibleAgent);
  return {
    responsavel,
    canal: lf.canal || ticket?.channel || 'Portal',
    tipo,
    produto,
    motivo,
    detalhe,
  };
}

function overlayNonEmptyTabulationFields(base, partial) {
  if (!partial) return { ...(base || {}) };
  const next = { ...(base || {}) };
  ['tipo', 'canal', 'produto', 'motivo', 'detalhe'].forEach((key) => {
    const val = String(partial[key] ?? '').trim();
    if (val) next[key] = partial[key];
  });
  if (partial.responsavel !== undefined) {
    next.responsavel = sanitizeResponsavel(partial.responsavel) || base?.responsavel || '';
  }
  return next;
}

/** Garante defaults (tipo, canal) mesmo quando sessão salva veio incompleta — responsável só se já existir no ticket */
export function mergeRightFieldsWithDefaults(partial, ticket, getAgentName) {
  const defaults = buildDefaultRightFields(null, ticket, getAgentName);
  const merged = overlayNonEmptyTabulationFields(defaults, partial);
  merged.tipo = String(merged.tipo || defaults.tipo || DEFAULT_TIPO).trim() || DEFAULT_TIPO;
  merged.responsavel = sanitizeResponsavel(merged.responsavel) || defaults.responsavel;
  merged.canal = String(merged.canal || defaults.canal || 'Portal').trim() || defaults.canal;
  return merged;
}

/** Campos efetivos para validação: ticket salvo + edição local (origem irrelevante). */
export function resolveEffectiveTabulationFields(rightFields, ticket, getAgentName) {
  return mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
}

export function applyCascadeFieldChange(prev, key, value) {
  const next = { ...prev, [key]: value };
  const canal = String((key === 'canal' ? value : prev?.canal) || '').toLowerCase();
  const skipTreeMotivo = isCasosEspeciaisCanal(canal);
  if (key === 'produto' && !skipTreeMotivo) {
    next.motivo = '';
    next.detalhe = '';
  }
  if (key === 'motivo' && !skipTreeMotivo) {
    next.detalhe = '';
  }
  return next;
}

function normalizeMatchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveOptionValue(options, rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (!options?.length) return value;

  if (options.includes(value)) return value;

  const normalized = normalizeMatchText(value);
  const exact = options.find((option) => normalizeMatchText(option) === normalized);
  if (exact) return exact;

  const partial = options.find((option) => {
    const candidate = normalizeMatchText(option);
    return candidate.includes(normalized) || normalized.includes(candidate);
  });
  if (partial) return partial;

  const tokenMatch = options.find((option) => {
    const candidate = normalizeMatchText(option);
    const valueTokens = normalized.split(/\s+/).filter(Boolean);
    return valueTokens.length > 0 && valueTokens.every((token) => candidate.includes(token));
  });

  return tokenMatch || '';
}

export function hasApplyableTabulation(tabulation) {
  if (!tabulation) return false;
  return Boolean(
    String(tabulation.tipo || tabulation.tipoChamado || tabulation.classificacaoTipo || '').trim()
    || String(tabulation.produto || '').trim()
    || String(tabulation.motivo || '').trim()
    || String(tabulation.detalhe || '').trim()
  );
}

/** Converte texto "Tipo → Produto → Motivo → Detalhe" em objeto de tabulação */
export function parseTabulationDisplay(display) {
  const text = String(display || '').trim();
  if (!text || /incompleta|aguardando|gerando|sugestão/i.test(text)) return null;
  const parts = text.split(/\s*(?:→|->)\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return {
    tipo: parts[0] || '',
    produto: parts[1] || '',
    motivo: parts[2] || '',
    detalhe: parts[3] || '',
  };
}

/** Preenche rightFields com valores sugeridos pela IA, resolvendo opções da tabulação ativa */
export function applyTabulationSuggestion(prev, tabulation, config) {
  if (!tabulation) return { ...(prev || {}) };

  let next = { ...(prev || {}) };

  const tipo = String(
    tabulation.tipo || tabulation.tipoChamado || tabulation.classificacaoTipo || ''
  ).trim();
  if (tipo) next.tipo = tipo;

  const produtoRaw = String(tabulation.produto || '').trim();
  if (produtoRaw) {
    const produto = config
      ? resolveOptionValue(getProdutoNames(config), produtoRaw)
      : produtoRaw;
    if (produto) {
      next = applyCascadeFieldChange(next, 'produto', produto);

      const motivoRaw = String(tabulation.motivo || '').trim();
      if (motivoRaw) {
        const motivo = config
          ? resolveOptionValue(getMotivos(config, produto), motivoRaw)
          : motivoRaw;
        if (motivo) {
          next = applyCascadeFieldChange(next, 'motivo', motivo);

          const detalheRaw = String(tabulation.detalhe || '').trim();
          if (detalheRaw) {
            const detalhe = config
              ? resolveOptionValue(getDetalhes(config, produto, motivo), detalheRaw)
              : detalheRaw;
            if (detalhe) next.detalhe = detalhe;
          }
        }
      }
    }
  }

  return next;
}

const SEND_STATUSES_REQUIRING_TABULATION = new Set(['em-andamento', 'resolvidos']);

/** `options.skipResponsavel`: Área de IA — o backend atribui quem aprova antes de resolver. */
export function validateTabulationForSendStatus(statusId, rightFields, config, options = {}) {
  if (statusId === 'resolvidos' && !options.skipResponsavel) {
    const responsavel = sanitizeResponsavel(rightFields?.responsavel);
    if (!responsavel) {
      return {
        ok: false,
        missing: ['Responsável'],
        message: 'Atribua um responsável ao ticket antes de marcá-lo como resolvido.',
      };
    }
  }

  if (!SEND_STATUSES_REQUIRING_TABULATION.has(statusId)) {
    return { ok: true, missing: [], message: '' };
  }

  const missing = [];
  const produto = String(rightFields?.produto ?? '').trim();
  const motivo = String(rightFields?.motivo ?? '').trim();
  const detalhe = String(rightFields?.detalhe ?? '').trim();
  const tipo = String(rightFields?.tipo ?? rightFields?.classificacaoTipo ?? rightFields?.tipoChamado ?? DEFAULT_TIPO).trim() || DEFAULT_TIPO;
  const canal = String(rightFields?.canal ?? '').trim().toLowerCase();
  const skipTreeMotivo = isCasosEspeciaisCanal(canal);

  if (!produto) missing.push('Produto');
  if (!tipo) missing.push('Tipo');

  if (skipTreeMotivo) {
    // CE: motivo do órgão é obrigatório; detalhe POP não se aplica
    if (!motivo) missing.push('Motivo');
  } else if (produto) {
    const motivos = getMotivos(config, produto);
    if (motivos.length > 0 && !motivo) missing.push('Motivo');
    if (motivo) {
      const detalhes = getDetalhes(config, produto, motivo);
      if (detalhes.length > 0 && !detalhe) missing.push('Detalhe');
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `Preencha a tabulação antes de enviar: ${missing.join(', ')}.`
      : '',
  };
}

/** Tabulação completa (tipo, produto, motivo/detalhe quando existirem opções) */
export function isTabulationComplete(rightFields, config, ticket = null, getAgentName = null) {
  const fields = ticket
    ? mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName || (() => ''))
    : (rightFields || {});
  return validateTabulationForSendStatus('em-andamento', fields, config).ok;
}
