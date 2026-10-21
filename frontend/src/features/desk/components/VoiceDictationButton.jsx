/**
 * VoiceDictationButton — botão de ditado por voz (microfone), plugável em qualquer alvo que
 * siga o contrato { focus(), beginDictation(), dictateText(finalText, interimText),
 * endDictation() } (o ref do ComposeRichEditor já segue; para um <textarea>/<input> comum, use
 * useTextFieldDictationTarget). Não renderiza nada quando o navegador não suporta a Web
 * Speech API.
 *
 * `variant` só muda o visual pra combinar com o lugar onde o botão entra: 'compose' (padrão)
 * usa os ícones Tabler da barra de formatação do compose; 'whatsapp' usa Font Awesome e as
 * classes do chat do WhatsApp (wa-chat__input-icon), que já usa esse ícone em todo o resto.
 *
 * `visible` controla se o botão aparece — pensado pra só mostrar o microfone quando o campo de
 * texto está em foco (pra não ser confundido com um ícone de enviar áudio, que não existe mais
 * no Velodesk). Continua montado e gravando mesmo quando `visible=false`: o componente só fica
 * escondido visualmente (display: none), nunca desmonta o hook — do contrário um ditado em
 * andamento seria interrompido se o campo perdesse o foco por acidente. Fica visível mesmo com
 * `visible=false` enquanto está gravando ou mostrando um erro, pra sempre dar pra parar/ver o
 * aviso.
 */
import React, { useCallback } from 'react';
import { useNotifications } from '../../../context/NotificationContext';
import { useVoiceDictation } from '../../../hooks/useVoiceDictation';

const ERROR_MESSAGES = {
  'permission-denied': 'Permissão de microfone negada pelo navegador.',
  'no-mic': 'Nenhum microfone encontrado.',
  'no-speech': 'Nenhuma fala detectada. Clique no microfone para tentar novamente.',
  generic: 'Não foi possível usar o ditado por voz agora.',
};

const VARIANTS = {
  compose: {
    baseClassName: 'toolbar-btn crm-compose-toolbar__btn',
    recordingClassName: 'crm-compose-toolbar__btn--recording',
    errorClassName: 'crm-compose-toolbar__btn--mic-error',
    idleIcon: 'ti ti-microphone',
    errorIcon: 'ti ti-microphone-off',
  },
  whatsapp: {
    baseClassName: 'wa-chat__input-icon',
    recordingClassName: 'wa-chat__input-icon--recording',
    errorClassName: 'wa-chat__input-icon--mic-error',
    idleIcon: 'fas fa-microphone',
    errorIcon: 'fas fa-microphone-slash',
  },
};

export default function VoiceDictationButton({
  target,
  disabled = false,
  sessionKey,
  variant = 'compose',
  visible = true,
}) {
  const { showNotification } = useNotifications();
  const skin = VARIANTS[variant] || VARIANTS.compose;

  const handleError = useCallback((errorCode) => {
    const message = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.generic;
    const isWarning = errorCode === 'no-speech' || errorCode === 'permission-denied' || errorCode === 'no-mic';
    showNotification(message, isWarning ? 'warning' : 'error');
  }, [showNotification]);

  const { supported, state, toggle } = useVoiceDictation({
    targetRef: target,
    disabled,
    onError: handleError,
    sessionKey,
  });

  if (!supported) return null;

  const isRecording = state === 'recording';
  const isError = state === 'error';
  const shouldShow = visible || isRecording || isError;

  return (
    <button
      type="button"
      className={
        skin.baseClassName
        + (isRecording ? ` ${skin.recordingClassName}` : '')
        + (isError ? ` ${skin.errorClassName}` : '')
      }
      style={shouldShow ? undefined : { display: 'none' }}
      aria-hidden={shouldShow ? undefined : true}
      tabIndex={shouldShow ? undefined : -1}
      title={isRecording ? 'Parar ditado por voz' : 'Ditado por voz'}
      aria-label={isRecording ? 'Parar ditado por voz' : 'Ditado por voz'}
      aria-pressed={isRecording}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <i className={isError ? skin.errorIcon : skin.idleIcon} aria-hidden="true" />
    </button>
  );
}
