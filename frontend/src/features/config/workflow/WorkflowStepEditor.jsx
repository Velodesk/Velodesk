/**
 * WorkflowStepEditor v2.0.0 — bifurcação real: remove seletor "Próximo passo"
 * (não faz mais sentido — cada ramo tem sua própria sub-timeline aninhada)
 * VERSION: v2.0.0 | DATE: 2026-09-10
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import WorkflowRoutesEditor from './WorkflowRoutesEditor';
import {
  ACAO_TIPOS,
  ATRIBUICAO_SISTEMA,
  ATRIBUICAO_TIPOS,
  buildFuncaoAtribuicaoOpcoes,
  FUNCAO_ATRIBUICAO_OPCOES,
  CTA_ALVOS,
  resolveAutomaticaConfig,
  RESPOSTA_CONTEUDO_MODOS,
  SISTEMA_MODOS,
  WEBHOOK_TIPOS,
} from './workflowConfigData';
import api, { emailOutboundApi } from '../../../api/client';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import PlaceholderPicker, { insertPlaceholderAtCursor } from '../components/PlaceholderPicker';

const DEFAULT_INTERNAL_HOOKS = [
  { id: 'gestao.alert', label: 'Alerta gestão (stub)' },
  { id: 'integracao.stub', label: 'Integração stub' },
];

export default function WorkflowStepEditor({
  envelope,
  onChange,
  onRemove,
  canRemove = true,
}) {
  const cfg = envelope?.passo || {};
  const [internalHooks, setInternalHooks] = useState(DEFAULT_INTERNAL_HOOKS);
  const [atuacaoOpcoes, setAtuacaoOpcoes] = useState(FUNCAO_ATRIBUICAO_OPCOES);
  const [emailPadraoOpcoes, setEmailPadraoOpcoes] = useState([]);
  const promptContextoRef = useRef(null);
  const { colaboradores, loading: colaboradoresLoading, error: colaboradoresError } = useDeskColaboradores();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/funcoes-permissoes').then((r) => r.data).catch(() => []),
      api.get('/funcoes-permissoes/catalog').then((r) => r.data).catch(() => ({})),
    ]).then(([funcoes, catalog]) => {
      if (cancelled) return;
      setAtuacaoOpcoes(buildFuncaoAtribuicaoOpcoes(
        Array.isArray(funcoes) ? funcoes : [],
        Array.isArray(catalog?.velohub) ? catalog.velohub : [],
      ));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    emailOutboundApi.listConteudos().then((data) => {
      if (cancelled) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setEmailPadraoOpcoes(items.filter(
        (item) => item.ativo && (item.gatilho?.criterios || []).some((c) => c.tipo === 'gatilho_interno'),
      ));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const colaboradoresValidos = useMemo(
    () => colaboradores.filter((c) => !c.desligado),
    [colaboradores],
  );

  const atuacaoSelectOptions = useMemo(() => {
    const slug = String(cfg.atribuicao?.funcaoSlug || '').trim();
    if (!slug || atuacaoOpcoes.some((o) => o.value === slug)) return atuacaoOpcoes;
    return [...atuacaoOpcoes, { value: slug, label: slug }];
  }, [atuacaoOpcoes, cfg.atribuicao?.funcaoSlug]);

  const colaboradorSelecionado = String(cfg.atribuicao?.colaborador || '').trim();
  const colaboradorNaLista = useMemo(
    () => colaboradoresValidos.find(
      (c) => c.value === colaboradorSelecionado
        || c.email === colaboradorSelecionado
        || c.colaboradorNome === colaboradorSelecionado,
    ),
    [colaboradoresValidos, colaboradorSelecionado],
  );
  const colaboradorSelectValue = colaboradorNaLista?.value || colaboradorSelecionado;

  const formatColaboradorLabel = (c) => {
    const nome = c.colaboradorNome || c.label || c.value;
    if (c.email && c.email !== nome) return `${nome} (${c.email})`;
    return nome;
  };

  useEffect(() => {
    api.get('/workflow-notificacoes/internal-hooks')
      .then((r) => {
        if (Array.isArray(r.data?.hooks) && r.data.hooks.length) {
          setInternalHooks(r.data.hooks);
        }
      })
      .catch(() => {
        setInternalHooks(DEFAULT_INTERNAL_HOOKS);
      });
  }, []);

  const patchPasso = (patch) => {
    onChange?.({
      ...envelope,
      passo: { ...cfg, ...patch },
    });
  };

  const patchAtribuicao = (patch) => {
    patchPasso({ atribuicao: { ...(cfg.atribuicao || {}), ...patch } });
  };

  const patchAcao = (patch) => {
    patchPasso({ acao: { ...(cfg.acao || {}), ...patch } });
  };

  const patchAutomatica = (patch) => {
    const current = resolveAutomaticaConfig(cfg) || { modo: 'acao_sistema' };
    patchAcao({ automatica: { ...current, ...patch } });
  };

  const acaoTipo = cfg.acao?.tipo || 'manual';
  const isAutomatica = acaoTipo === 'automatica';
  const automatica = resolveAutomaticaConfig(cfg) || {};

  const handleAcaoTipoChange = (tipo) => {
    const nextAcao = {
      ...(cfg.acao || {}),
      tipo,
      rotas: tipo === 'aprovacao'
        ? (cfg.acao?.rotas?.length ? cfg.acao.rotas : [
          { variavel: 'approve', rotulo: 'Aprovar', statusTicket: 'em-andamento', passos: [] },
          { variavel: 'reject', rotulo: 'Reprovar', statusTicket: 'pendente', passos: [] },
          { variavel: 'request_info', rotulo: 'Pedir informação', statusTicket: 'pendente', passos: [] },
        ])
        : [],
    };

    if (tipo === 'automatica') {
      nextAcao.automatica = resolveAutomaticaConfig(cfg) || {
        modo: 'acao_sistema',
        webhookTipo: 'externo',
        webhookMetodo: 'POST',
      };
      patchPasso({
        acao: nextAcao,
        atribuicao: { tipo: 'sistema' },
      });
      return;
    }

    nextAcao.automatica = undefined;
    const nextAtribuicao = cfg.atribuicao?.tipo === 'sistema'
      ? { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' }
      : (cfg.atribuicao || { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' });
    patchPasso({ acao: nextAcao, atribuicao: nextAtribuicao });
  };

  const atribuicaoTipo = isAutomatica ? 'sistema' : (cfg.atribuicao?.tipo || 'funcao');

  useEffect(() => {
    if (isAutomatica && cfg.atribuicao?.tipo !== 'sistema') {
      patchAtribuicao({ tipo: 'sistema' });
    }
  }, [isAutomatica, cfg.atribuicao?.tipo]);

  return (
    <div className="wf-step-editor">
      <div className="wf-step-editor__grid">
        <label className="wf-step-editor__field">
          <span>Nome da etapa</span>
          <input
            type="text"
            value={cfg.nome || ''}
            onChange={(e) => patchPasso({ nome: e.target.value })}
          />
        </label>
        <label className="wf-step-editor__field">
          <span>SLA (horas)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={cfg.slaHoras ?? ''}
            onChange={(e) => patchPasso({ slaHoras: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Opcional"
          />
        </label>
      </div>

      <label className="wf-step-editor__field wf-step-editor__field--full">
        <span>Descrição</span>
        <textarea
          rows={2}
          value={cfg.descricao || ''}
          onChange={(e) => patchPasso({ descricao: e.target.value })}
        />
      </label>

      <section className="wf-step-editor__section">
        <h4>Atribuição (→ tabulacao.atribuido)</h4>
        <div className="wf-step-editor__grid">
          <label className="wf-step-editor__field">
            <span>Tipo</span>
            {isAutomatica ? (
              <input type="text" value={ATRIBUICAO_SISTEMA.label} readOnly disabled />
            ) : (
              <select
                value={atribuicaoTipo}
                onChange={(e) => patchAtribuicao({ tipo: e.target.value })}
              >
                {ATRIBUICAO_TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </label>
          {!isAutomatica && atribuicaoTipo === 'funcao' ? (
            <label className="wf-step-editor__field">
              <span>Atuação</span>
              <select
                value={cfg.atribuicao?.funcaoSlug || ''}
                onChange={(e) => patchAtribuicao({ funcaoSlug: e.target.value, tipo: 'funcao' })}
              >
                <option value="">Selecione…</option>
                {atuacaoSelectOptions.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {!isAutomatica && atribuicaoTipo === 'colaborador' ? (
            <label className="wf-step-editor__field">
              <span>Colaborador</span>
              <select
                value={colaboradorSelectValue}
                onChange={(e) => patchAtribuicao({ colaborador: e.target.value })}
                disabled={colaboradoresLoading}
              >
                <option value="">
                  {colaboradoresLoading ? 'Carregando colaboradores…' : 'Selecione…'}
                </option>
                {colaboradorSelecionado && !colaboradorNaLista ? (
                  <option value={colaboradorSelecionado}>
                    {colaboradorSelecionado} (fora da lista atual)
                  </option>
                ) : null}
                {colaboradoresValidos.map((c) => (
                  <option key={c.id || c.email || c.value} value={c.value}>
                    {formatColaboradorLabel(c)}
                    {c.afastado ? ' — afastado' : ''}
                  </option>
                ))}
              </select>
              {colaboradoresError ? (
                <span className="grupos-atrib__hint">
                  Não foi possível carregar a lista de colaboradores.
                </span>
              ) : null}
            </label>
          ) : null}
        </div>
      </section>

      <section className="wf-step-editor__section">
        <h4>Ação</h4>
        <label className="wf-step-editor__field">
          <span>Tipo de ação</span>
          <select
            value={acaoTipo}
            onChange={(e) => handleAcaoTipoChange(e.target.value)}
          >
            {ACAO_TIPOS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {isAutomatica ? (
          <div className="wf-step-editor__sistema">
            <label className="wf-step-editor__field wf-step-editor__field--full">
              <span>Modo automático</span>
              <select
                value={automatica.modo || 'acao_sistema'}
                onChange={(e) => patchAutomatica({ modo: e.target.value })}
              >
                {SISTEMA_MODOS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>

            {automatica.modo === 'acao_sistema' ? (
              <>
                <label className="wf-step-editor__field">
                  <span>Tipo de webhook</span>
                  <select
                    value={automatica.webhookTipo || 'externo'}
                    onChange={(e) => patchAutomatica({ webhookTipo: e.target.value })}
                  >
                    {WEBHOOK_TIPOS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
                {automatica.webhookTipo === 'interno' ? (
                  <label className="wf-step-editor__field">
                    <span>Hook interno</span>
                    <select
                      value={automatica.webhookHookId || ''}
                      onChange={(e) => patchAutomatica({ webhookHookId: e.target.value })}
                    >
                      <option value="">Selecione…</option>
                      {internalHooks.map((h) => (
                        <option key={h.id} value={h.id}>{h.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="wf-step-editor__field">
                      <span>URL</span>
                      <input
                        type="url"
                        value={automatica.webhookUrl || ''}
                        onChange={(e) => patchAutomatica({ webhookUrl: e.target.value })}
                        placeholder="https://..."
                      />
                    </label>
                    <label className="wf-step-editor__field">
                      <span>Método</span>
                      <select
                        value={automatica.webhookMetodo || 'POST'}
                        onChange={(e) => patchAutomatica({ webhookMetodo: e.target.value })}
                      >
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            ) : null}

            {automatica.modo === 'resposta_cliente' ? (
              <>
                <label className="wf-step-editor__field">
                  <span>Modo de conteúdo</span>
                  <select
                    value={automatica.conteudoModo || 'ia'}
                    onChange={(e) => patchAutomatica({ conteudoModo: e.target.value })}
                  >
                    {RESPOSTA_CONTEUDO_MODOS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </label>
                {(automatica.conteudoModo || 'ia') === 'email_padrao' ? (
                  <label className="wf-step-editor__field wf-step-editor__field--full">
                    <span>E-mail padrão</span>
                    <select
                      value={automatica.emailConteudoId || ''}
                      onChange={(e) => patchAutomatica({ emailConteudoId: e.target.value })}
                    >
                      <option value="">Selecione…</option>
                      {emailPadraoOpcoes.map((item) => (
                        <option key={item.id} value={item.id}>{item.nome}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="wf-step-editor__field wf-step-editor__field--full">
                    <span>Contexto para o prompt</span>
                    <textarea
                      ref={promptContextoRef}
                      rows={3}
                      value={automatica.promptContexto || ''}
                      onChange={(e) => patchAutomatica({ promptContexto: e.target.value })}
                      placeholder="Instruções adicionais para o Agente de Resposta nesta etapa…"
                    />
                    <PlaceholderPicker
                      onInsert={(token) => insertPlaceholderAtCursor(
                        promptContextoRef,
                        automatica.promptContexto || '',
                        token,
                        (next) => patchAutomatica({ promptContexto: next }),
                      )}
                    />
                  </label>
                )}
              </>
            ) : null}

            {automatica.modo === 'call_to_action' ? (
              <>
                <label className="wf-step-editor__field wf-step-editor__field--full">
                  <span>Título da notificação</span>
                  <input
                    type="text"
                    value={automatica.ctaTitulo || ''}
                    onChange={(e) => patchAutomatica({ ctaTitulo: e.target.value })}
                  />
                </label>
                <label className="wf-step-editor__field wf-step-editor__field--full">
                  <span>Mensagem</span>
                  <textarea
                    rows={2}
                    value={automatica.ctaMensagem || ''}
                    onChange={(e) => patchAutomatica({ ctaMensagem: e.target.value })}
                  />
                </label>
                <label className="wf-step-editor__field">
                  <span>Alvo</span>
                  <select
                    value={automatica.ctaAlvo || 'responsavel'}
                    onChange={(e) => patchAutomatica({ ctaAlvo: e.target.value })}
                  >
                    {CTA_ALVOS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        ) : null}

        {acaoTipo === 'aprovacao' ? (
          <WorkflowRoutesEditor
            rotas={cfg.acao?.rotas || []}
            onChange={(next) => patchAcao({ rotas: next })}
          />
        ) : null}
      </section>

      {canRemove ? (
        <button type="button" className="config-action-btn config-action-btn--delete wf-step-editor__remove" onClick={onRemove}>
          Remover etapa
        </button>
      ) : null}
    </div>
  );
}
