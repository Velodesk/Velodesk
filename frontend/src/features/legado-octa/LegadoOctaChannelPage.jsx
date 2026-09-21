/**
 * LegadoOctaChannelPage — módulo "Legado Octa": arquivo somente-consulta do
 * histórico Octadesk. Isolado da navegação normal de chamados do Velodesk.
 */
import React, { useEffect } from 'react';
import LegadoOctaRouter from './LegadoOctaRouter';

export default function LegadoOctaChannelPage() {
  useEffect(() => {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return undefined;
    mainContent.classList.remove('tickets-active');
    return () => {};
  }, []);

  return (
    <div className="page active legado-octa-page-wrap" id="legado-octa">
      <LegadoOctaRouter />
    </div>
  );
}
