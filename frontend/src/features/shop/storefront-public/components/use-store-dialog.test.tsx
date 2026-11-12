import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useStoreDialog } from './use-store-dialog';

function Dialog({ name, onClose, children }: { name: string; onClose: () => void; children?: React.ReactNode }) {
  const { panelRef, closing, requestClose } = useStoreDialog(onClose);
  return (
    <div role="dialog" aria-label={name} ref={panelRef} data-closing={closing}>
      <button type="button" onClick={requestClose} data-autofocus>Close {name}</button>
      <input aria-label={`Field ${name}`} />
      <button type="button">Last {name}</button>
      {children}
    </div>
  );
}

function Harness() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>Open outer</button>
      {outer ? (
        <Dialog name="outer" onClose={() => setOuter(false)}>
          <button type="button" onClick={() => setInner(true)}>Open inner</button>
        </Dialog>
      ) : null}
      {inner ? <Dialog name="inner" onClose={() => setInner(false)} /> : null}
    </>
  );
}

describe('useStoreDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('focuses the close button, traps Tab, locks scroll and returns focus', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open outer' });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole('button', { name: 'Close outer' });
    const last = screen.getByRole('button', { name: 'Open inner' });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('Escape and Tab reach only the top dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }));
    const openInner = screen.getByRole('button', { name: 'Open inner' });
    openInner.focus();
    fireEvent.click(openInner);
    const innerLast = screen.getByRole('button', { name: 'Last inner' });
    innerLast.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close inner' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'inner' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'outer' })).toBeInTheDocument();
    expect(openInner).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('plays the exit for --motion-base before closing when motion is allowed', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close outer' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-closing', 'true');
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes at once with reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close outer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
