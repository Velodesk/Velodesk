/**
 * ClientContactFieldsEditor v1.3.1 — e-mail obrigatório no cadastro manual
 * VERSION: v1.3.1 | DATE: 2026-08-20
 */
import React from 'react';
import { isValidEmailFormat, maskCpfInput, maskPhoneInput, normalizePhone } from '../../../services/desk/utils';

function phoneMatches(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left && right && left === right);
}

function normalizeEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function emailMatches(a, b) {
  const left = normalizeEmailValue(a);
  const right = normalizeEmailValue(b);
  return Boolean(left && right && left === right);
}

function ensureMinOne(items) {
  return items.length ? items : [''];
}

export default function ClientContactFieldsEditor({
  name,
  onNameChange,
  emails,
  onEmailsChange,
  replyEmail,
  onReplyEmailChange,
  phones,
  onPhonesChange,
  whatsappPhone,
  onWhatsappPhoneChange,
  cadastroPhones = [],
  idPrefix = 'clientContact',
  showName = true,
  showCpf = false,
  cpf = '',
  onCpfChange,
  cpfLookupLoading = false,
  emailErrors = {},
  onEmailBlur,
  emailRequired = false,
}) {
  const emailRows = ensureMinOne(emails);
  const phoneRows = ensureMinOne(phones);

  const updateEmail = (index, value) => {
    const next = [...emailRows];
    const prev = next[index];
    next[index] = value;
    onEmailsChange(next);
    if (replyEmail && emailMatches(replyEmail, prev)) {
      onReplyEmailChange(String(value || '').trim());
    }
  };

  const addEmail = () => onEmailsChange([...emailRows, '']);

  const removeEmail = (index) => {
    const removed = emailRows[index];
    const next = emailRows.length <= 1 ? [''] : emailRows.filter((_, i) => i !== index);
    onEmailsChange(next);
    if (replyEmail && emailMatches(replyEmail, removed)) {
      const fallback = next.map((item) => String(item || '').trim()).find(Boolean) || '';
      onReplyEmailChange(fallback);
    }
  };

  const updatePhone = (index, value) => {
    if (isFromCadastro(phoneRows[index])) return;
    const masked = maskPhoneInput(value);
    const next = [...phoneRows];
    const prev = next[index];
    next[index] = masked;
    onPhonesChange(next);
    if (whatsappPhone && phoneMatches(whatsappPhone, prev)) {
      onWhatsappPhoneChange(masked.trim());
    }
  };

  const addPhone = () => onPhonesChange([...phoneRows, '']);

  /**
   * Telefone vindo do cadastro do app (b2c_cadastros) — precisa ficar igual ao que o app traz;
   * só muda se o cliente alterar por lá. O agente só pode adicionar outro número e escolher
   * qual usar no WhatsApp, nunca editar ou apagar o do cadastro.
   */
  const isFromCadastro = (phone) => {
    const trimmed = String(phone || '').trim();
    if (!trimmed) return false;
    return (cadastroPhones || []).some((item) => phoneMatches(item, trimmed));
  };

  const removePhone = (index) => {
    if (isFromCadastro(phoneRows[index])) return;
    const removed = phoneRows[index];
    const next = phoneRows.length <= 1 ? [''] : phoneRows.filter((_, i) => i !== index);
    onPhonesChange(next);
    if (whatsappPhone && phoneMatches(whatsappPhone, removed)) {
      const fallback = next.map((item) => String(item || '').trim()).find(Boolean) || '';
      onWhatsappPhoneChange(fallback);
    }
  };

  const selectWhatsapp = (value) => {
    onWhatsappPhoneChange(String(value || '').trim());
  };

  const selectReplyEmail = (value) => {
    onReplyEmailChange(String(value || '').trim());
  };

  return (
    <div className="client-contact-fields">
      {showCpf ? (
        <div className="client-contact-fields__cpf">
          <label className="client-contact-fields__label" htmlFor={`${idPrefix}Cpf`}>CPF</label>
          <input
            type="text"
            className="client-contact-fields__input"
            id={`${idPrefix}Cpf`}
            value={cpf}
            onChange={(e) => onCpfChange?.(maskCpfInput(e.target.value))}
            placeholder="000.000.000-00"
            autoComplete="off"
            inputMode="numeric"
            maxLength={14}
          />
          {cpfLookupLoading ? (
            <p className="client-contact-fields__hint client-contact-fields__hint--lookup">
              Consultando cadastro…
            </p>
          ) : null}
        </div>
      ) : null}

      {showName ? (
        <div className="client-contact-fields__name">
          <label className="client-contact-fields__label" htmlFor={`${idPrefix}Name`}>Nome</label>
          <input
            type="text"
            className="client-contact-fields__input"
            id={`${idPrefix}Name`}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="name"
          />
        </div>
      ) : null}

      <div className="client-contact-fields__group">
        <div className="client-contact-fields__group-head">
          <span className="client-contact-fields__label">
            E-mails
            {emailRequired ? <span className="client-contact-fields__required" aria-hidden="true"> *</span> : null}
          </span>
          <button type="button" className="client-contact-fields__add-btn" onClick={addEmail}>
            <i className="ti ti-plus" aria-hidden="true" />
            Adicionar
          </button>
        </div>
        {emailRows.map((email, index) => {
          const trimmed = String(email || '').trim();
          const replyRadioName = `${idPrefix}-reply-email`;
          return (
            <div className="client-contact-fields__row client-contact-fields__row--email" key={`email-${index}`}>
              <input
                type="email"
                className={'client-contact-fields__input' + (emailErrors[index] ? ' client-contact-fields__input--error' : '')}
                id={`${idPrefix}Email-${index}`}
                value={email}
                onChange={(e) => updateEmail(index, e.target.value)}
                onBlur={() => onEmailBlur?.(index, email)}
                placeholder="nome@dominio.com"
                autoComplete={index === 0 ? 'email' : 'off'}
                required={emailRequired && index === 0}
                aria-required={emailRequired && index === 0 ? 'true' : undefined}
              />
              <label
                className={'client-contact-fields__reply' + (!trimmed ? ' is-disabled' : '')}
                title="Usar este e-mail para responder ao cliente"
              >
                <input
                  type="radio"
                  name={replyRadioName}
                  checked={Boolean(trimmed && emailMatches(replyEmail, trimmed))}
                  disabled={!trimmed}
                  onChange={() => selectReplyEmail(trimmed)}
                />
                <i className="ti ti-mail" aria-hidden="true" />
                <span>Resposta</span>
              </label>
              <button
                type="button"
                className="client-contact-fields__remove-btn"
                onClick={() => removeEmail(index)}
                aria-label="Remover e-mail"
                title="Remover"
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <p className="client-contact-fields__hint">
          {emailRequired
            ? 'Informe ao menos um e-mail válido. Marque qual será usado para responder ao cliente.'
            : 'Marque qual e-mail será usado para enviar respostas ao cliente.'}
        </p>
      </div>

      <div className="client-contact-fields__group">
        <div className="client-contact-fields__group-head">
          <span className="client-contact-fields__label">Telefones</span>
          <button type="button" className="client-contact-fields__add-btn" onClick={addPhone}>
            <i className="ti ti-plus" aria-hidden="true" />
            Adicionar
          </button>
        </div>
        {phoneRows.map((phone, index) => {
          const trimmed = String(phone || '').trim();
          const radioName = `${idPrefix}-whatsapp`;
          const locked = isFromCadastro(phone);
          return (
            <div className="client-contact-fields__row client-contact-fields__row--phone" key={`phone-${index}`}>
              <input
                type="tel"
                className="client-contact-fields__input"
                id={`${idPrefix}Phone-${index}`}
                value={phone}
                onChange={(e) => updatePhone(index, e.target.value)}
                placeholder="(11) 99999-9999"
                autoComplete={index === 0 ? 'tel' : 'off'}
                inputMode="numeric"
                maxLength={15}
                readOnly={locked}
                title={locked ? 'Telefone do cadastro do app — só muda se o cliente alterar por lá.' : undefined}
              />
              <label
                className={'client-contact-fields__wa' + (!trimmed ? ' is-disabled' : '')}
                title="Usar este número para WhatsApp"
              >
                <input
                  type="radio"
                  name={radioName}
                  checked={Boolean(trimmed && phoneMatches(whatsappPhone, trimmed))}
                  disabled={!trimmed}
                  onChange={() => selectWhatsapp(trimmed)}
                />
                <i className="ti ti-brand-whatsapp" aria-hidden="true" />
                <span>WhatsApp</span>
              </label>
              {locked ? (
                <i
                  className="ti ti-lock client-contact-fields__phone-locked"
                  aria-hidden="true"
                  title="Telefone do cadastro do app — não pode ser removido aqui."
                />
              ) : (
                <button
                  type="button"
                  className="client-contact-fields__remove-btn"
                  onClick={() => removePhone(index)}
                  aria-label="Remover telefone"
                  title="Remover"
                >
                  <i className="ti ti-trash" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        <p className="client-contact-fields__hint">
          Marque qual número será usado para iniciar conversas no WhatsApp. O telefone do
          cadastro do app não pode ser editado nem removido aqui — só adicionar outro.
        </p>
      </div>
    </div>
  );
}

export function validateClientContactDraft({
  cpf,
  name,
  emails,
  phones,
  whatsappPhone,
  replyEmail,
}, { requireName = true, requireEmail = false } = {}) {
  const nome = String(name || '').trim();
  const cpfDigits = String(cpf || '').replace(/\D/g, '').slice(0, 11);
  if (requireName && !nome) {
    return { ok: false, message: 'Informe o nome do cliente.' };
  }

  const emailList = (emails || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (requireEmail && !emailList.length) {
    return { ok: false, message: 'Informe o e-mail do cliente.', emailIndex: 0 };
  }
  for (let i = 0; i < (emails || []).length; i += 1) {
    const value = String(emails[i] || '').trim();
    if (value && !isValidEmailFormat(value)) {
      return { ok: false, message: 'Informe um e-mail válido (ex.: nome@dominio.com).', emailIndex: i };
    }
  }

  const replySelected = String(replyEmail || '').trim();
  if (emailList.length > 1 && replySelected && !emailList.some((item) => emailMatches(item, replySelected))) {
    return { ok: false, message: 'Selecione um e-mail válido para resposta ao cliente.' };
  }
  if (emailList.length > 1 && !replySelected) {
    return { ok: false, message: 'Selecione qual e-mail será usado para responder ao cliente.' };
  }

  const phoneList = (phones || []).map((item) => String(item || '').trim()).filter(Boolean);
  const whatsappSelected = String(whatsappPhone || '').trim();
  if (phoneList.length > 1 && whatsappSelected && !phoneList.some((item) => phoneMatches(item, whatsappSelected))) {
    return { ok: false, message: 'Selecione um telefone válido para WhatsApp.' };
  }
  if (phoneList.length > 1 && !String(whatsappPhone || '').trim()) {
    return { ok: false, message: 'Selecione qual telefone será usado no WhatsApp.' };
  }

  return {
    ok: true,
    nome,
    cpf: cpfDigits,
    emailList,
    phoneList,
    whatsappPhone: resolveWhatsappPhone(phoneList, whatsappPhone),
    replyEmail: resolveReplyEmail(emailList, replyEmail),
  };
}

export function resolveWhatsappPhone(phoneList, whatsappPhone) {
  const phones = (phoneList || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!phones.length) return '';
  const selected = String(whatsappPhone || '').trim();
  if (selected) {
    const match = phones.find((item) => phoneMatches(item, selected));
    if (match) return match;
  }
  return phones[0];
}

export function resolveReplyEmail(emailList, replyEmail) {
  const emails = (emailList || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!emails.length) return '';
  const selected = String(replyEmail || '').trim();
  if (selected) {
    const match = emails.find((item) => emailMatches(item, selected));
    if (match) return match;
  }
  return emails[0];
}

export function buildContactDraftFromFields(fields) {
  const emails = Array.isArray(fields.emails)
    ? fields.emails
    : (fields.email ? [fields.email] : []);
  const phones = Array.isArray(fields.phones)
    ? fields.phones
    : (fields.phone ? [fields.phone] : []);
  return {
    cpf: fields.cpf || '',
    name: fields.name || '',
    emails: emails.length ? emails : [''],
    phones: phones.length ? phones : [''],
    replyEmail: fields.replyEmail || resolveReplyEmail(emails, fields.replyEmail),
    whatsappPhone: fields.whatsappPhone || resolveWhatsappPhone(phones, fields.whatsappPhone),
    clienteId: fields.clienteId || '',
  };
}
