/**
 * WhatsappTemplateEditor — formulário de criação de modelo de mensagem WhatsApp
 * (categoria, nome, disponibilidade e conteúdo). Ainda sem persistência real —
 * salvar só valida e volta pra lista.
 */
import React, { useEffect, useRef, useState } from 'react';
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
const BOTAO_TEXTO_MAX = 25;
const BOTAO_URL_MAX = 2000;
const BOTAO_TELEFONE_MAX = 20;

/** Chamada para ação — tipos de botão e quantos de cada o WhatsApp aceita por modelo. */
const ACOES_BOTAO = [
  { id: 'ligar', label: 'Ligar', menuLabel: 'Ligar', max: 1 },
  { id: 'site', label: 'Acessar Site', menuLabel: 'Acessar o site', max: 2 },
];

const DDI_OPCOES = [
  { id: '+55', label: '🇧🇷 +55' },
  { id: '+1', label: '🇺🇸 +1' },
  { id: '+351', label: '🇵🇹 +351' },
  { id: '+54', label: '🇦🇷 +54' },
];

const URL_TIPOS = [
  { id: 'estatico', label: 'Estático' },
  { id: 'dinamico', label: 'Dinâmico' },
];

function novoBotao(tipo) {
  return {
    id: Date.now(),
    tipo,
    texto: '',
    ddi: '+55',
    telefone: '',
    urlTipo: 'estatico',
    url: '',
  };
}

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
                    <i className={'ti ' + (botao.tipo === 'ligar' ? 'ti-phone' : 'ti-external-link')} aria-hidden="true" />
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
  const [acaoMenuOpen, setAcaoMenuOpen] = useState(false);
  const corpoRef = useRef(null);
  const acaoMenuRef = useRef(null);

  useEffect(() => {
    if (!acaoMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!acaoMenuRef.current?.contains(event.target)) setAcaoMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setAcaoMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [acaoMenuOpen]);

  /** Ainda cabe mais um botão desse tipo? `ignorarId` desconsidera o próprio botão ao trocar o tipo. */
  const acaoDisponivel = (tipo, ignorarId = null) => {
    const acao = ACOES_BOTAO.find((item) => item.id === tipo);
    const usados = botoes.filter((item) => item.tipo === tipo && item.id !== ignorarId).length;
    return Boolean(acao) && usados < acao.max;
  };
  const algumaAcaoDisponivel = ACOES_BOTAO.some((acao) => acaoDisponivel(acao.id));

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

  const handleAddBotao = (tipo) => {
    setAcaoMenuOpen(false);
    if (!acaoDisponivel(tipo)) return;
    setBotoes((prev) => [...prev, novoBotao(tipo)]);
  };

  const handleUpdateBotao = (id, patch) => {
    setBotoes((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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
    const botaoIncompleto = botoes.find((item) => (
      !item.texto.trim()
      || (item.tipo === 'ligar' && !item.telefone.trim())
      || (item.tipo === 'site' && !item.url.trim())
    ));
    if (botaoIncompleto) {
      showNotification('Preencha todos os campos obrigatórios dos botões.', 'warning');
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
              Crie botões que permitam que os clientes realizem uma ação: ligar (1 botão no máximo)
              ou acessar um site (2 botões no máximo).
            </p>
          </div>

          {botoes.length ? (
            <div className="config-whatsapp-template-editor__cta">
              <h5 className="config-whatsapp-template-editor__cta-title">Chamada para ação</h5>
              <ul className="config-whatsapp-template-editor__cta-list">
                {botoes.map((botao) => (
                  <li key={botao.id} className="config-whatsapp-template-editor__cta-item">
                    <div className="config-whatsapp-template-editor__cta-card">
                      <div className="config-whatsapp-template-editor__cta-row">
                        <label className="config-email-field">
                          <span>Tipo de ação</span>
                          <select
                            value={botao.tipo}
                            onChange={(e) => handleUpdateBotao(botao.id, { tipo: e.target.value })}
                          >
                            {ACOES_BOTAO.map((acao) => (
                              <option
                                key={acao.id}
                                value={acao.id}
                                disabled={acao.id !== botao.tipo && !acaoDisponivel(acao.id, botao.id)}
                              >
                                {acao.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {botao.tipo === 'ligar' ? (
                          <label className="config-email-field">
                            <span>Telefone *</span>
                            <div className="config-whatsapp-template-editor__phone">
                              <select
                                value={botao.ddi}
                                onChange={(e) => handleUpdateBotao(botao.id, { ddi: e.target.value })}
                                aria-label="Código do país"
                              >
                                {DDI_OPCOES.map((ddi) => (
                                  <option key={ddi.id} value={ddi.id}>{ddi.label}</option>
                                ))}
                              </select>
                              <input
                                type="tel"
                                value={botao.telefone}
                                maxLength={BOTAO_TELEFONE_MAX}
                                placeholder="(11) 99999-9999"
                                onChange={(e) => handleUpdateBotao(botao.id, { telefone: e.target.value })}
                              />
                            </div>
                          </label>
                        ) : (
                          <label className="config-email-field">
                            <span>Tipo de URL *</span>
                            <select
                              value={botao.urlTipo}
                              onChange={(e) => handleUpdateBotao(botao.id, { urlTipo: e.target.value })}
                            >
                              {URL_TIPOS.map((tipo) => (
                                <option key={tipo.id} value={tipo.id}>{tipo.label}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>

                      <label className="config-email-field">
                        <div className="config-whatsapp-template-editor__field-head">
                          <span>Texto do botão *</span>
                          <span className="config-whatsapp-template-editor__counter">{botao.texto.length}/{BOTAO_TEXTO_MAX}</span>
                        </div>
                        <input
                          type="text"
                          value={botao.texto}
                          maxLength={BOTAO_TEXTO_MAX}
                          placeholder="Insira o texto do botão…"
                          onChange={(e) => handleUpdateBotao(botao.id, { texto: e.target.value })}
                        />
                      </label>

                      {botao.tipo === 'site' ? (
                        <label className="config-email-field">
                          <div className="config-whatsapp-template-editor__field-head">
                            <span>URL do site *</span>
                            <span className="config-whatsapp-template-editor__counter">{botao.url.length}/{BOTAO_URL_MAX}</span>
                          </div>
                          <input
                            type="url"
                            value={botao.url}
                            maxLength={BOTAO_URL_MAX}
                            placeholder="https://www.exemplo.com"
                            onChange={(e) => handleUpdateBotao(botao.id, { url: e.target.value })}
                          />
                        </label>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className="config-whatsapp-template-editor__cta-remove"
                      onClick={() => handleRemoveBotao(botao.id)}
                      aria-label="Remover botão"
                    >
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="config-whatsapp-template-editor__acao-anchor" ref={acaoMenuRef}>
            <button
              type="button"
              className="config-action-btn config-action-btn--create"
              onClick={() => setAcaoMenuOpen((prev) => !prev)}
              disabled={!algumaAcaoDisponivel}
              aria-haspopup="menu"
              aria-expanded={acaoMenuOpen}
            >
              <i className="ti ti-plus" aria-hidden="true" /> Adicionar botão
            </button>

            {acaoMenuOpen ? (
              <div className="config-whatsapp-template-editor__acao-menu" role="menu">
                <p className="config-whatsapp-template-editor__acao-menu-title">Chamada para ação</p>
                {ACOES_BOTAO.map((acao) => (
                  <button
                    key={acao.id}
                    type="button"
                    role="menuitem"
                    className="config-whatsapp-template-editor__acao-menu-item"
                    onClick={() => handleAddBotao(acao.id)}
                    disabled={!acaoDisponivel(acao.id)}
                  >
                    <span className="config-whatsapp-template-editor__acao-menu-label">{acao.menuLabel}</span>
                    <span className="config-whatsapp-template-editor__acao-menu-hint">
                      {acao.max} {acao.max === 1 ? 'botão' : 'botões'} no máximo
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
