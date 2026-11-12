import { useCallback, useEffect, useRef, useState } from 'react';

type Layer = { panel: HTMLElement; close: () => void };

/** Open store dialogs, bottom to top. Escape and Tab only reach the top one. */
const layers: Layer[] = [];
let savedOverflow = '';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function onKeyDown(event: KeyboardEvent) {
  const top = layers.at(-1);
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    top.close();
    return;
  }
  if (event.key !== 'Tab') return;
  // Sorted because some DOMs (jsdom) group selector-list matches by selector.
  const focusable = [...top.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  const outside = !top.panel.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

function pushLayer(layer: Layer) {
  if (layers.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
  }
  layers.push(layer);
}

function removeLayer(layer: Layer) {
  const index = layers.indexOf(layer);
  if (index >= 0) layers.splice(index, 1);
  if (layers.length === 0) {
    document.body.style.overflow = savedOverflow;
    document.removeEventListener('keydown', onKeyDown);
  }
}

function exitMs() {
  if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-base'));
  return Number.isFinite(token) ? token : 200;
}

/**
 * Modal behavior for the store's hand-built overlays: focus moves into the
 * panel on open (the [data-autofocus] element, else the first focusable one)
 * and back to the opener on close, Tab stays inside the top dialog, Escape
 * closes only the top dialog, and the page behind stops scrolling. `requestClose` sets `closing` for one --motion-base exit before
 * calling onClose; with reduced motion it calls onClose at once.
 */
export function useStoreDialog(onClose: () => void, active = true) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [closing, setClosing] = useState(false);
  if (!active && closing) setClosing(false);
  const timer = useRef<number | undefined>(undefined);

  const requestClose = useCallback(() => {
    if (timer.current !== undefined) return;
    const ms = exitMs();
    if (ms === 0) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onCloseRef.current();
    }, ms);
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = { panel, close: requestClose };
    pushLayer(layer);
    (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      removeLayer(layer);
      if (opener?.isConnected) opener.focus();
      else layers.at(-1)?.panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
  }, [active, requestClose]);

  return { panelRef, closing, requestClose };
}

/** Exit classes for the backdrop and panels; they pair with the motion-*-in enter classes. */
export const exitMotion = {
  backdrop: (closing: boolean) =>
    `transition-opacity duration-(--motion-base) ease-(--ease-standard) ${closing ? 'opacity-0' : ''}`,
  /** Bottom sheet on phones, centered card from sm up. */
  sheet: (closing: boolean) =>
    `transition-[opacity,transform] duration-(--motion-base) ease-(--ease-standard) ${closing ? 'opacity-0 [transform:translateY(1.5rem)] sm:[transform:scale(0.96)]' : ''}`,
  /** Drawer from the inline end edge. */
  drawer: (closing: boolean) =>
    `transition-[opacity,transform] duration-(--motion-base) ease-(--ease-standard) ${closing ? 'opacity-0 [transform:translateX(2rem)]' : ''}`,
};
