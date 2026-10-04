export const MAX_WEDGE_GAP_MS = 500;
export const MIN_CARD_LENGTH = 4;

export type WedgeBufferState = {
  buffer: string;
  lastKeyAt: number | null;
  committed: string | null;
};

export function createWedgeBuffer(): WedgeBufferState {
  return { buffer: "", lastKeyAt: null, committed: null };
}

function isPrintableKey(key: string) {
  return key.length === 1 && key !== "\n" && key !== "\r";
}

export function reduceWedgeKey(
  state: WedgeBufferState,
  event: { key: string; now: number }
): WedgeBufferState {
  const { key, now } = event;

  if (key === "Enter") {
    const trimmed = state.buffer.trim();
    if (trimmed.length >= MIN_CARD_LENGTH) {
      return { buffer: "", lastKeyAt: null, committed: trimmed };
    }
    return { buffer: "", lastKeyAt: null, committed: null };
  }

  if (!isPrintableKey(key)) {
    return { ...state, committed: null };
  }

  const gapTooSlow =
    state.lastKeyAt !== null && now - state.lastKeyAt > MAX_WEDGE_GAP_MS;

  return {
    buffer: gapTooSlow ? key : `${state.buffer}${key}`,
    lastKeyAt: now,
    committed: null,
  };
}
