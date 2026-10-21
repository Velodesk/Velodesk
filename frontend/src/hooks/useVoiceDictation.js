/**
 * useVoiceDictation — ditado por voz via Web Speech API (SpeechRecognition /
 * webkitSpeechRecognition), em pt-BR. Escreve o texto reconhecido no alvo enquanto a pessoa
 * fala (resultados parciais vão sendo atualizados, e se firmam quando a frase termina), num
 * alvo que exponha { focus(), beginDictation(), dictateText(finalText, interimText),
 * endDictation() } — exatamente o que o ref de ComposeRichEditor já expõe, então ele pode ser
 * passado direto.
 *
 * Não envia nem guarda áudio/texto em nenhum lugar além do próprio campo alvo — o
 * reconhecimento em si roda no motor do navegador (fora do controle deste código).
 *
 * `sessionKey` identifica o campo/ticket atual (ex.: ticketId) — ao mudar, o ditado em
 * andamento é parado e qualquer parcial ainda não confirmado é descartado, pra evitar que uma
 * sessão de ditado "esquecida" ligada continue escrevendo na caixa de um ticket diferente
 * depois de trocar de aba (o Desk reaproveita a mesma caixa de resposta entre tickets).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SILENCE_TIMEOUT_MS = 8000;
const MAX_AUTO_RESTARTS = 5;
const AUTO_RESTART_WINDOW_MS = 10000;

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function mapErrorCode(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'permission-denied';
  if (code === 'audio-capture') return 'no-mic';
  if (code === 'no-speech') return 'no-speech';
  return 'generic';
}

export function useVoiceDictation({
  targetRef,
  lang = 'pt-BR',
  disabled = false,
  onError,
  sessionKey,
} = {}) {
  const SpeechRecognitionCtor = useMemo(() => getSpeechRecognitionCtor(), []);
  const supported = Boolean(SpeechRecognitionCtor);

  const [state, setState] = useState('idle');
  const recognitionRef = useRef(null);
  const manualStopRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const restartTimestampsRef = useRef([]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const teardownRecognition = useCallback(() => {
    clearSilenceTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // instância já parada — sem problema
      }
    }
  }, [clearSilenceTimer]);

  const settleToIdle = useCallback(() => {
    teardownRecognition();
    // Só chega aqui depois do onend (ou seja, depois que o navegador já teve a chance de
    // entregar o resultado final da última frase) — então qualquer parcial que ainda sobrou
    // de fato não virou texto, e endDictation descarta sem medo de perder fala real.
    targetRef?.current?.endDictation?.();
    setState('idle');
  }, [teardownRecognition, targetRef]);

  const settleToError = useCallback((errorCode) => {
    teardownRecognition();
    // Em erro não há garantia de que mais algum resultado venha depois — descarta na hora.
    targetRef?.current?.endDictation?.();
    setState('error');
    onError?.(errorCode);
    // volta pro ícone normal depois de mostrar o estado de erro rapidamente
    setTimeout(() => setState((current) => (current === 'error' ? 'idle' : current)), 1500);
  }, [teardownRecognition, targetRef, onError]);

  const armSilenceWatchdog = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      manualStopRef.current = true;
      settleToError('no-speech');
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, settleToError]);

  const createRecognition = useCallback(() => {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const target = targetRef?.current;
      if (!target) return;
      armSilenceWatchdog();
      // Agrupa tudo que o evento trouxe numa só chamada — quando o Chrome manda mais de um
      // resultado no mesmo evento, chamar dictateText uma vez por resultado fazia o segundo
      // sobrescrever o que o primeiro acabou de escrever.
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = (result[0]?.transcript || '').trim();
        if (!transcript) continue;
        if (result.isFinal) {
          finalText = finalText ? `${finalText} ${transcript}` : transcript;
        } else {
          interimText = interimText ? `${interimText} ${transcript}` : transcript;
        }
      }
      if (finalText || interimText) {
        target.dictateText(finalText, interimText);
      }
    };

    recognition.onerror = (event) => {
      manualStopRef.current = true;
      settleToError(mapErrorCode(event.error));
    };

    recognition.onend = () => {
      if (manualStopRef.current) {
        settleToIdle();
        return;
      }
      const now = Date.now();
      restartTimestampsRef.current = restartTimestampsRef.current.filter(
        (ts) => now - ts < AUTO_RESTART_WINDOW_MS,
      );
      if (restartTimestampsRef.current.length >= MAX_AUTO_RESTARTS) {
        settleToError('generic');
        return;
      }
      restartTimestampsRef.current.push(now);
      try {
        const next = createRecognition();
        recognitionRef.current = next;
        next.start();
      } catch {
        settleToError('generic');
      }
    };

    return recognition;
  }, [SpeechRecognitionCtor, lang, targetRef, armSilenceWatchdog, settleToError, settleToIdle]);

  const start = useCallback(() => {
    if (!supported || disabled) return;
    const target = targetRef?.current;
    if (!target) return;
    target.focus?.();
    target.beginDictation?.();
    manualStopRef.current = false;
    restartTimestampsRef.current = [];
    try {
      const recognition = createRecognition();
      recognitionRef.current = recognition;
      recognition.start();
      setState('recording');
      armSilenceWatchdog();
    } catch {
      settleToError('generic');
    }
  }, [supported, disabled, targetRef, createRecognition, armSilenceWatchdog, settleToError]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    // Não zera os handlers aqui: deixa o próprio onresult processar o trecho final que o
    // navegador ainda entrega depois do stop(), e só limpa tudo quando onend chegar de fato.
    try {
      recognitionRef.current?.stop();
    } catch {
      settleToIdle();
    }
  }, [clearSilenceTimer, settleToIdle]);

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop();
    } else {
      start();
    }
  }, [state, start, stop]);

  useEffect(() => () => {
    // Dispara tanto ao desmontar quanto quando sessionKey muda (ex.: trocou de ticket/aba) —
    // o Desk reaproveita a mesma caixa de resposta entre tickets, então sem isso o
    // reconhecimento continuaria ouvindo e escrevendo no ticket errado depois da troca.
    manualStopRef.current = true;
    settleToIdle();
  }, [settleToIdle, sessionKey]);

  return { supported, state, toggle };
}

export default useVoiceDictation;
