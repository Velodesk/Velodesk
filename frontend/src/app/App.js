/**
 * App raiz — providers + rotas
 * VERSION: v2.7.1 | DATE: 2026-08-12 | AUTHOR: VeloHub Development Team
 * — Painel do sininho (NotificationPanel)
 */

import React, { useEffect } from 'react';

import { useRoutes } from 'react-router-dom';

import CockpitBridge from '../components/CockpitBridge';
import NotificationPanel from '../components/NotificationPanel';

import { AuthProvider } from '../context/AuthContext';

import { NotificationProvider } from '../context/NotificationContext';

import { ThemeProvider } from '../context/ThemeContext';

import { TicketsProvider } from '../context/TicketsContext';
import { TicketPresenceProvider } from '../context/TicketPresenceContext';

import { ProfileProvider } from '../context/ProfileContext';
import { TabulationProvider } from '../context/TabulationContext';
import { WorkflowConfigProvider } from '../context/WorkflowConfigContext';

import ProtectedRoute from '../routes/ProtectedRoute';

import DefaultLandingRedirect from '../routes/DefaultLandingRedirect';

import DeskLoginPage from '../features/auth/DeskLoginPage';

import AppShell from '../layout/AppShell';

import WorkspacePage from '../pages/WorkspacePage';

import TicketsPage from '../pages/TicketsPage';


import ConfigPage from '../pages/ConfigPage';

import PreferenciasPage from '../pages/PreferenciasPage';

import TicketSearchPage from '../pages/TicketSearchPage';

import ReportsPage from '../pages/ReportsPage';

import ClientPortalPage from '../pages/ClientPortalPage';
import WorkflowPage from '../pages/WorkflowPage';
// TEMP (dev local): WorkflowFinalizadosPage referencia exports que ainda não existem em
// workflowApprovalData.js/workflowTeamQueues.js e quebra o boot do Vite. Religar quando essa
// feature (WIP de outra sessão) estiver com os exports implementados.
// import WorkflowFinalizadosPage from '../features/workflow/WorkflowFinalizadosPage';
import AlteracoesCadastraisPage from '../pages/AlteracoesCadastraisPage';
import EspeciaisSelectPage from '../features/especiais/EspeciaisSelectPage';
import EspeciaisChannelPage from '../features/especiais/EspeciaisChannelPage';
import ReclameAquiChannelPage from '../features/especiais/ReclameAquiChannelPage';
import ProconChannelPage from '../features/especiais/ProconChannelPage';
import ConsumidorGovChannelPage from '../features/especiais/ConsumidorGovChannelPage';
import BacenChannelPage from '../features/especiais/BacenChannelPage';
import LegadoOctaChannelPage from '../features/legado-octa/LegadoOctaChannelPage';
import CasoEspecialDetailPage from '../features/workspace/components/gestaoDetail/CasoEspecialDetailPage';
import AiUsageDetailPage from '../features/workspace/components/gestaoDetail/AiUsageDetailPage';
import CsatDetailPage from '../features/workspace/components/gestaoDetail/CsatDetailPage';
import AtendimentoIaTelefonicoPage from '../pages/AtendimentoIaTelefonicoPage';
import { PermissionProvider } from '../context/PermissionContext';

import { initCockpitGlobals } from '../config/cockpitConfig';

import { setApiMode } from '../services/ticketsCache';



function AppRoutes() {

  return useRoutes([

    { path: '/login', element: React.createElement(DeskLoginPage) },

    {

      element: React.createElement(ProtectedRoute),

      children: [

        {

          element: React.createElement(AppShell),

          children: [

            { index: true, element: React.createElement(DefaultLandingRedirect) },

            { path: 'workspace', element: React.createElement(WorkspacePage) },

            { path: 'workspace/gestao/casos-especiais/:orgao', element: React.createElement(CasoEspecialDetailPage) },

            { path: 'workspace/gestao/custo-ia', element: React.createElement(AiUsageDetailPage) },

            { path: 'workspace/gestao/csat', element: React.createElement(CsatDetailPage) },

            { path: 'workflow', element: React.createElement(WorkflowPage) },

            // { path: 'workflow/finalizados', element: React.createElement(WorkflowFinalizadosPage) },

            { path: 'reports', element: React.createElement(ReportsPage) },

            { path: 'tickets', element: React.createElement(TicketsPage) },

            { path: 'alteracoes-cadastrais', element: React.createElement(AlteracoesCadastraisPage) },

            { path: 'especiais', element: React.createElement(EspeciaisSelectPage) },

            { path: 'especiais/reclame-aqui/*', element: React.createElement(ReclameAquiChannelPage) },

            { path: 'especiais/procon/*', element: React.createElement(ProconChannelPage) },

            { path: 'especiais/consumidor-gov/*', element: React.createElement(ConsumidorGovChannelPage) },

            { path: 'especiais/bacen/*', element: React.createElement(BacenChannelPage) },

            { path: 'especiais/:channelId', element: React.createElement(EspeciaisChannelPage) },

            { path: 'legado-octa/*', element: React.createElement(LegadoOctaChannelPage) },

            { path: 'config', element: React.createElement(ConfigPage) },

            { path: 'preferencias', element: React.createElement(PreferenciasPage) },

            { path: 'busca-tickets', element: React.createElement(TicketSearchPage) },

            { path: 'atendimento-ia-telefonico/*', element: React.createElement(AtendimentoIaTelefonicoPage) },


            { path: 'client-portal', element: React.createElement(ClientPortalPage) },

          ],

        },

      ],

    },

    { path: '*', element: React.createElement(DefaultLandingRedirect) },

  ]);

}



function AppProviders({ children }) {

  return React.createElement(

    AuthProvider,

    null,

    React.createElement(

      NotificationProvider,

      null,

      React.createElement(

        ThemeProvider,

        null,

        React.createElement(

          TicketsProvider,

          null,

          React.createElement(TicketPresenceProvider, null,
            React.createElement(PermissionProvider, null,
              React.createElement(ProfileProvider, null,
                React.createElement(TabulationProvider, null,
                  React.createElement(WorkflowConfigProvider, null, children)
                )
              )
            )
          )

        )

      )

    )

  );

}



export default function App() {

  useEffect(() => {
    initCockpitGlobals();
    setApiMode(true);
  }, []);



  return React.createElement(

    AppProviders,

    null,

    React.createElement(CockpitBridge),

    React.createElement(NotificationPanel),

    React.createElement(AppRoutes)

  );

}

