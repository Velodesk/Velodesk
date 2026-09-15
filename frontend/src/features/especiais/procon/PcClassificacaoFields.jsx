/**
 * PcClassificacaoFields v2.0.0 — produto + motivo (local state, salva no click do botão Salvar)
 * VERSION: v2.0.0 | DATE: 2026-09-01
 */
import React, { useEffect, useState } from 'react';
import { tabulationApi } from '../../../api/client';
import { useTabulation } from '../../../context/TabulationContext';
import { TABULACAO_OPCOES_CATEGORIAS } from '../../../services/tabulationConfig';
import { PC_MOTIVOS } from '../../../services/especiais/proconData';

export default function PcClassificacaoFields({ pcItem, onClassificacaoDraftChange }) {
  const { getProdutoNames } = useTabulation();
  const [motivos, setMotivos] = useState(PC_MOTIVOS);
  const [produtoDraft, setProdutoDraft] = useState(pcItem?.produto || '');
  const [motivoDraft, setMotivoDraft] = useState(pcItem?.motivo || '');
  const produtoOptions = getProdutoNames();

  useEffect(() => {
    setProdutoDraft(pcItem?.produto || '');
    setMotivoDraft(pcItem?.motivo || '');
  }, [pcItem?.id]);

  useEffect(() => {
    let cancelled = false;
    tabulationApi.getOpcoes(TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON, false)
      .then((doc) => {
        if (cancelled) return;
        const list = (doc?.opcoes || [])
          .filter((item) => item.ativo !== false)
          .map((item) => item.valor)
          .filter(Boolean);
        if (list.length) setMotivos(list);
      })
      .catch(() => { /* fallback PC_MOTIVOS */ });
    return () => { cancelled = true; };
  }, []);

  if (!pcItem) return null;

  const handleFieldChange = (field, value) => {
    if (field === 'produto') {
      setProdutoDraft(value);
      onClassificacaoDraftChange?.({ produto: value, motivo: motivoDraft });
    } else if (field === 'motivo') {
      setMotivoDraft(value);
      onClassificacaoDraftChange?.({ produto: produtoDraft, motivo: value });
    }
  };

  const produtos = produtoOptions.length ? produtoOptions : [];
  const motivoList = motivos.length ? motivos : PC_MOTIVOS;

  return (
    <section className="ra-ticket__side-card">
      <label htmlFor="pc-classificacao-produto">Produto</label>
      <select
        id="pc-classificacao-produto"
        className="ra-registro__select"
        value={produtoDraft}
        onChange={(e) => handleFieldChange('produto', e.target.value)}
      >
        <option value="">Selecionar</option>
        {produtos.map((produto) => (
          <option key={produto} value={produto}>{produto}</option>
        ))}
        {produtoDraft && !produtos.includes(produtoDraft) ? (
          <option value={produtoDraft}>{produtoDraft}</option>
        ) : null}
      </select>

      <label htmlFor="pc-classificacao-motivo">Motivo</label>
      <select
        id="pc-classificacao-motivo"
        className="ra-registro__select"
        value={motivoDraft}
        onChange={(e) => handleFieldChange('motivo', e.target.value)}
      >
        <option value="">Selecionar</option>
        {motivoList.map((motivo) => (
          <option key={motivo} value={motivo}>{motivo}</option>
        ))}
        {motivoDraft && !motivoList.includes(motivoDraft) ? (
          <option value={motivoDraft}>{motivoDraft}</option>
        ) : null}
      </select>
    </section>
  );
}
