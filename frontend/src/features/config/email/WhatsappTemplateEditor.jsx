/**
 * WhatsappTemplateEditor — formulário de criação de modelo de mensagem WhatsApp
 * (categoria, nome, disponibilidade e conteúdo). Ainda sem persistência real —
 * salvar só valida e volta pra lista.
 */
import React, { useRef, useState } from 'react';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';

const CATEGORIAS = [
  { id: 'marketing', label: 'Marketing', icon: 'ti-speakerphone' },
  { id: 'utilitario', label: 'Utilitário', icon: 'ti-bell' },
];

const NOME_MAX = 512;
const CORPO_MAX = 1024;
const RODAPE_MAX = 60;
const CABECALHO_MAX = 60;
const MAX_BOTOES = 10;

function wrapSelection(textareaRef, value, marker, onChange) {
  const el = textareaRef?.current;
  if (!el) {
    onChange(`${value}${marker}${marker}`);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const cursor = start + marker.length + selected.length + marker.length;
    el.setSelectionRange(cursor, cursor);
  });
}

function insertAtCursor(textareaRef, value, token, onChange) {
  const el = textareaRef?.current;
  if (!el) {
    onChange(`${value}${token}`);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    const cursor = start + token.length;
    el.setSelectionRange(cursor, cursor);
  });
}

const PREVIEW_TOKEN_RE = /\*(.+?)\*|_(.+?)_|~(.+?)~|(\{\{\d+\}\})/g;

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

/** Prévia ao vivo da mensagem — mesma estrutura que o cliente recebe no WhatsApp. */
function WhatsappPreviewCard({ cabecalhoTipo, cabecalhoTexto, corpo, rodape, botoes }) {
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

export default function WhatsappTemplateEditor({ onClose }) {
  const { showNotification } = useNotifications();
  const { agentOptions } = useDeskColaboradores();

  const [categoria, setCategoria] = useState('marketing');
  const [nome, setNome] = useState('');
  const [disponibilidade, setDisponibilidade] = useState(['Todos os usuários']);
  const [cabecalhoTipo, setCabecalhoTipo] = useState('nenhum');
  const [cabecalhoTexto, setCabecalhoTexto] = useState('');
  const [corpo, setCorpo] = useState('');
  const [rodape, setRodape] = useState('');
  const [botoes, setBotoes] = useState([]);
  const corpoRef = useRef(null);

  const disponibilidadeOptions = ['Todos os usuários', ...agentOptions]
    .filter((opt) => !disponibilidade.includes(opt));

  const handleAddDisponibilidade = (value) => {
    if (!value || disponibilidade.includes(value)) return;
    setDisponibilidade((prev) => [...prev, value]);
  };

  const handleRemoveDisponibilidade = (value) => {
    setDisponibilidade((prev) => prev.filter((item) => item !== value));
  };

  const handleAddVariavel = () => {
    const count = (corpo.match(/\{\{\d+\}\}/g) || []).length;
    insertAtCursor(corpoRef, corpo, `{{${count + 1}}}`, setCorpo);
  };

  const handleAddBotao = () => {
    if (botoes.length >= MAX_BOTOES) return;
    setBotoes((prev) => [...prev, { id: Date.now(), texto: '' }]);
  };

  const handleUpdateBotao = (id, texto) => {
    setBotoes((prev) => prev.map((item) => (item.id === id ? { ...item, texto } : item)));
  };

  const handleRemoveBotao = (id) => {
    setBotoes((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = () => {
    if (!nome.trim()) {
      showNotification('Informe o nome do modelo.', 'warning');
      return;
    }
    if (!corpo.trim()) {
      showNotification('Informe o corpo da mensagem.', 'warning');
      return;
    }
    showNotification('Formulário validado — integração de salvamento ainda não implementada.', 'info');
    onClose?.();
  };

  return (
    <div className="config-whatsapp-template-editor">
      <div className="config-whatsapp-template-editor__head">
        <h3>Novo modelo de mensagem</h3>
        <p className="config-placeholder-msg">Configure e crie o seu modelo de mensagem.</p>
      </div>

      <div className="config-whatsapp-template-editor__body">
      <div className="config-whatsapp-template-editor__form">
      <section className="config-whatsapp-template-editor__section">
        <h4>Categoria</h4>
        <p className="config-placeholder-msg">Escolha uma categoria que melhor descreva seu modelo de mensagem.</p>

        <div className="config-whatsapp-template-editor__categorias" role="tablist" aria-label="Categoria do modelo">
          {CATEGORIAS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={categoria === item.id}
              className={'config-whatsapp-template-editor__categoria-tab' + (categoria === item.id ? ' is-active' : '')}
              onClick={() => setCategoria(item.id)}
            >
              <i className={'ti ' + item.icon} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="config-whatsapp-template-editor__section">
        <h4>Nome</h4>
        <p className="config-placeholder-msg">Dê um nome para o seu modelo de mensagem.</p>

        <label className="config-email-field">
          <div className="config-whatsapp-template-editor__field-head">
            <span>Nome do modelo *</span>
            <span className="config-whatsapp-template-editor__counter">{nome.length}/{NOME_MAX}</span>
          </div>
          <input
            type="text"
            value={nome}
            maxLength={NOME_MAX}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Insira o nome do modelo de mensagem…"
          />
        </label>
      </section>

      <section className="config-whatsapp-template-editor__section">
        <h4>Disponibilidade</h4>
        <p className="config-placeholder-msg">Selecione os grupos e/ou usuários que terão disponibilidade a este modelo de mensagem.</p>

        <div className="grupo-agentes-editor__chips">
          {disponibilidade.map((item) => (
            <span key={item} className="grupo-agentes-editor__chip">
              {item}
              <button
                type="button"
                className="grupo-agentes-editor__chip-remove"
                onClick={() => handleRemoveDisponibilidade(item)}
                aria-label={`Remover ${item}`}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>

        <select
          className="config-whatsapp-template-editor__add-select"
          value=""
          onChange={(e) => handleAddDisponibilidade(e.target.value)}
          aria-label="Adicionar grupo ou usuário"
        >
          <option value="">+ Adicionar grupo ou usuário…</option>
          {disponibilidadeOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </section>

      <section className="config-whatsapp-template-editor__section">
        <h4>Conteúdo</h4>
        <p className="config-placeholder-msg">Preencha as seções de cabeçalho, corpo e rodapé do seu modelo.</p>

        <label className="config-email-field">
          <span>Cabeçalho (Opcional)</span>
          <select value={cabecalhoTipo} onChange={(e) => setCabecalhoTipo(e.target.value)}>
            <option value="nenhum">Nenhum</option>
            <option value="texto">Texto</option>
          </select>
        </label>

        {cabecalhoTipo === 'texto' ? (
          <label className="config-email-field">
            <div className="config-whatsapp-template-editor__field-head">
              <span>Texto do cabeçalho</span>
              <span className="config-whatsapp-template-editor__counter">{cabecalhoTexto.length}/{CABECALHO_MAX}</span>
            </div>
            <input
              type="text"
              value={cabecalhoTexto}
              maxLength={CABECALHO_MAX}
              onChange={(e) => setCabecalhoTexto(e.target.value)}
              placeholder="Insira o texto do cabeçalho…"
            />
          </label>
        ) : null}

        <label className="config-email-field">
          <div className="config-whatsapp-template-editor__field-head">
            <span>Corpo da mensagem</span>
            <span className="config-whatsapp-template-editor__counter">{corpo.length}/{CORPO_MAX}</span>
          </div>
          <textarea
            ref={corpoRef}
            rows={6}
            value={corpo}
            maxLength={CORPO_MAX}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder="Insira o texto do corpo da mensagem…"
          />
          <div className="config-whatsapp-template-editor__format-toolbar">
            <button type="button" title="Negrito" onClick={() => wrapSelection(corpoRef, corpo, '*', setCorpo)}>
              <strong>B</strong>
            </button>
            <button type="button" title="Itálico" onClick={() => wrapSelection(corpoRef, corpo, '_', setCorpo)}>
              <em>I</em>
            </button>
            <button type="button" title="Tachado" onClick={() => wrapSelection(corpoRef, corpo, '~', setCorpo)}>
              <s>S</s>
            </button>
            <button type="button" title="Emoji" onClick={() => insertAtCursor(corpoRef, corpo, '🙂', setCorpo)}>
              <i className="ti ti-mood-smile" aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="config-whatsapp-template-editor__variable-btn" onClick={handleAddVariavel}>
            <i className="ti ti-plus" aria-hidden="true" />
            Adicionar variável
            <i className="ti ti-info-circle" title="Insere {{1}}, {{2}}… — substituídos pelo conteúdo real no envio" aria-hidden="true" />
          </button>
        </label>

        <label className="config-email-field">
          <div className="config-whatsapp-template-editor__field-head">
            <span>Rodapé (Opcional)</span>
            <span className="config-whatsapp-template-editor__counter">{rodape.length}/{RODAPE_MAX}</span>
          </div>
          <input
            type="text"
            value={rodape}
            maxLength={RODAPE_MAX}
            onChange={(e) => setRodape(e.target.value)}
            placeholder="Insira o texto do rodapé…"
          />
        </label>

        <div className="config-whatsapp-template-editor__botoes">
          <div className="config-whatsapp-template-editor__botoes-head">
            <h4>Botões <span className="config-whatsapp-template-editor__badge">Opcional</span></h4>
            <p className="config-placeholder-msg">
              Crie botões que permitam que os clientes respondam à sua mensagem ou realizem uma ação.
              É possível adicionar até 10 botões. Se você adicionar mais de 3 botões, eles aparecerão em uma lista.
            </p>
          </div>

          {botoes.length ? (
            <ul className="config-whatsapp-template-editor__botoes-list">
              {botoes.map((botao) => (
                <li key={botao.id}>
                  <input
                    type="text"
                    value={botao.texto}
                    maxLength={25}
                    placeholder="Texto do botão…"
                    onChange={(e) => handleUpdateBotao(botao.id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="config-action-btn config-action-btn--delete"
                    onClick={() => handleRemoveBotao(botao.id)}
                    aria-label="Remover botão"
                  >
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            className="config-action-btn config-action-btn--create"
            onClick={handleAddBotao}
            disabled={botoes.length >= MAX_BOTOES}
          >
            <i className="ti ti-plus" aria-hidden="true" /> Adicionar botão
          </button>
        </div>
      </section>

      <div className="config-whatsapp-template-editor__footer">
        <button type="button" className="config-action-btn config-action-btn--edit" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="config-action-btn config-action-btn--create" onClick={handleSave}>
          Salvar
        </button>
      </div>
      </div>

      <WhatsappPreviewCard
        cabecalhoTipo={cabecalhoTipo}
        cabecalhoTexto={cabecalhoTexto}
        corpo={corpo}
        rodape={rodape}
        botoes={botoes}
      />
      </div>
    </div>
  );
}
