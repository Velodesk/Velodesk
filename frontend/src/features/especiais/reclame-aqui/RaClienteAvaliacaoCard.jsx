/**
 * RaClienteAvaliacaoCard — notas do cliente vindas da base Reclame Aqui (somente leitura):
 * se o problema foi resolvido, se voltaria a fazer negócio e a nota dada pelo consumidor.
 * Só existe quando a reclamação veio de importação de base (Hugme) — cadastro manual não tem
 * essas colunas.
 */
import React from 'react';

export default function RaClienteAvaliacaoCard({ raItem }) {
  if (!raItem) return null;

  const resolvido = raItem.raResolvido || '';
  const voltariaNegocio = raItem.raVoltariaNegocio || '';
  const nota = raItem.nota || '';

  if (!resolvido && !voltariaNegocio && !nota) return null;

  return (
    <section className="ra-ticket__side-card">
      <p className="ra-registro__side-label">Notas do cliente</p>
      <dl>
        <div>
          <dt>Problema foi resolvido?</dt>
          <dd>{resolvido || '—'}</dd>
        </div>
        <div>
          <dt>Voltaria a fazer negócio?</dt>
          <dd>{voltariaNegocio || '—'}</dd>
        </div>
        <div>
          <dt>Nota do consumidor</dt>
          <dd>{nota || '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
