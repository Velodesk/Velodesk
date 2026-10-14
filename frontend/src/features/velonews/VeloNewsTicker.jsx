/**
 * VeloNewsTicker v1.1.0 — barra de novidades no topo do CRM, estilo ticker de notícias.
 * Mostra as VeloNews ainda não lidas (mesmo critério do sininho/unreadCount) rolando da
 * direita pra esquerda; depois de 2 voltas completas, recolhe sozinha (desliza + esmaece).
 * Convive com o sininho/popover de sempre — não substitui nada, é uma segunda vitrine pras
 * mesmas notícias, pensada pra chamar atenção na hora que publica.
 *
 * Velocidade: a duração da animação é medida a partir da largura real do texto renderizado
 * (ref + ResizeObserver) e calculada pra manter ~140px/s constantes, em vez de um tempo fixo
 * que ficaria rápido demais com texto longo ou devagar demais com texto curto.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVeloNews } from './VeloNewsProvider';
import { isNewsAcknowledged } from './veloNewsHelpers';

const MAX_LOOPS = 2;
const TICKER_HEIGHT_PX = 36;
const PX_PER_SECOND = 55;
const MIN_DURATION_SEC = 14;
const FALLBACK_DURATION_SEC = 22;

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function VeloNewsTicker() {
  const { veloNews, acknowledgedNewsIds, openHistoryModal } = useVeloNews();

  const unreadItems = useMemo(
    () => veloNews.filter((item) => !isNewsAcknowledged(item._id, acknowledgedNewsIds)),
    [veloNews, acknowledgedNewsIds],
  );
  // Chave do conjunto atual de não lidas — muda quando chega notícia nova, reabrindo a barra
  // mesmo que a anterior já tivesse sido dispensada (rodado as 2 voltas) nesta sessão.
  const unreadKey = unreadItems.map((item) => item._id).join(',');

  const [dismissedKey, setDismissedKey] = useState('');
  const [retracting, setRetracting] = useState(false);
  const [durationSec, setDurationSec] = useState(FALLBACK_DURATION_SEC);
  const loopCountRef = useRef(0);
  const trackRef = useRef(null);

  useEffect(() => {
    loopCountRef.current = 0;
    setRetracting(false);
  }, [unreadKey]);

  const visible = Boolean(unreadKey) && unreadKey !== dismissedKey;

  // Empurra o layout (sidebar, barra de abas, #velodeskDeskV2Root, #mainApp) pra baixo enquanto
  // a barra existe. Variável global porque esses elementos são fixed/portalados fora da árvore
  // do React e cada um lê --velonews-ticker-offset direto no próprio `top`/`margin-top` (CSS).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--velonews-ticker-offset', visible && !retracting ? `${TICKER_HEIGHT_PX}px` : '0px');
    return () => {
      if (!visible) root.style.setProperty('--velonews-ticker-offset', '0px');
    };
  }, [visible, retracting]);

  const items = useMemo(
    () => unreadItems.map((item) => ({
      id: item._id,
      title: stripHtml(item.title) || 'Nova atualização do VeloNews',
      body: stripHtml(item.content),
    })),
    [unreadItems],
  );

  // Mede a largura real do texto renderizado (inclui badges/separadores) e converte pra uma
  // duração que mantém a velocidade de leitura constante, em vez de um tempo fixo no CSS.
  useLayoutEffect(() => {
    if (!visible || !trackRef.current) return undefined;
    const el = trackRef.current;

    const measure = () => {
      const width = el.scrollWidth || el.offsetWidth || 0;
      if (!width) return;
      setDurationSec(Math.max(width / PX_PER_SECOND, MIN_DURATION_SEC));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, items]);

  if (!visible) return null;

  const ariaText = items.map(({ title, body }) => (body ? `${title}: ${body}` : title)).join(' — ');

  const handleAnimationIteration = () => {
    loopCountRef.current += 1;
    if (loopCountRef.current >= MAX_LOOPS) {
      setRetracting(true);
    }
  };

  const handleTransitionEnd = (e) => {
    if (e.target !== e.currentTarget) return;
    if (retracting) setDismissedKey(unreadKey);
  };

  return createPortal(
    <div
      className={'velonews-ticker' + (retracting ? ' velonews-ticker--retracting' : '')}
      style={{ height: TICKER_HEIGHT_PX }}
      role="status"
      aria-live="polite"
      onTransitionEnd={handleTransitionEnd}
    >
      <button
        ref={trackRef}
        type="button"
        className="velonews-ticker__track"
        style={{ animationDuration: `${durationSec}s` }}
        onClick={openHistoryModal}
        onAnimationIteration={handleAnimationIteration}
        title="Ver todas as novidades do VeloNews"
        aria-label={ariaText}
      >
        {items.map(({ id, title, body }, idx) => (
          <React.Fragment key={id}>
            {idx > 0 && <span className="velonews-ticker__sep" aria-hidden="true">|</span>}
            <span className="velonews-ticker__item">
              <span className="velonews-ticker__badge">VeloNews</span>
              &nbsp;{title}{body ? `: ${body}` : ''}
            </span>
          </React.Fragment>
        ))}
      </button>
    </div>,
    document.body,
  );
}
