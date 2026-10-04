import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GO_BACKEND_PREFIXES, goBackendTarget } from "./backend-routes";

const env = { BACKEND_URL: "http://go-api:8080" };
const prefixes = ["/api/gym", "/api/member-portal/workouts/"];

describe("goBackendTarget", () => {
  it("returns BACKEND_URL + path for a listed prefix", () => {
    expect(goBackendTarget("/api/gym", { prefixes, env })).toBe("http://go-api:8080/api/gym");
    expect(goBackendTarget("/api/gym/packages/1", { prefixes, env })).toBe(
      "http://go-api:8080/api/gym/packages/1"
    );
    expect(goBackendTarget("/api/member-portal/workouts/9", { prefixes, env })).toBe(
      "http://go-api:8080/api/member-portal/workouts/9"
    );
  });

  it("matches whole segments only", () => {
    expect(goBackendTarget("/api/gymnastics", { prefixes, env })).toBeNull();
    expect(goBackendTarget("/api/member-portal/workoutsx", { prefixes, env })).toBeNull();
    expect(goBackendTarget("/api/member-portal/me", { prefixes, env })).toBeNull();
  });

  it("is off without BACKEND_URL and outside /api", () => {
    expect(goBackendTarget("/api/gym", { prefixes, env: {} })).toBeNull();
    expect(goBackendTarget("/api/gym", { prefixes, env: { BACKEND_URL: "  " } })).toBeNull();
    expect(goBackendTarget("/gym", { prefixes: ["/gym"], env })).toBeNull();
  });

  it("drops a trailing slash on BACKEND_URL", () => {
    expect(goBackendTarget("/api/gym", { prefixes, env: { BACKEND_URL: "http://go:8080//" } })).toBe(
      "http://go:8080/api/gym"
    );
  });

  it("routes the ported prefixes to Go only when BACKEND_URL is set", () => {
    expect(goBackendTarget("/api/gym/credits/ledger", { env: {} })).toBeNull();
    expect(goBackendTarget("/api/gym/credits/ledger", { env })).toMatch(/\/api\/gym\/credits\/ledger$/);
    expect(goBackendTarget("/api/gym/dashboard", { env })).toBeNull();
  });

  it("keeps a TypeScript fallback route for every Go prefix", () => {
    for (const prefix of GO_BACKEND_PREFIXES) {
      expect(fs.existsSync(path.join(process.cwd(), "src/app", prefix)), prefix).toBe(true);
    }
  });
});
