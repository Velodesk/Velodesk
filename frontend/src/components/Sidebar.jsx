/**
 * Sidebar rail unificada — 2 estados: 52px ícones (padrão) | chevron fixa 220px labels
 * VERSION: v1.13.0 | DATE: 2026-09-09
 * Perfil: VeloHub (sem botÃ£o local na barra)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isEspeciaisNavId, NAV_ITEMS } from '../config/profiles';
import { useAuth } from '../context/AuthContext';
import { useProfile } from '../context/ProfileContext';
import { useVeloNews } from '../features/velonews/VeloNewsProvider';
import VeloNewsPopover from '../features/velonews/VeloNewsPopover';
import { useNotifications } from '../context/NotificationContext';

function navKeyActivate(e, action) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action?.();
  }
}

export default function Sidebar() {
  const { logout } = useAuth();
  const { isNavAllowed } = useProfile();
  const { unreadCount, popoverOpen, togglePopover, bellAnchorRef } = useVeloNews();
  const { pulseBadgeCount } = useNotifications();
  const footerBadgeCount = pulseBadgeCount > 0 ? pulseBadgeCount : unreadCount;
  const navigate = useNavigate();
  const location = useLocation();
  const [pinned, setPinned] = useState(false);

  const togglePinned = useCallback((e) => {
    e.stopPropagation();
    setPinned((prev) => !prev);
  }, []);

  // Reflete o estado fixado no body para que o conteúdo ao lado (filas, listas)
  // desloque junto e nunca fique sobreposto pela barra lateral.
  useEffect(() => {
    document.body.classList.toggle('velo-sidebar-pinned', pinned);
    return () => document.body.classList.remove('velo-sidebar-pinned');
  }, [pinned]);

  // Ordem natural de NAV_ITEMS (não a ordem de um único perfil "ativo"), pra quem acumula
  // funções ver todos os módulos liberados numa posição estável e previsível.
  // Nem "Finalizados" do Desk (tickets-resolvidos) nem o do workflow (workflow-finalizados)
  // são exibidos — "Feito"/conclusão apenas remove o ticket da fila, sem tela de finalizados.
  const visibleNav = NAV_ITEMS.filter((item) => (
    isNavAllowed(item.id)
    && item.id !== 'workflow-finalizados'
    && item.id !== 'tickets-resolvidos'
  ));

  const handleNavClick = useCallback((item) => {
    const path = item.id === 'tickets' ? '/tickets?desk=v2' : item.path;
    // Canais especiais (RA, Procon, etc.) usam React Router direto — navigateToPage remove .active cedo demais
    if (isEspeciaisNavId(item.id)) {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.classList.remove('tickets-active');
        mainContent.style.background = 'transparent';
      }
      window.syncMainSidebarNav?.(item.id);
      navigate(path);
      return;
    }
    if (item.id === 'workflow-finalizados') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.classList.remove('tickets-active');
        mainContent.style.background = 'transparent';
      }
      window.syncMainSidebarNav?.('workflow-finalizados');
      navigate('/workflow?view=finalizados');
      return;
    }
    if (typeof window.navigateToPage === 'function' && item.id !== 'workflow-inbox') {
      window.navigateToPage(item.id);
      return;
    }
    if (item.id === 'workflow-inbox') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.classList.remove('tickets-active');
        mainContent.style.background = 'transparent';
      }
      window.syncMainSidebarNav?.('workflow-inbox');
    }
    navigate(path);
  }, [navigate]);

  const isActive = (item) => {
    const path = item.id === 'tickets' ? '/tickets' : item.path;
    if (item.id === 'workflow-finalizados') {
      return location.pathname === '/workflow' && new URLSearchParams(location.search).get('view') === 'finalizados';
    }
    if (item.id === 'workflow-inbox') {
      return location.pathname === '/workflow' && !new URLSearchParams(location.search).get('view');
    }
    if (item.id === 'tickets-resolvidos') {
      return location.pathname === '/tickets' && new URLSearchParams(location.search).get('queue') === 'resolvidos';
    }
    if (item.id === 'tickets') {
      return location.pathname === '/tickets' && new URLSearchParams(location.search).get('queue') !== 'resolvidos';
    }
    const basePath = path.split('?')[0];
    return location.pathname === basePath || location.pathname.startsWith(basePath + '/');
  };

  const wrapClass = [
    'velo-nav-rail-wrap',
    pinned ? 'is-pinned' : '',
  ].filter(Boolean).join(' ');

  const renderNavItem = (item) => (
    <li
      key={item.id}
      className={'nav-item' + (isActive(item) ? ' active' : '')}
      data-page={item.id}
      data-tooltip={item.tooltip}
      title={item.tooltip}
      onClick={() => handleNavClick(item)}
      onKeyDown={(e) => navKeyActivate(e, () => handleNavClick(item))}
      role="button"
      tabIndex={0}
    >
      <i className={'ti ' + item.icon} />
      <span>{item.label}</span>
      {item.badge && <span className="nav-item__badge" aria-hidden="true" />}
    </li>
  );

  const renderNavList = () => visibleNav.map((item, index) => {
    const isEspeciais = isEspeciaisNavId(item.id);
    const prevIsEspeciais = index > 0 && isEspeciaisNavId(visibleNav[index - 1].id);
    const showDivider = isEspeciais && pinned && !prevIsEspeciais;
    return (
      <React.Fragment key={item.id}>
        {showDivider && (
          <li className="velo-nav-rail__nav-section" role="presentation">
            <div className="velo-nav-rail__section-divider" aria-hidden="true" />
            <span className="velo-nav-rail__section-label">Especiais</span>
          </li>
        )}
        {renderNavItem(item)}
      </React.Fragment>
    );
  });

  return (
    <div className={wrapClass}>
      <nav
        className="sidebar collapsed velo-nav-rail"
        id="mainSidebar"
        aria-label="NavegaÃ§Ã£o"
      >
        <div className="velo-nav-rail__head">
          <button
            type="button"
            className="velo-nav-rail-chevron"
            id="btnSidebarPin"
            onClick={togglePinned}
            aria-expanded={pinned}
            aria-label={pinned ? 'Recolher menu lateral' : 'Fixar menu lateral com textos'}
            title={pinned ? 'Recolher menu' : 'Expandir menu com textos'}
          >
            <i className={'ti ti-chevron-' + (pinned ? 'left' : 'right')} aria-hidden="true" />
          </button>
        </div>
        <ul className="nav-list">
          {renderNavList()}
        </ul>
        <div className="velo-nav-rail__foot">
          <div ref={bellAnchorRef} className="velo-nav-rail__foot-actions" data-tooltip="Notificações">
            <div
              className={
                'notification-bell ws360-notification-bell velo-nav-rail__alerts-bell'
                + (popoverOpen ? ' is-open' : '')
                + (pulseBadgeCount > 0 ? ' is-pulse' : '')
              }
              id="btnAlertsNav"
              data-tooltip="Notificações"
              title="Notificações — tickets, alertas e VeloNews"
              onClick={togglePopover}
              onKeyDown={(e) => navKeyActivate(e, togglePopover)}
              role="button"
              tabIndex={0}
              aria-label="Notificações — tickets, alertas e VeloNews"
              aria-expanded={popoverOpen}
            >
              <i className="fas fa-bell" />
              {footerBadgeCount > 0 ? (
                <span className="notification-badge" aria-label={`${footerBadgeCount} não lidos`}>
                  {footerBadgeCount}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="velo-nav-rail__logout-btn"
              data-tooltip="Sair"
              title="Sair da conta"
              aria-label="Sair da conta"
              onClick={logout}
            >
              <i className="ti ti-logout" aria-hidden="true" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </nav>
      <VeloNewsPopover />
    </div>
  );
}
