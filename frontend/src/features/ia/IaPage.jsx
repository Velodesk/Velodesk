/**
 * IaPage v1.3.0 — Área de IA (barra lateral, logo abaixo de Tickets)
 * Fila de aprovação humana: lista só os tickets que o agente autônomo já respondeu e tabulou
 * (aiAutomation.status = aguardando_aprovacao). A resposta e a tabulação já estão prontas ao abrir o ticket;
 * o auditor humano só aprova (envia, tabula e resolve) ou reprova (a IA refaz; na 2ª reprovação volta ao humano).
 * Nenhuma sugestão é gerada ao entrar no módulo.
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
