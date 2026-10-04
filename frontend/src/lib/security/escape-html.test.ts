import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;"
    );
  });

  it("returns an empty string for null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("stringifies numbers and leaves plain text alone", () => {
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml("Budi Santoso")).toBe("Budi Santoso");
  });

  it("escapes an ampersand once, so existing entities stay visible as text", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});
