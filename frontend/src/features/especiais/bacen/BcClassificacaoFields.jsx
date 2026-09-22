/**
 * BcClassificacaoFields v2.0.0 — produto + motivo (local state, salva no click do botão Salvar)
 * VERSION: v2.0.0 | DATE: 2026-09-01
 */
import React, { useEffect, useState } from 'react';
import { tabulationApi } from '../../../api/client';
import { useTabulation } from '../../../context/TabulationContext';
import { TABULACAO_OPCOES_CATEGORIAS } from '../../../services/tabulationConfig';
import { BC_MOTIVOS } from '../../../services/especiais/bacenData';

export default function BcClassificacaoFields({ bcItem, onClassificacaoDraftChange }) {
  const { getProdutoNames } = useTabulation();
  const [motivos, setMotivos] = useState(BC_MOTIVOS);
  const [produtoDraft, setProdutoDraft] = useState(bcItem?.produto || '');
  const [motivoDraft, setMotivoDraft] = useState(bcItem?.motivo || '');
  const [motivo2Draft, setMotivo2Draft] = useState(bcItem?.motivo2 || '');
  const [motivo3Draft, setMotivo3Draft] = useState(bcItem?.motivo3 || '');
  const produtoOptions = getProdutoNames();

  useEffect(() => {
    setProdutoDraft(bcItem?.produto || '');
    setMotivoDraft(bcItem?.motivo || '');
    setMotivo2Draft(bcItem?.motivo2 || '');
    setMotivo3Draft(bcItem?.motivo3 || '');
  }, [bcItem?.id]);

  useEffect(() => {
    let cancelled = false;
    tabulationApi.getOpcoes(TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN, false)
      .then((doc) => {
        if (cancelled) return;
        const list = (doc?.opcoes || [])
          .filter((item) => item.ativo !== false)
          .map((item) => item.valor)
          .filter(Boolean);
        if (list.length) setMotivos(list);
      })
      .catch(() => { /* fallback BC_MOTIVOS */ });
    return () => { cancelled = true; };
  }, []);

  if (!bcItem) return null;

  const handleFieldChange = (field, value) => {
    const next = {
      produto: produtoDraft,
      motivo: motivoDraft,
      motivo2: motivo2Draft,
      motivo3: motivo3Draft,
      [field]: value,
    };
    if (field === 'produto') setProdutoDraft(value);
    else if (field === 'motivo') setMotivoDraft(value);
    else if (field === 'motivo2') setMotivo2Draft(value);
    else if (field === 'motivo3') setMotivo3Draft(value);
    onClassificacaoDraftChange?.(next);
  };

  const produtos = produtoOptions.length ? produtoOptions : [];
  const motivoList = motivos.length ? motivos : BC_MOTIVOS;

  return (
    <section className="ra-ticket__side-card">
      <label htmlFor="bc-classificacao-produto">Produto</label>
      <select
        id="bc-classificacao-produto"
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

      <label htmlFor="bc-classificacao-motivo">Motivo</label>
      <select
        id="bc-classificacao-motivo"
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

      <label htmlFor="bc-classificacao-motivo2">Motivo 2</label>
      <select
        id="bc-classificacao-motivo2"
        className="ra-registro__select"
        value={motivo2Draft}
        onChange={(e) => handleFieldChange('motivo2', e.target.value)}
      >
        <option value="">Selecionar</option>
        {motivoList.map((motivo) => (
          <option key={motivo} value={motivo}>{motivo}</option>
        ))}
        {motivo2Draft && !motivoList.includes(motivo2Draft) ? (
          <option value={motivo2Draft}>{motivo2Draft}</option>
        ) : null}
      </select>

      <label htmlFor="bc-classificacao-motivo3">Motivo 3</label>
      <select
        id="bc-classificacao-motivo3"
        className="ra-registro__select"
        value={motivo3Draft}
        onChange={(e) => handleFieldChange('motivo3', e.target.value)}
      >
        <option value="">Selecionar</option>
        {motivoList.map((motivo) => (
          <option key={motivo} value={motivo}>{motivo}</option>
        ))}
        {motivo3Draft && !motivoList.includes(motivo3Draft) ? (
          <option value={motivo3Draft}>{motivo3Draft}</option>
        ) : null}
      </select>
    </section>
  );
}
