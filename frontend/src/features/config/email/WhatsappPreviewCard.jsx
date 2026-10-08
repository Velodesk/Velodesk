/**
 * WhatsappPreviewCard — simulação de como a mensagem aparece no WhatsApp do cliente.
 * Usado tanto ao vivo (enquanto o formulário é preenchido) quanto na visualização de um
 * modelo já salvo (WhatsappTemplatePreviewModal).
 */
import React from 'react';

const PREVIEW_TOKEN_RE = /\*(.+?)\*|_(.+?)_|~(.+?)~|(\{\{\d+\}\})/g;

const BOTAO_ICONE = {
  ligar: 'ti-phone',
  acessar_site: 'ti-external-link',
  copiar_codigo: 'ti-copy',
};

/** Renderiza *negrito*, _itálico_, ~tachado~ e {{n}} do corpo como no app do WhatsApp. */
function renderWhatsappPreviewBody(text) {
  return text.split('\n').map((line, lineIndex) => {
    const nodes = [];
    let lastIndex = 0;
    let match;
    const re = new RegExp(PREVIEW_TOKEN_RE);
    while ((match = re.exec(line))) {
      if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));
      if (match[1] !== undefined) {
        nodes.push(<strong key={`${lineIndex}-${match.index}`}>{match[1]}</strong>);
      } else if (match[2] !== undefined) {
        nodes.push(<em key={`${lineIndex}-${match.index}`}>{match[2]}</em>);
      } else if (match[3] !== undefined) {
        nodes.push(<s key={`${lineIndex}-${match.index}`}>{match[3]}</s>);
      } else if (match[4] !== undefined) {
        nodes.push(
          <span key={`${lineIndex}-${match.index}`} className="config-whatsapp-preview__variable">
            {match[4]}
          </span>,
        );
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
    return (
      <React.Fragment key={lineIndex}>
        {lineIndex > 0 ? <br /> : null}
        {nodes}
      </React.Fragment>
    );
  });
}

/** Prévia da mensagem — mesma estrutura que o cliente recebe no WhatsApp. */
export default function WhatsappPreviewCard({ cabecalhoTipo, cabecalhoTexto, corpo, rodape, botoes }) {
  const temCabecalho = cabecalhoTipo === 'texto' && cabecalhoTexto.trim().length > 0;
  const corpoPreenchido = corpo.trim().length > 0;
  const botoesPreenchidos = botoes.filter((item) => item.texto.trim().length > 0);
  const mostrarComoLista = botoesPreenchidos.length > 3;

  return (
    <aside className="config-whatsapp-preview" aria-label="Prévia da mensagem no WhatsApp">
      <h4>Como o cliente vê</h4>
      <div className="config-whatsapp-preview__phone">
        <div className="config-whatsapp-preview__bar">
          <span className="config-whatsapp-preview__avatar">
            <i className="ti ti-brand-whatsapp" aria-hidden="true" />
          </span>
          <div className="config-whatsapp-preview__bar-text">
            <strong>Velotax</strong>
            <span>via WhatsApp Business</span>
          </div>
        </div>

        <div className="config-whatsapp-preview__chat">
          <div className="config-whatsapp-preview__bubble">
            {temCabecalho ? (
              <p className="config-whatsapp-preview__header">{cabecalhoTexto}</p>
            ) : null}

            <p className={'config-whatsapp-preview__body' + (corpoPreenchido ? '' : ' is-placeholder')}>
              {corpoPreenchido ? renderWhatsappPreviewBody(corpo) : 'Sua mensagem aparecerá aqui conforme você digita…'}
            </p>

            {rodape.trim() ? (
              <p className="config-whatsapp-preview__footer-text">{rodape}</p>
            ) : null}

            <span className="config-whatsapp-preview__time">
              12:00 <i className="ti ti-checks" aria-hidden="true" />
            </span>
          </div>

          {botoesPreenchidos.length ? (
            <div className="config-whatsapp-preview__botoes">
              {mostrarComoLista ? (
                <button type="button" tabIndex={-1}>
                  <i className="ti ti-list" aria-hidden="true" />
                  Ver todas as opções
                </button>
              ) : (
                botoesPreenchidos.map((botao) => (
                  <button type="button" tabIndex={-1} key={botao.id}>
                    {BOTAO_ICONE[botao.tipo] ? <i className={'ti ' + BOTAO_ICONE[botao.tipo]} aria-hidden="true" /> : null}
                    {botao.texto}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
