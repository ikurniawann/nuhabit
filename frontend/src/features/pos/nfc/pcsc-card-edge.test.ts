import { describe, expect, it } from "vitest";
import { nextCardPresence } from "./pcsc-card-edge";

describe("nextCardPresence", () => {
  it("emits on insert edge only", () => {
    expect(nextCardPresence({ hadCard: false, hasCard: true })).toEqual({
      hadCard: true,
      emit: true,
    });
  });

  it("does not re-emit while card stays present", () => {
    expect(nextCardPresence({ hadCard: true, hasCard: true })).toEqual({
      hadCard: true,
      emit: false,
    });
  });

  it("resets on removal so next insert can emit", () => {
    expect(nextCardPresence({ hadCard: true, hasCard: false })).toEqual({
      hadCard: false,
      emit: false,
    });
    expect(nextCardPresence({ hadCard: false, hasCard: true }).emit).toBe(true);
  });
});
