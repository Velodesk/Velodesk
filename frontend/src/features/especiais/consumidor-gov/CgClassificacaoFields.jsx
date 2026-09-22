/**
 * CgClassificacaoFields v2.0.0 — produto + motivo (local state, salva no click do botão Salvar)
 * VERSION: v2.0.0 | DATE: 2026-09-01
 */
import React, { useEffect, useState } from 'react';
import { tabulationApi } from '../../../api/client';
import { useTabulation } from '../../../context/TabulationContext';
import { TABULACAO_OPCOES_CATEGORIAS } from '../../../services/tabulationConfig';
import { CG_MOTIVOS } from '../../../services/especiais/consumidorGovData';

export default function CgClassificacaoFields({ cgItem, onClassificacaoDraftChange }) {
  const { getProdutoNames } = useTabulation();
  const [motivos, setMotivos] = useState(CG_MOTIVOS);
  const [produtoDraft, setProdutoDraft] = useState(cgItem?.produto || '');
  const [motivoDraft, setMotivoDraft] = useState(cgItem?.motivo || '');
  const [motivo2Draft, setMotivo2Draft] = useState(cgItem?.motivo2 || '');
  const [motivo3Draft, setMotivo3Draft] = useState(cgItem?.motivo3 || '');
  const produtoOptions = getProdutoNames();

  useEffect(() => {
    setProdutoDraft(cgItem?.produto || '');
    setMotivoDraft(cgItem?.motivo || '');
    setMotivo2Draft(cgItem?.motivo2 || '');
    setMotivo3Draft(cgItem?.motivo3 || '');
  }, [cgItem?.id]);

  useEffect(() => {
    let cancelled = false;
    tabulationApi.getOpcoes(TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV, false)
      .then((doc) => {
        if (cancelled) return;
        const list = (doc?.opcoes || [])
          .filter((item) => item.ativo !== false)
          .map((item) => item.valor)
          .filter(Boolean);
        if (list.length) setMotivos(list);
      })
      .catch(() => { /* fallback CG_MOTIVOS */ });
    return () => { cancelled = true; };
  }, []);

  if (!cgItem) return null;

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
  const motivoList = motivos.length ? motivos : CG_MOTIVOS;

  return (
    <section className="ra-ticket__side-card">
      <label htmlFor="cg-classificacao-produto">Produto</label>
      <select
        id="cg-classificacao-produto"
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

      <label htmlFor="cg-classificacao-motivo">Motivo</label>
      <select
        id="cg-classificacao-motivo"
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

      <label htmlFor="cg-classificacao-motivo2">Motivo 2</label>
      <select
        id="cg-classificacao-motivo2"
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

      <label htmlFor="cg-classificacao-motivo3">Motivo 3</label>
      <select
        id="cg-classificacao-motivo3"
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
