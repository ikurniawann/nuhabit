import { describe, expect, it } from "vitest";
import { isNextControlFlowError } from "./next-control-flow";

const withDigest = (digest: string) => Object.assign(new Error("x"), { digest });

describe("isNextControlFlowError", () => {
  it("lets Next.js signals through", () => {
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404", "DYNAMIC_SERVER_USAGE"]) {
      expect(isNextControlFlowError(withDigest(digest))).toBe(true);
    }
  });

  it("treats everything else as a real failure", () => {
    expect(isNextControlFlowError(new Error("database down"))).toBe(false);
    expect(isNextControlFlowError(withDigest("123456"))).toBe(false);
  });
});
