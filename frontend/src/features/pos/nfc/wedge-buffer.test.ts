import { describe, expect, it } from "vitest";
import {
  MAX_WEDGE_GAP_MS,
  MIN_CARD_LENGTH,
  createWedgeBuffer,
  reduceWedgeKey,
} from "./wedge-buffer";

describe("reduceWedgeKey", () => {
  it("appends printable characters within the wedge gap", () => {
    let state = createWedgeBuffer();
    state = reduceWedgeKey(state, { key: "A", now: 0 });
    state = reduceWedgeKey(state, { key: "1", now: 40 });
    expect(state.buffer).toBe("A1");
    expect(state.committed).toBeNull();
  });

  it("resets when the gap between keys is too slow", () => {
    let state = createWedgeBuffer();
    state = reduceWedgeKey(state, { key: "A", now: 0 });
    state = reduceWedgeKey(state, { key: "1", now: MAX_WEDGE_GAP_MS + 1 });
    expect(state.buffer).toBe("1");
  });

  it("commits on Enter when buffer meets minimum length", () => {
    let state = createWedgeBuffer();
    const card = "x".repeat(MIN_CARD_LENGTH);
    for (let i = 0; i < card.length; i += 1) {
      state = reduceWedgeKey(state, { key: card[i]!, now: i * 10 });
    }
    state = reduceWedgeKey(state, { key: "Enter", now: card.length * 10 });
    expect(state.committed).toBe(card);
    expect(state.buffer).toBe("");
  });

  it("does not commit short buffers on Enter", () => {
    let state = createWedgeBuffer();
    state = reduceWedgeKey(state, { key: "1", now: 0 });
    state = reduceWedgeKey(state, { key: "Enter", now: 20 });
    expect(state.committed).toBeNull();
    expect(state.buffer).toBe("");
  });

  it("ignores non-character keys other than Enter", () => {
    let state = createWedgeBuffer();
    state = reduceWedgeKey(state, { key: "Shift", now: 0 });
    state = reduceWedgeKey(state, { key: "a", now: 10 });
    expect(state.buffer).toBe("a");
  });
});
