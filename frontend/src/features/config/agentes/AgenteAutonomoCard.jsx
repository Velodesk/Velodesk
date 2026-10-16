/**
 * AgenteAutonomoCard v1.0.0 — liga/desliga o agente autônomo e define o escopo (produto > motivo > detalhe)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { autonomyApi, tabulationApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';

const MODOS = [
  { value: 'fila_aprovacao', label: 'Fila de aprovação humana' },
  { value: 'envio_direto', label: 'Envio direto ao cliente' },
];

function errMsg(err, fallback) {
  return err?.response?.data?.error || err?.response?.data?.message || fallback;
}

function scopeLabel(rule) {
  return [rule.produto, rule.motivo, rule.detalhe].filter(Boolean).join(' › ');
}

export default function AgenteAutonomoCard() {
  const { showNotification } = useNotifications();
  const [config, setConfig] = useState(null);
  const [rules, setRules] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [produto, setProduto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [detalhe, setDetalhe] = useState('');

  const load = useCallback(async () => {
    try {
      const [cfg, list, tree] = await Promise.all([
        autonomyApi.getConfig(),
        autonomyApi.listRules(),
        tabulationApi.getActive(),
      ]);
      setConfig(cfg);
      setRules(list);
      setProdutos((tree?.produtos || []).filter((p) => p.ativo !== false));
    } catch (err) {
      showNotification(errMsg(err, 'Erro ao carregar o agente autônomo.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => { load(); }, [load]);

  const motivos = useMemo(() => {
    const p = produtos.find((item) => item.produto === produto);
    return (p?.motivos || []).filter((m) => m.ativo !== false);
  }, [produtos, produto]);

  const detalhes = useMemo(() => {
    const m = motivos.find((item) => item.motivo === motivo);
    return (m?.detalhes || []).filter((d) => d.ativo !== false);
  }, [motivos, motivo]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showNotification(okMsg, 'success');
      return true;
    } catch (err) {
      showNotification(errMsg(err, 'Não foi possível concluir a operação.'), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patchConfig = (patch) => run(async () => {
    setConfig(await autonomyApi.updateConfig(patch));
  }, 'Configuração salva.');

  const addRule = async () => {
    const ok = await run(async () => {
      await autonomyApi.createRule({ produto, motivo, detalhe });
      setRules(await autonomyApi.listRules());
    }, 'Escopo adicionado.');
    if (ok) {
      setProduto('');
      setMotivo('');
      setDetalhe('');
    }
  };

  const toggleRule = (rule) => run(async () => {
    await autonomyApi.updateRule(rule._id, { enabled: rule.enabled === false });
    setRules(await autonomyApi.listRules());
  });

  const removeRule = (rule) => {
    if (!window.confirm(`Remover o escopo "${scopeLabel(rule)}"?`)) return;
    run(async () => {
      await autonomyApi.deleteRule(rule._id);
      setRules(await autonomyApi.listRules());
    }, 'Escopo removido.');
  };

  if (loading) return <p className="config-placeholder-msg">Carregando agente autônomo…</p>;
  if (!config) return <p className="config-placeholder-msg">Configuração indisponível.</p>;

  return (
    <div className="config-agente-autonomo">
      <section className="config-agente-box">
        <h4>Agente Autônomo</h4>

        <label className="config-agente-row">
          <input
            type="checkbox"
            checked={config.autonomiaHabilitada}
            disabled={busy}
            onChange={(e) => patchConfig({ autonomiaHabilitada: e.target.checked })}
          />
          <span>Agente autônomo ligado</span>
        </label>

        <label className="config-agente-row">
          <input
            type="checkbox"
            checked={config.hidratacaoConsulta}
            disabled={busy}
            onChange={(e) => patchConfig({ hidratacaoConsulta: e.target.checked })}
          />
          <span>
            Usar dados reais da conta do cliente nas respostas da IA (sugestões e agente autônomo).
            Só o produto citado é consultado, sem CPF nem dados cadastrais.
          </span>
        </label>

        <label className="config-ai-field">
          <span>Destino da resposta aprovada pela IA</span>
          <select
            value={config.modoEnvio}
            disabled={busy}
            onChange={(e) => patchConfig({ modoEnvio: e.target.value })}
          >
            {MODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label className="config-ai-field">
          <span>Nota mínima do auditor para resposta autônoma (50–100)</span>
          <input
            key={config.minAuditScoreEstrito}
            type="number"
            min="50"
            max="100"
            defaultValue={config.minAuditScoreEstrito}
            disabled={busy}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (value !== config.minAuditScoreEstrito) patchConfig({ minAuditScoreEstrito: value });
            }}
          />
        </label>
      </section>

      <section className="config-agente-box">
        <h4>Escopo — onde o agente pode responder sozinho</h4>
        <p>
          Escolha só o produto para liberar todos os chamados dele, ou desça na árvore (motivo e
          detalhe) para restringir. Nada fora destes escopos é respondido automaticamente.
        </p>

        <div className="config-agente-selects">
          <label className="config-ai-field">
            <span>Produto</span>
            <select
              value={produto}
              onChange={(e) => { setProduto(e.target.value); setMotivo(''); setDetalhe(''); }}
            >
              <option value="">Selecione…</option>
              {produtos.map((p) => <option key={p._id} value={p.produto}>{p.produto}</option>)}
            </select>
          </label>
          <label className="config-ai-field">
            <span>Motivo (opcional)</span>
            <select
              value={motivo}
              disabled={!produto || motivos.length === 0}
              onChange={(e) => { setMotivo(e.target.value); setDetalhe(''); }}
            >
              <option value="">Todos os motivos</option>
              {motivos.map((m) => <option key={m.motivo} value={m.motivo}>{m.motivo}</option>)}
            </select>
          </label>
          <label className="config-ai-field">
            <span>Detalhe (opcional)</span>
            <select
              value={detalhe}
              disabled={!motivo || detalhes.length === 0}
              onChange={(e) => setDetalhe(e.target.value)}
            >
              <option value="">Todos os detalhes</option>
              {detalhes.map((d) => <option key={d.detalhe} value={d.detalhe}>{d.detalhe}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={!produto || busy} onClick={addRule}>
            Adicionar escopo
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="config-placeholder-msg">Nenhum escopo liberado. O agente não responde sozinho.</p>
        ) : (
          <ul className="config-agente-rules">
            {rules.map((rule) => (
              <li key={rule._id} className={rule.enabled === false ? 'is-disabled' : ''}>
                <span className="config-agente-rule-scope">{scopeLabel(rule)}</span>
                <span className="config-agente-rule-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggleRule(rule)}>
                    {rule.enabled === false ? 'Ativar' : 'Desativar'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeRule(rule)}>
                    Remover
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
