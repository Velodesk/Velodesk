/**
 * AppShell — layout cockpit
 * VERSION: v2.6.0 | DATE: 2026-07-27
 */
import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TicketTabsBar from '../components/TicketTabsBar';
import EspeciaisLayoutSync from '../components/EspeciaisLayoutSync';
import AgentPresenceHeartbeat from '../components/AgentPresenceHeartbeat';
import { VeloNewsProvider } from '../features/velonews/VeloNewsProvider';
import VeloNewsTicker from '../features/velonews/VeloNewsTicker';
import VeloNewsCriticalBubble from '../features/velonews/VeloNewsCriticalBubble';
import VeloNewsCriticalModal from '../features/velonews/VeloNewsCriticalModal';
import VeloNewsReadModal from '../features/velonews/VeloNewsReadModal';
import VeloNewsHistoryModal from '../features/velonews/VeloNewsHistoryModal';

export default function AppShell() {
  return (
    <VeloNewsProvider>
      <VeloNewsTicker />
      <AgentPresenceHeartbeat />
      <EspeciaisLayoutSync />
      <div id="mainApp" className="main-app sidebar-collapsed velo-chromeless" style={{ display: 'grid' }}>
        <TicketTabsBar />
        <Sidebar />
        <main className="main-content sidebar-collapsed">
          <Outlet />
        </main>
      </div>
      <VeloNewsCriticalBubble />
      <VeloNewsCriticalModal />
      <VeloNewsReadModal />
      <VeloNewsHistoryModal />
    </VeloNewsProvider>
  );
}
