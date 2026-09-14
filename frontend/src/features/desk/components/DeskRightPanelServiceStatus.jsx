/**
 * DeskRightPanelServiceStatus — status dos serviços (Disponíveis / Indisponíveis) no
 * rodapé do painel de classificação do Desk. Mesma fonte de dados do badge do Workspace
 * 360 (VelohubCentral/console_config/module_status), em duas colunas retráteis.
 */
import React, { useState } from 'react';
import { useModuleStatus } from '../../../hooks/useModuleStatus';

function statusTitle(item) {
  if (item.status === 'on') return `${item.label} — ativo`;
  if (item.status === 'revisao') return `${item.label} — em revisão`;
  if (item.status === 'off') return `${item.label} — indisponível`;
  return `${item.label} — status desconhecido`;
}

function ServiceColumn({ title, tone, items }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rp-service-status__col">
      <button
        type="button"
        className={`rp-service-status__col-label rp-service-status__col-label--${tone}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <i className={`rp-service-status__dot rp-service-status__dot--${tone}`} aria-hidden="true" />
        <span>{title}</span>
        <i className={`ti ti-chevron-down rp-service-status__chevron${open ? '' : ' is-collapsed'}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="rp-service-status__tags" role="list">
          {items.length
            ? items.map((item) => (
              <span key={item.key} role="listitem" className="rp-service-status__tag" title={statusTitle(item)}>
                {item.label}
              </span>
            ))
            : <span className="rp-service-status__empty">Nenhum</span>}
        </div>
      ) : null}
    </div>
  );
}

export default function DeskRightPanelServiceStatus() {
  const { items, loading } = useModuleStatus();
  const [sectionOpen, setSectionOpen] = useState(true);

  if (loading && !items.length) return null;
  if (!items.length) return null;

  const activeItems = items.filter((item) => item.status === 'on');
  const inactiveItems = items.filter((item) => item.status !== 'on');

  return (
    <section className="rp-section rp-service-status" aria-label="Status dos serviços">
      <button
        type="button"
        className="rp-section__label rp-service-status__header"
        aria-expanded={sectionOpen}
        onClick={() => setSectionOpen((prev) => !prev)}
      >
        Status dos serviços
        <i className={`ti ti-chevron-down rp-service-status__chevron${sectionOpen ? '' : ' is-collapsed'}`} aria-hidden="true" />
      </button>
      {sectionOpen ? (
        <div className="rp-service-status__columns">
          <ServiceColumn title="Disponíveis" tone="active" items={activeItems} />
          <ServiceColumn title="Indisponíveis" tone="offline" items={inactiveItems} />
        </div>
      ) : null}
    </section>
  );
}
