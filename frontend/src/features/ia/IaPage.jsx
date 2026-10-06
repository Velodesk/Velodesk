/**
 * IaPage v1.2.0 — Área de IA (barra lateral, logo abaixo de Tickets)
 * Tickets abertos no layout padrão do Desk, sem o composer de texto; fila só com a caixa Novos.
 * Os motivos que encaminham um ticket para esta área ainda serão definidos.
 */
import React, { useEffect } from 'react';
import DeskPortal from '../desk/DeskPortal';

const IA_QUEUE_IDS = ['novos'];

export default function IaPage() {
  useEffect(() => {
    document.body.classList.add('desk-v2-mode');
    return () => document.body.classList.remove('desk-v2-mode');
  }, []);

  return <DeskPortal hideComposer queueIds={IA_QUEUE_IDS} />;
}
