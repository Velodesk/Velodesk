/**
 * ticketPrint v2.0.0 — extrato do ticket (Desk e casos especiais), padrão Octadesk.
 * O HTML é renderizado no servidor (GET /api/chamados/:protocolo/extrato.html, com checagem de
 * permissão e log de auditoria). A aba é aberta já no clique (senão o navegador bloqueia como
 * pop-up), mostra "Gerando extrato…" e recebe o HTML buscado com o Bearer — o token nunca vai na URL.
 */
import { chamadoExtratoApi } from '../../api/client';

export const DEFAULT_TICKET_PRINT_OPTIONS = {
  publicas: true,
  internas: true,
  automaticas: true,
  whatsapp: true,
};

function writeTab(tab, html) {
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

function messagePage(title, message) {
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title></head>`
    + '<body style="font-family:Poppins,Segoe UI,sans-serif;padding:32px;color:#111827">'
    + `<h1 style="font-size:18px;color:#000058;margin:0 0 8px">${esc(title)}</h1><p style="margin:0;color:#4b5563">${esc(message)}</p></body></html>`;
}

/**
 * Abre o extrato numa nova aba. Chamar direto no clique. Retorna false se o navegador bloqueou a aba.
 * @param {string} protocolo chamadoProtocolo do ticket
 * @param {{publicas:boolean, internas:boolean, automaticas:boolean, whatsapp:boolean}} options
 */
export function openTicketExtract(protocolo, options = DEFAULT_TICKET_PRINT_OPTIONS) {
  if (typeof window === 'undefined') return false;
  const tab = window.open('', '_blank');
  if (!tab) return false;
  writeTab(tab, messagePage(`Extrato do ticket #${protocolo}`, 'Gerando extrato…'));

  const params = {
    publicas: options.publicas ? '1' : '0',
    internas: options.internas ? '1' : '0',
    autom: options.automaticas ? '1' : '0',
    wa: options.whatsapp ? '1' : '0',
    detalhe: '0',
    sla: '0',
  };

  chamadoExtratoApi.getHtml(protocolo, params)
    .then((html) => {
      if (!tab.closed) {
        writeTab(tab, html);
        tab.focus();
      }
    })
    .catch((err) => {
      if (tab.closed) return;
      const body = err?.response?.data;
      // 403/404/500 já vêm como página HTML do servidor.
      writeTab(tab, typeof body === 'string' && body.trim().startsWith('<')
        ? body
        : messagePage('Erro ao gerar extrato', 'Não foi possível gerar o extrato. Tente novamente.'));
    });
  return true;
}
