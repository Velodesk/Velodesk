/**
 * RedesSociaisTabulacao — sub-abas e formulário de registro de interação
 */
import React, { useState } from 'react';
import { useNotifications } from '../../../context/NotificationContext';

const SUB_TABS = [
  { id: 'entrada-dados', label: 'Entrada de Dados' },
  { id: 'relatorios', label: 'Relatórios' },
];

const REDE_SOCIAL_OPTIONS = ['Facebook', 'Instagram', 'PlayStore'];
const MOTIVO_CONTATO_OPTIONS = ['Elogio', 'Reclamação', 'Dúvida', 'Sugestão', 'Solicitação', 'Outro'];
const SENTIMENTO_OPTIONS = ['Positivo', 'Neutro', 'Negativo'];

const REDE_SOCIAL_FILTRO_OPTIONS = ['Todas', ...REDE_SOCIAL_OPTIONS];
const MOTIVO_FILTRO_OPTIONS = ['Todos', ...MOTIVO_CONTATO_OPTIONS];

const EMPTY_FORM = {
  nome: '',
  redeSocial: REDE_SOCIAL_OPTIONS[0],
  data: '',
  mensagem: '',
  motivoContato: '',
  sentimento: '',
  direcionadoCentral: false,
};

const EMPTY_FILTROS = {
  redeSocial: REDE_SOCIAL_FILTRO_OPTIONS[0],
  motivo: MOTIVO_FILTRO_OPTIONS[0],
  dataInicial: '',
  dataFinal: '',
};

export default function RedesSociaisTabulacao() {
  const { showNotification } = useNotifications();
  const [subTab, setSubTab] = useState(SUB_TABS[0].id);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [filtros, setFiltros] = useState(EMPTY_FILTROS);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const updateFiltro = (field, value) => {
    setFiltros((prev) => ({ ...prev, [field]: value }));
  };

  const handleGerarRelatorio = () => {
    showNotification('Geração de relatório com IA ainda não implementada.', 'info');
  };

  const handleAnalisarIa = () => {
    if (!form.mensagem.trim()) {
      showNotification('Preencha o texto da mensagem para analisar.', 'warning');
      return;
    }
    showNotification('Análise por IA ainda não implementada.', 'info');
  };

  const handleSalvar = () => {
    const nextErrors = {};
    if (!form.nome.trim()) nextErrors.nome = 'Informe o nome';
    if (!form.mensagem.trim()) nextErrors.mensagem = 'Informe o texto da mensagem';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      showNotification('Preencha os campos obrigatórios.', 'warning');
      return;
    }
    showNotification('Formulário validado — integração de salvamento ainda não implementada.', 'info');
    setForm(EMPTY_FORM);
    setErrors({});
  };

  return (
    <div className="rs-tabulacao">
      <nav className="ra-tabs rs-tabulacao__tabs" aria-label="Áreas de Tabulação">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={'ra-tabs__btn' + (subTab === tab.id ? ' is-active' : '')}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {subTab === 'entrada-dados' ? (
        <div className="rs-tabulacao__content">
          <section className="ra-registro__card">
            <h2 className="ra-registro__card-title">Nova Interação</h2>

            <div className="ra-registro__row ra-registro__row--3">
              <div className="ra-registro__field">
                <label htmlFor="rs-nome">Nome *</label>
                <input
                  id="rs-nome"
                  type="text"
                  className={`ra-registro__input${errors.nome ? ' is-error' : ''}`}
                  value={form.nome}
                  onChange={(e) => updateField('nome', e.target.value)}
                  placeholder="Nome do consumidor"
                />
                {errors.nome ? <span className="ra-registro__error">{errors.nome}</span> : null}
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-rede">Rede social *</label>
                <select
                  id="rs-rede"
                  className="ra-registro__select"
                  value={form.redeSocial}
                  onChange={(e) => updateField('redeSocial', e.target.value)}
                >
                  {REDE_SOCIAL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-data">Data</label>
                <input
                  id="rs-data"
                  type="date"
                  className="ra-registro__input"
                  value={form.data}
                  onChange={(e) => updateField('data', e.target.value)}
                />
              </div>
            </div>

            <div className="ra-registro__field">
              <label htmlFor="rs-mensagem">Texto da Mensagem Principal *</label>
              <textarea
                id="rs-mensagem"
                className={`ra-registro__textarea${errors.mensagem ? ' is-error' : ''}`}
                rows={5}
                value={form.mensagem}
                onChange={(e) => updateField('mensagem', e.target.value)}
                placeholder="Transcreva a mensagem recebida na rede social..."
              />
              {errors.mensagem ? <span className="ra-registro__error">{errors.mensagem}</span> : null}
            </div>

            <div className="ra-registro__row ra-registro__row--2">
              <div className="ra-registro__field">
                <label htmlFor="rs-motivo">Motivo do Contato</label>
                <select
                  id="rs-motivo"
                  className="ra-registro__select"
                  value={form.motivoContato}
                  onChange={(e) => updateField('motivoContato', e.target.value)}
                >
                  <option value="">Selecione</option>
                  {MOTIVO_CONTATO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-sentimento">Sentimento</label>
                <select
                  id="rs-sentimento"
                  className="ra-registro__select"
                  value={form.sentimento}
                  onChange={(e) => updateField('sentimento', e.target.value)}
                >
                  <option value="">Selecione</option>
                  {SENTIMENTO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="rs-tabulacao__checkbox">
              <input
                type="checkbox"
                checked={form.direcionadoCentral}
                onChange={(e) => updateField('direcionadoCentral', e.target.checked)}
              />
              Direcionado para Central
            </label>

            <div className="rs-tabulacao__actions">
              <button type="button" className="ra-registro__btn ra-registro__btn--ghost" onClick={handleAnalisarIa}>
                <i className="ti ti-sparkles" aria-hidden="true" />
                Analisar com IA
              </button>
              <button type="button" className="ra-registro__btn ra-registro__btn--primary" onClick={handleSalvar}>
                Salvar Interação
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="rs-tabulacao__content">
          <section className="ra-registro__card">
            <h2 className="ra-registro__card-title">Relatório Executivo de CX</h2>

            <div className="ra-registro__row ra-registro__row--4">
              <div className="ra-registro__field">
                <label htmlFor="rs-rel-rede">Rede Social</label>
                <select
                  id="rs-rel-rede"
                  className="ra-registro__select"
                  value={filtros.redeSocial}
                  onChange={(e) => updateFiltro('redeSocial', e.target.value)}
                >
                  {REDE_SOCIAL_FILTRO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-rel-motivo">Motivo</label>
                <select
                  id="rs-rel-motivo"
                  className="ra-registro__select"
                  value={filtros.motivo}
                  onChange={(e) => updateFiltro('motivo', e.target.value)}
                >
                  {MOTIVO_FILTRO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-rel-data-ini">Data Inicial</label>
                <input
                  id="rs-rel-data-ini"
                  type="date"
                  className="ra-registro__input"
                  value={filtros.dataInicial}
                  onChange={(e) => updateFiltro('dataInicial', e.target.value)}
                />
              </div>
              <div className="ra-registro__field">
                <label htmlFor="rs-rel-data-fim">Data Final</label>
                <input
                  id="rs-rel-data-fim"
                  type="date"
                  className="ra-registro__input"
                  value={filtros.dataFinal}
                  onChange={(e) => updateFiltro('dataFinal', e.target.value)}
                />
              </div>
            </div>

            <div className="rs-tabulacao__actions rs-tabulacao__actions--start">
              <button type="button" className="ra-registro__btn ra-registro__btn--primary" onClick={handleGerarRelatorio}>
                <i className="ti ti-rocket" aria-hidden="true" />
                Gerar Relatório com IA
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
