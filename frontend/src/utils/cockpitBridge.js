/**
 * Ponte global — navegação e ações do cockpit ↔ React Router
 * VERSION: v2.4.1 | DATE: 2026-08-21
 */
const PAGE_ROUTES = {
  workspace: '/workspace',
  tickets: '/tickets?desk=v2',
  'tickets-resolvidos': '/tickets?desk=v2&queue=resolvidos',
  'busca-tickets': '/busca-tickets',
  preferencias: '/preferencias',
  'atendimento-ia-telefonico': '/atendimento-ia-telefonico',
  'alteracoes-cadastrais': '/alteracoes-cadastrais',
  especiais: '/workspace',
  'especiais-reclame-aqui': '/especiais/reclame-aqui',
  'especiais-procon': '/especiais/procon',
  'especiais-consumidor-gov': '/especiais/consumidor-gov',
  'especiais-bacen': '/especiais/bacen',
  'especiais-processos': '/especiais/processos',
  'workflow-inbox': '/workflow',
  'workflow-finalizados': '/workflow?view=finalizados',
  reports: '/reports',
  config: '/config',
  'analytics-ia': '/analytics-ia',
};

const ESPECIAIS_PAGE_IDS = new Set([
  'especiais-reclame-aqui',
  'especiais-procon',
  'especiais-consumidor-gov',
  'especiais-bacen',
  'especiais-processos',
]);

function isEspeciaisPageId(page) {
  return ESPECIAIS_PAGE_IDS.has(page);
}

function resolveOpenTicketPath(profileId, ticketId) {
  if (profileId === 'workflow') {
    return ticketId ? `/workflow?ticket=${ticketId}` : '/workflow';
  }
  return ticketId ? `/tickets?desk=v2&ticket=${ticketId}` : '/tickets?desk=v2';
}

export function installCockpitBridge(navigate, showNotification, ticketActions = {}) {
  const profileId = ticketActions.profileId || 'agent';

  window.navigateToPage = function navigateToPage(page) {
    if (page === 'tickets' && profileId === 'workflow') {
      navigate('/workflow');
      return;
    }

    const route = PAGE_ROUTES[page] || '/workspace';
    const targetPath = String(route).split('?')[0];

    // React Router monta páginas com .active — remover antes do navigate causa tela em branco
    if (!isEspeciaisPageId(page) && targetPath !== '/workflow' && targetPath !== window.location.pathname) {
      document.querySelectorAll('.page').forEach((p) => {
        p.classList.remove('active', 'ticket-tab-open');
      });
    }

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      if (page === 'tickets' || page === 'tickets-resolvidos') {
        mainContent.style.background = 'transparent';
        mainContent.classList.add('tickets-active');
      } else if (isEspeciaisPageId(page)) {
        mainContent.classList.remove('tickets-active');
        mainContent.style.background = 'transparent';
      } else {
        mainContent.classList.remove('tickets-active');
        mainContent.style.background = 'var(--light-gray)';
      }
    }

    navigate(route);
  };

  window.navigateToPageMobile = window.navigateToPage;

  window.syncMainSidebarNav = function syncMainSidebarNav(page) {
    document.querySelectorAll('#mainSidebar .nav-item[data-page]').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
  };

  window.openQuickRegisterModal = function openQuickRegisterModal() {
    if (profileId === 'workflow') {
      navigate('/workflow');
      return;
    }
    navigate('/tickets?desk=v2');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('velodesk:quick-register'));
    }, 0);
  };

  window.closeQuickRegisterModal = function closeQuickRegisterModal() {
    window.dispatchEvent(new CustomEvent('velodesk:quick-register-close'));
  };

  if (ticketActions.openTicket) {
    window.openTicket = function openTicket(ticketId) {
      if (profileId !== 'workflow') {
        ticketActions.openTicket(ticketId);
      }
      navigate(resolveOpenTicketPath(profileId, ticketId));
    };
  }

  if (ticketActions.refreshTickets) {
    window.refreshTickets = function refreshTickets() {
      return ticketActions.refreshTickets();
    };
  }

  window.dispatchRefreshTickets = function dispatchRefreshTickets() {
    window.dispatchEvent(new CustomEvent('velodesk:refresh-tickets'));
  };

  window.showNotification = function cockpitShowNotification(message, type) {
    showNotification(message, type || 'info');
  };
}
