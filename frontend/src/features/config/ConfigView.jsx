/**
 * Central de Configurações — layout V2
 * VERSION: v3.7.0 | DATE: 2026-08-20
 */
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useProfile } from '../../context/ProfileContext';
import { CONFIG_SECTIONS, getConfigSection } from './configSections';
import TabulationFormsSection from './components/TabulationFormsSection';
import FuncoesPermissoesSection from './funcoes/FuncoesPermissoesSection';
import WorkflowsConfigSection from './workflow/WorkflowsConfigSection';
import EmailConfigSection from './email/EmailConfigSection';
import MacrosConfigSection from './macros/MacrosConfigSection';
import ApiExternaConfigSection from './api/ApiExternaConfigSection';
import TicketIaConfigSection from './ai/TicketIaConfigSection';
import { usePermissions } from '../../context/PermissionContext';

export default function ConfigView() {
  const { isNavAllowed } = useProfile();
  const { can } = usePermissions();
  const [section, setSection] = useState(null);
  const active = section ? getConfigSection(section) : null;

  // Módulos de Acesso (isNavAllowed) é quem manda: se o módulo está liberado ali, o usuário
  // entra — 'config.visualizar' fica só como fallback para permissões legadas.
  const canViewConfig = isNavAllowed('config') || can('config', 'visualizar');

  if (!canViewConfig) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <div id="config" className="page config-page active">
      <div className="config-layout">
        <aside className="config-sidebar">
          <div className="config-sidebar-brand">
            <div className="config-sidebar-brand-icon" aria-hidden="true">
              <i className="ti ti-adjustments-horizontal" />
            </div>
            <div>
              <h3>Configurações</h3>
              <p>Personalize tickets, fluxos e integrações</p>
            </div>
          </div>

          <nav className="config-menu" aria-label="Áreas de configuração">
            {CONFIG_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={'config-menu-item' + (section === item.id ? ' active' : '')}
                onClick={() => setSection(item.id)}
              >
                <span className="config-menu-icon" aria-hidden="true">
                  <i className={'ti ' + item.icon} />
                </span>
                <span className="config-menu-text">
                  <span className="config-menu-label">{item.label}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="config-content">
          {!section ? (
            <>
              <header className="config-content-header">
                <span className="config-content-eyebrow">Central de configurações</span>
                <div className="config-content-title-row">
                  <h3>Bem-vindo</h3>
                  <p>Escolha uma área no menu ou nos atalhos abaixo para começar.</p>
                </div>
              </header>

              <div className="config-welcome-grid">
                {CONFIG_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="config-welcome-card"
                    onClick={() => setSection(item.id)}
                  >
                    <span className="config-welcome-card-icon" aria-hidden="true">
                      <i className={'ti ' + item.icon} />
                    </span>
                    <strong>{item.cardTitle || item.label}</strong>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <header className="config-content-header">
                <span className="config-content-eyebrow">Central de configurações</span>
                {section !== 'email' ? (
                  <div className="config-content-title-row">
                    <h3>{active?.label}</h3>
                  </div>
                ) : null}
              </header>

              {section === 'forms' ? (
                <TabulationFormsSection />
              ) : section === 'workflows' ? (
                <WorkflowsConfigSection />
              ) : section === 'funcoes-permissoes' ? (
                <FuncoesPermissoesSection />
              ) : section === 'macros' ? (
                <MacrosConfigSection />
              ) : section === 'email' ? (
                <EmailConfigSection />
              ) : section === 'api' ? (
                <ApiExternaConfigSection />
              ) : section === 'ticket-ia' ? (
                <TicketIaConfigSection />
              ) : (
                <p className="config-placeholder-msg">
                  Editor de {active?.label?.toLowerCase()} — em desenvolvimento.
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
