/**
 * WhatsappTemplateEditor — formulário de criação/edição de modelo de mensagem WhatsApp
 * (categoria, nome, disponibilidade e conteúdo). Salva só o rascunho no nosso banco —
 * usar de verdade pra iniciar conversa fora da janela de 24h ainda depende do modelo ser
 * aprovado pela Meta (contentSid preenchido depois, fora desta tela).
 */
import React, { useRef, useState } from 'react';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';
import { whatsappTemplatesApi } from '../../../api/client';
import WhatsappPreviewCard from './WhatsappPreviewCard';
import { PLACEHOLDER_OPTIONS } from '../components/PlaceholderPicker';

const VARIAVEL_INFO_TEXT = 'Esse é o texto especificado na API que será personalizado para o cliente, como o nome ou o número da fatura.';

/** Mesma lista de variáveis do "Inserir placeholder" (e-mails de saída) — rótulo do botão
 * aqui segue o termo que a Meta usa pra modelo de WhatsApp ("variável"), mesmos tokens. */
function VariavelPicker({ targetRef, value, onChange }) {
  return (
    <div className="config-whatsapp-template-editor__variable-picker">
      <select
        className="config-whatsapp-template-editor__variable-btn"
        value=""
        onChange={(e) => {
          const token = e.target.value;
          if (token) insertAtCursor(targetRef, value, token, onChange);
          e.target.value = '';
        }}
        aria-label="Adicionar variável"
      >
        <option value="">+ Adicionar variável</option>
        {PLACEHOLDER_OPTIONS.map((opt) => (
          <option key={opt.token} value={opt.token}>{opt.label} — {opt.token}</option>
        ))}
      </select>
      <i className="ti ti-info-circle" title={VARIAVEL_INFO_TEXT} aria-hidden="true" />
    </div>
  );
}

const CATEGORIAS = [
  { id: 'marketing', label: 'Marketing', icon: 'ti-speakerphone' },
  { id: 'utilitario', label: 'Utilitário', icon: 'ti-bell' },
  { id: 'autenticacao', label: 'Autenticação', icon: 'ti-shield-lock' },
];

const IDIOMAS = [
  { id: 'pt_BR', label: 'Português (BR)' },
  { id: 'en_US', label: 'Inglês (US)' },
];

const NOME_MAX = 512;
const CORPO_MAX = 1024;
const RODAPE_MAX = 60;
const CABECALHO_MAX = 60;
const MAX_BOTOES = 10;

/** Mesmos tipos e limites do construtor de modelo da Meta: cada grupo é uma categoria de
 * botão, e "max" (quando presente) é o limite de quantos desse tipo um modelo pode ter. */
const BOTAO_GRUPOS = [
  {
    label: 'Resposta rápida',
    opcoes: [
      { tipo: 'personalizado', label: 'Personalizado' },
      { tipo: 'cancelar_marketing', label: 'Cancelar marketing', max: 1 },
    ],
  },
  {
    label: 'Chamada para ação',
    opcoes: [
      { tipo: 'ligar', label: 'Ligar', max: 1 },
      { tipo: 'acessar_site', label: 'Acessar o site', max: 2 },
      { tipo: 'copiar_codigo', label: 'Copiar código da oferta', max: 1 },
    ],
  },
];

const BOTAO_TIPO_LABEL = BOTAO_GRUPOS.flatMap((grupo) => grupo.opcoes).reduce(
  (acc, opcao) => ({ ...acc, [opcao.tipo]: opcao.label }),
  {},
);

function criarBotao(tipo) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (tipo === 'ligar') return { id, tipo, texto: '', telefone: '' };
  if (tipo === 'acessar_site') return { id, tipo, texto: '', tipoUrl: 'estatico', url: '' };
  if (tipo === 'copiar_codigo') return { id, tipo, texto: '', codigoOferta: '' };
  if (tipo === 'cancelar_marketing') {
    return { id, tipo, texto: '', textoRodape: '', confirmacaoResponsabilidade: false };
  }
  return { id, tipo, texto: '' };
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

export default function WhatsappTemplateEditor({ onClose, onSaved, initialTemplate = null }) {
  const { showNotification } = useNotifications();
  const { agentOptions } = useDeskColaboradores();
  const isEditing = Boolean(initialTemplate?.id);

  const [categoria, setCategoria] = useState(initialTemplate?.categoria || 'marketing');
  const [idioma, setIdioma] = useState(initialTemplate?.idioma || 'pt_BR');
  const [nome, setNome] = useState(initialTemplate?.nome || '');
  const [disponibilidade, setDisponibilidade] = useState(
    initialTemplate?.disponibilidade?.length ? initialTemplate.disponibilidade : ['Todos os usuários'],
  );
  const [cabecalhoTipo, setCabecalhoTipo] = useState(initialTemplate?.cabecalhoTipo || 'nenhum');
  const [cabecalhoTexto, setCabecalhoTexto] = useState(initialTemplate?.cabecalhoTexto || '');
  const [corpo, setCorpo] = useState(initialTemplate?.corpo || '');
  const [rodape, setRodape] = useState(initialTemplate?.rodape || '');
  const [botoes, setBotoes] = useState(
    (initialTemplate?.botoes || []).map((item, index) => ({
      id: `${Date.now()}-${index}`,
      tipo: item.tipo || 'personalizado',
      texto: item.texto || '',
      telefone: item.telefone || '',
      tipoUrl: item.tipoUrl || 'estatico',
      url: item.url || '',
      codigoOferta: item.codigoOferta || '',
      textoRodape: item.textoRodape || '',
      confirmacaoResponsabilidade: Boolean(item.confirmacaoResponsabilidade),
    })),
  );
  const [autenticacaoBotaoTexto, setAutenticacaoBotaoTexto] = useState(initialTemplate?.autenticacaoBotaoTexto || 'Copiar código');
  const [autenticacaoRecomendacaoSeguranca, setAutenticacaoRecomendacaoSeguranca] = useState(
    Boolean(initialTemplate?.autenticacaoRecomendacaoSeguranca),
  );
  const [autenticacaoExpiracaoAtiva, setAutenticacaoExpiracaoAtiva] = useState(
    initialTemplate ? Boolean(initialTemplate?.autenticacaoExpiracaoAtiva) : true,
  );
  const [autenticacaoExpiracaoMinutos, setAutenticacaoExpiracaoMinutos] = useState(
    initialTemplate?.autenticacaoExpiracaoMinutos || 10,
  );
  const [saving, setSaving] = useState(false);
  const corpoRef = useRef(null);
  const cabecalhoRef = useRef(null);
  const isAutenticacao = categoria === 'autenticacao';

  const disponibilidadeOptions = ['Todos os usuários', ...agentOptions]
    .filter((opt) => !disponibilidade.includes(opt));

  const handleAddDisponibilidade = (value) => {
    if (!value || disponibilidade.includes(value)) return;
    setDisponibilidade((prev) => [...prev, value]);
  };

  const handleRemoveDisponibilidade = (value) => {
    setDisponibilidade((prev) => prev.filter((item) => item !== value));
  };

  const contagemBotoesPorTipo = botoes.reduce((acc, item) => {
    acc[item.tipo] = (acc[item.tipo] || 0) + 1;
    return acc;
  }, {});

  const handleAddBotao = (tipo) => {
    if (!tipo || botoes.length >= MAX_BOTOES) return;
    setBotoes((prev) => [...prev, criarBotao(tipo)]);
  };

  const handleUpdateBotao = (id, patch) => {
    setBotoes((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleRemoveBotao = (id) => {
    setBotoes((prev) => prev.filter((item) => item.id !== id));
  };

  // Modelo de autenticação tem corpo e rodapé fixos (não editáveis) — montados aqui só pra
  // prévia, o texto final de verdade é gerado pelo backend a partir das mesmas opções.
  // Recomendação de segurança e aviso de expiração entram como rodapé, não no corpo.
  const autenticacaoCorpo = isAutenticacao ? 'Seu código de verificação é {{1}}.' : '';
  const autenticacaoRodape = isAutenticacao
    ? [
        autenticacaoRecomendacaoSeguranca ? 'Não compartilhe este código com ninguém.' : null,
        autenticacaoExpiracaoAtiva ? `Este código expira em ${autenticacaoExpiracaoMinutos} minutos.` : null,
      ].filter(Boolean).join(' ')
    : '';
  const autenticacaoBotoesPreview = [{ id: 'autenticacao-copiar', tipo: 'copiar_codigo', texto: autenticacaoBotaoTexto }];

  const handleSave = async () => {
    if (!nome.trim()) {
      showNotification('Informe o nome do modelo.', 'warning');
      return;
    }
    if (isAutenticacao) {
      if (!autenticacaoBotaoTexto.trim()) {
        showNotification('Informe o texto do botão.', 'warning');
        return;
      }
    } else if (!corpo.trim()) {
      showNotification('Informe o corpo da mensagem.', 'warning');
      return;
    }
    const cancelarMarketingSemConfirmacao = botoes.some(
      (item) => item.tipo === 'cancelar_marketing' && item.texto.trim() && !item.confirmacaoResponsabilidade,
    );
    if (cancelarMarketingSemConfirmacao) {
      showNotification('Confirme a ciência de responsabilidade no botão "Cancelar marketing".', 'warning');
      return;
    }
    const payload = {
      nome: nome.trim(),
      categoria,
      idioma,
      disponibilidade,
      cabecalhoTipo,
      cabecalhoTexto,
      corpo,
      rodape,
      botoes: botoes
        .filter((item) => item.texto.trim())
        .map((item) => {
          const botao = { tipo: item.tipo, texto: item.texto.trim() };
          if (item.tipo === 'ligar') botao.telefone = (item.telefone || '').trim();
          if (item.tipo === 'acessar_site') {
            botao.tipoUrl = item.tipoUrl || 'estatico';
            botao.url = (item.url || '').trim();
          }
          if (item.tipo === 'copiar_codigo') botao.codigoOferta = (item.codigoOferta || '').trim();
          if (item.tipo === 'cancelar_marketing') {
            botao.textoRodape = (item.textoRodape || '').trim();
            botao.confirmacaoResponsabilidade = Boolean(item.confirmacaoResponsabilidade);
          }
          return botao;
        }),
      autenticacaoBotaoTexto: autenticacaoBotaoTexto.trim(),
      autenticacaoRecomendacaoSeguranca,
      autenticacaoExpiracaoAtiva,
      autenticacaoExpiracaoMinutos,
    };
    setSaving(true);
    try {
      if (isEditing) {
        await whatsappTemplatesApi.update(initialTemplate.id, payload);
        showNotification('Modelo atualizado.', 'success');
      } else {
        await whatsappTemplatesApi.create(payload);
        showNotification('Modelo salvo.', 'success');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      const message = err?.response?.data?.message || 'Não foi possível salvar o modelo.';
      showNotification(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-whatsapp-template-editor">
      <div className="config-whatsapp-template-editor__head">
        <h3>{isEditing ? 'Editar modelo de mensagem' : 'Novo modelo de mensagem'}</h3>
        <p className="config-placeholder-msg">Configure e {isEditing ? 'atualize' : 'crie'} o seu modelo de mensagem.</p>
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
        <h4>Idioma</h4>
        <p className="config-placeholder-msg">Em qual idioma o modelo vai ser submetido pra aprovação.</p>

        <label className="config-email-field">
          <span>Idioma do modelo *</span>
          <select value={idioma} onChange={(e) => setIdioma(e.target.value)}>
            {IDIOMAS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
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

        <div className="config-whatsapp-picker">
          <div className="config-whatsapp-chips">
            {disponibilidade.map((item) => (
              <span key={item} className="config-whatsapp-chip">
                {item}
                <button
                  type="button"
                  className="config-whatsapp-chip-remove"
                  onClick={() => handleRemoveDisponibilidade(item)}
                  aria-label={`Remover ${item}`}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="config-whatsapp-picker-clear"
            onClick={() => setDisponibilidade([])}
            aria-label="Limpar disponibilidade"
            disabled={!disponibilidade.length}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
          <select
            className="config-whatsapp-picker-select"
            value=""
            onChange={(e) => handleAddDisponibilidade(e.target.value)}
            aria-label="Adicionar grupo ou usuário"
          >
            <option value="">+ Adicionar grupo ou usuário…</option>
            {disponibilidadeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      </section>

      {isAutenticacao ? (
        <>
          <section className="config-whatsapp-template-editor__section">
            <h4>Entrega do código com opção de copiar código</h4>
            <p className="config-placeholder-msg">
              Autenticação básica com configuração rápida. Seus clientes copiam e colam o código no seu app.
              Saiba como enviar{' '}
              <a
                className="config-whatsapp-template-editor__autenticacao-link"
                href="https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates"
                target="_blank"
                rel="noreferrer"
              >
                modelos de mensagem de autenticação.
              </a>
            </p>

            <div className="config-whatsapp-template-editor__autenticacao-card">
              <label className="config-email-field">
                <div className="config-whatsapp-template-editor__field-head">
                  <span>Texto do botão *</span>
                  <span className="config-whatsapp-template-editor__counter">{autenticacaoBotaoTexto.length}/25</span>
                </div>
                <input
                  type="text"
                  value={autenticacaoBotaoTexto}
                  maxLength={25}
                  onChange={(e) => setAutenticacaoBotaoTexto(e.target.value)}
                  placeholder="Copiar código"
                />
              </label>
            </div>
          </section>

          <section className="config-whatsapp-template-editor__section">
            <h4>Conteúdo da mensagem</h4>
            <p className="config-placeholder-msg">
              Não é possível editar o conteúdo dos modelos de mensagem de autenticação. Você pode adicionar mais
              conteúdo das opções abaixo.
            </p>

            <label className="config-whatsapp-template-editor__autenticacao-toggle">
              <input
                type="checkbox"
                checked={autenticacaoRecomendacaoSeguranca}
                onChange={(e) => setAutenticacaoRecomendacaoSeguranca(e.target.checked)}
              />
              <span>Adicionar recomendação de segurança</span>
            </label>

            <label className="config-whatsapp-template-editor__autenticacao-toggle">
              <input
                type="checkbox"
                checked={autenticacaoExpiracaoAtiva}
                onChange={(e) => setAutenticacaoExpiracaoAtiva(e.target.checked)}
              />
              <span>Adicionar o tempo de expiração do código</span>
            </label>

            {autenticacaoExpiracaoAtiva ? (
              <div className="config-whatsapp-template-editor__autenticacao-card config-whatsapp-template-editor__autenticacao-card--indent">
                <label className="config-email-field">
                  <span>Expira em *</span>
                  <div className="config-whatsapp-template-editor__autenticacao-expira">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={autenticacaoExpiracaoMinutos}
                      onChange={(e) => setAutenticacaoExpiracaoMinutos(Math.max(1, Number(e.target.value) || 1))}
                    />
                    <span>minutos</span>
                  </div>
                </label>
              </div>
            ) : null}
          </section>
        </>
      ) : (
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
              ref={cabecalhoRef}
              type="text"
              value={cabecalhoTexto}
              maxLength={CABECALHO_MAX}
              onChange={(e) => setCabecalhoTexto(e.target.value)}
              placeholder="Insira o texto do cabeçalho…"
            />
            <VariavelPicker targetRef={cabecalhoRef} value={cabecalhoTexto} onChange={setCabecalhoTexto} />
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
          <VariavelPicker targetRef={corpoRef} value={corpo} onChange={setCorpo} />
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
                <li key={botao.id} className="config-whatsapp-template-editor__botao-item">
                  <div className="config-whatsapp-template-editor__botao-item-head">
                    <span className="config-whatsapp-template-editor__botao-tipo">{BOTAO_TIPO_LABEL[botao.tipo]}</span>
                    <button
                      type="button"
                      className="config-action-btn config-action-btn--delete"
                      onClick={() => handleRemoveBotao(botao.id)}
                      aria-label="Remover botão"
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="config-whatsapp-template-editor__botao-item-fields">
                    {botao.tipo === 'ligar' ? (
                      <input
                        type="tel"
                        value={botao.telefone}
                        maxLength={20}
                        placeholder="Telefone (+55 11999999999)"
                        onChange={(e) => handleUpdateBotao(botao.id, { telefone: e.target.value })}
                      />
                    ) : null}

                    {botao.tipo === 'acessar_site' ? (
                      <select
                        value={botao.tipoUrl}
                        onChange={(e) => handleUpdateBotao(botao.id, { tipoUrl: e.target.value })}
                        aria-label="Tipo de URL"
                      >
                        <option value="estatico">Estático</option>
                        <option value="dinamico">Dinâmico</option>
                      </select>
                    ) : null}

                    <input
                      type="text"
                      value={botao.texto}
                      maxLength={25}
                      placeholder="Texto do botão…"
                      onChange={(e) => handleUpdateBotao(botao.id, { texto: e.target.value })}
                    />

                    {botao.tipo === 'acessar_site' ? (
                      <input
                        type="url"
                        value={botao.url}
                        maxLength={2000}
                        placeholder="URL do site (https://www.exemplo.com)"
                        onChange={(e) => handleUpdateBotao(botao.id, { url: e.target.value })}
                      />
                    ) : null}

                    {botao.tipo === 'copiar_codigo' ? (
                      <input
                        type="text"
                        value={botao.codigoOferta}
                        maxLength={15}
                        placeholder="Código da oferta…"
                        onChange={(e) => handleUpdateBotao(botao.id, { codigoOferta: e.target.value })}
                      />
                    ) : null}

                    {botao.tipo === 'cancelar_marketing' ? (
                      <input
                        type="text"
                        value={botao.textoRodape}
                        maxLength={60}
                        placeholder={`Não tem interesse? Toque em ${botao.texto.trim() || 'Parar promoções'}`}
                        onChange={(e) => handleUpdateBotao(botao.id, { textoRodape: e.target.value })}
                      />
                    ) : null}
                  </div>

                  {botao.tipo === 'cancelar_marketing' ? (
                    <label className="config-whatsapp-template-editor__botao-ciencia">
                      <input
                        type="checkbox"
                        checked={botao.confirmacaoResponsabilidade}
                        onChange={(e) => handleUpdateBotao(botao.id, { confirmacaoResponsabilidade: e.target.checked })}
                      />
                      <span>
                        Estou ciente de que é responsabilidade de Velotax Serviços de Tecnologia da Informação Ltda
                        parar de enviar mensagens de marketing para os clientes que recusaram. *
                      </span>
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <select
            className="config-whatsapp-template-editor__botao-add-select"
            value=""
            onChange={(e) => {
              handleAddBotao(e.target.value);
              e.target.value = '';
            }}
            disabled={botoes.length >= MAX_BOTOES}
            aria-label="Adicionar botão"
          >
            <option value="">+ Adicionar botão</option>
            {BOTAO_GRUPOS.map((grupo) => (
              <optgroup key={grupo.label} label={grupo.label}>
                {grupo.opcoes.map((opcao) => {
                  const esgotado = opcao.max !== undefined && (contagemBotoesPorTipo[opcao.tipo] || 0) >= opcao.max;
                  return (
                    <option key={opcao.tipo} value={opcao.tipo} disabled={esgotado}>
                      {opcao.label}
                      {opcao.max ? ` (${opcao.max} botão${opcao.max > 1 ? 'ões' : ''} no máximo)` : ''}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>
      </section>
      )}

      <div className="config-whatsapp-template-editor__footer">
        <button type="button" className="config-action-btn config-action-btn--edit" onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button type="button" className="config-action-btn config-action-btn--create" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      </div>

      <WhatsappPreviewCard
        cabecalhoTipo={isAutenticacao ? 'nenhum' : cabecalhoTipo}
        cabecalhoTexto={isAutenticacao ? '' : cabecalhoTexto}
        corpo={isAutenticacao ? autenticacaoCorpo : corpo}
        rodape={isAutenticacao ? autenticacaoRodape : rodape}
        botoes={isAutenticacao ? autenticacaoBotoesPreview : botoes}
      />
      </div>
    </div>
  );
}
