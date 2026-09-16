/**
 * EspeciaisChannelPage — workspace do canal selecionado
 */
import React, { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  getEspeciaisChannel,
  persistEspeciaisChannel,
} from '../../config/especiaisChannels';
import { useEspeciaisChannelTheme } from '../../hooks/useEspeciaisChannelTheme';
import RedesSociaisTabulacao from './redes-sociais/RedesSociaisTabulacao';
import MetaBusinessArea from './redes-sociais/MetaBusinessArea';

/** Canal Redes Sociais tem duas frentes operacionais em vez do placeholder único. */
const REDES_SOCIAIS_AREAS = [
  { id: 'meta-business', label: 'Meta Business', icon: 'ti-brand-meta' },
  { id: 'tabulacao', label: 'Tabulação', icon: 'ti-clipboard-list' },
];

export default function EspeciaisChannelPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const channel = getEspeciaisChannel(channelId);
  const themeVars = useEspeciaisChannelTheme(channel?.id ?? 'procon');
  const [activeArea, setActiveArea] = useState(REDES_SOCIAIS_AREAS[0].id);

  if (!channel) {
    return <Navigate to="/workspace" replace />;
  }

  persistEspeciaisChannel(channel.id);

  const isRedesSociais = channel.id === 'redes-sociais';

  return (
    <div
      className="page active especiais-page"
      id={`especiais-${channel.id}`}
      style={themeVars}
    >
      <div className={'eco-page-inner especiais-page__inner' + (isRedesSociais ? ' especiais-page__inner--full' : '')}>
        {!isRedesSociais ? (
          <header className="especiais-page__header especiais-page__header--channel">
            <button
              type="button"
              className="especiais-page__back"
              onClick={() => navigate('/workspace')}
            >
              <i className="ti ti-arrow-left" aria-hidden="true" />
              Trocar canal
            </button>
            <span className="especiais-page__eyebrow">Perfil Especiais</span>
            <h2 className="especiais-page__title">{channel.label}</h2>
            <p className="especiais-page__subtitle">{channel.desc}</p>
          </header>
        ) : null}

        <div className="especiais-channel-shell">
          {isRedesSociais ? (
            <div className="especiais-channel-shell__areas">
              <div className="especiais-channel-shell__areas-tabs-row">
                <nav className="ra-tabs" aria-label="Áreas de Redes Sociais">
                  {REDES_SOCIAIS_AREAS.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      className={'ra-tabs__btn' + (activeArea === area.id ? ' is-active' : '')}
                      onClick={() => setActiveArea(area.id)}
                    >
                      <i className={`ti ${area.icon}`} aria-hidden="true" />
                      {area.label}
                    </button>
                  ))}
                </nav>
                <button
                  type="button"
                  className="especiais-channel-shell__switch-channel"
                  onClick={() => navigate('/workspace')}
                >
                  <i className="ti ti-arrow-left" aria-hidden="true" />
                  Trocar canal
                </button>
              </div>
              {activeArea === 'tabulacao' ? (
                <RedesSociaisTabulacao />
              ) : (
                <MetaBusinessArea />
              )}
            </div>
          ) : (
            <div className="especiais-channel-shell__placeholder">
              <i className={`ti ${channel.icon}`} aria-hidden="true" />
              <p>
                Área operacional de <strong>{channel.label}</strong> em construção.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
