import { describe, expect, it } from "vitest";
import { isStaleClientBundleError } from "./client-bundle-error";

describe("isStaleClientBundleError", () => {
  it("detects webpack/next chunk load failures", () => {
    expect(
      isStaleClientBundleError({ name: "ChunkLoadError", message: "Loading chunk 123 failed" })
    ).toBe(true);
    expect(
      isStaleClientBundleError({
        name: "TypeError",
        message: "Failed to fetch dynamically imported module: https://dev-sulu.within.ventures/_next/static/chunks/app.js",
      })
    ).toBe(true);
  });

  it("ignores ordinary render errors", () => {
    expect(
      isStaleClientBundleError({ name: "TypeError", message: "Cannot read properties of null" })
    ).toBe(false);
  });
});
