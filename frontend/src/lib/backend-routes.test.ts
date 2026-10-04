import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GO_BACKEND_PREFIXES, goBackendTarget, matchesGoPattern, type GoRoute } from "./backend-routes";
import goRoutes from "./go-routes.generated.json";

const env = { BACKEND_URL: "http://go-api:8080" };
const prefixes = ["/api/gym", "/api/member-portal/workouts/"];
const routes: GoRoute[] = [
  { module: "t", method: "GET", path: "/api/gym" },
  { module: "t", method: "GET", path: "/api/gym/packages/{id}" },
  { module: "t", method: "POST", path: "/api/member-portal/workouts/{a}/{b}" },
  { module: "t", method: "GET", path: "/api/member-portal/me" },
];
const opts = { prefixes, routes, env };

describe("matchesGoPattern", () => {
  it.each([
    ["/api/gym/packages/{id}", "/api/gym/packages/1", true],
    ["/api/gym/packages/{id}", "/api/gym/packages/", false],
    ["/api/gym/packages/{id}", "/api/gym/packages/1/extra", false],
    ["/api/files/{rest...}", "/api/files/a/b/c", true],
    ["/api/tree/", "/api/tree/x/y", true],
    ["/api/tree/", "/api/tree", false],
    ["/api/exact/{$}", "/api/exact/", true],
    ["/api/exact/{$}", "/api/exact/x", false],
    ["/api/gym", "/api/gymnastics", false],
  ])("%s vs %s -> %s", (pattern, pathname, want) => {
    expect(matchesGoPattern(pattern, pathname)).toBe(want);
  });
});

describe("goBackendTarget", () => {
  it("returns BACKEND_URL + path when the prefix is switched and Go serves the route", () => {
    expect(goBackendTarget("/api/gym", "GET", opts)).toBe("http://go-api:8080/api/gym");
    expect(goBackendTarget("/api/gym/packages/1", "GET", opts)).toBe("http://go-api:8080/api/gym/packages/1");
    expect(goBackendTarget("/api/gym/packages/1", "HEAD", opts)).toBe("http://go-api:8080/api/gym/packages/1");
    expect(goBackendTarget("/api/member-portal/workouts/9/start", "POST", opts)).toBe(
      "http://go-api:8080/api/member-portal/workouts/9/start"
    );
  });

  it("leaves a method or path Go does not serve to Next", () => {
    expect(goBackendTarget("/api/gym/packages/1", "DELETE", opts)).toBeNull();
    expect(goBackendTarget("/api/gym/packages/1/thumbnail", "POST", opts)).toBeNull();
  });

  it("needs a switched prefix even when Go serves the route", () => {
    expect(goBackendTarget("/api/member-portal/me", "GET", opts)).toBeNull();
    expect(goBackendTarget("/api/gymnastics", "GET", opts)).toBeNull();
  });

  it("is off without BACKEND_URL and outside /api", () => {
    expect(goBackendTarget("/api/gym", "GET", { ...opts, env: {} })).toBeNull();
    expect(goBackendTarget("/api/gym", "GET", { ...opts, env: { BACKEND_URL: "  " } })).toBeNull();
    expect(goBackendTarget("/gym", "GET", { ...opts, prefixes: ["/gym"] })).toBeNull();
  });

  it("drops a trailing slash on BACKEND_URL", () => {
    expect(goBackendTarget("/api/gym", "GET", { ...opts, env: { BACKEND_URL: "http://go:8080//" } })).toBe(
      "http://go:8080/api/gym"
    );
  });

  it("uses the generated manifest by default", () => {
    expect(goBackendTarget("/api/gym/credits/no/such/route", "GET", { env })).toBeNull();
    expect(goBackendTarget("/api/auth/me", "GET", { env })).toBe("http://go-api:8080/api/auth/me");
    expect(goBackendTarget("/api/auth/me", "GET", { env: {} })).toBeNull();
  });
});

describe("Go route manifest", () => {
  const manifest = goRoutes as GoRoute[];

  it("covers every switched prefix with at least one Go route", () => {
    for (const prefix of GO_BACKEND_PREFIXES) {
      expect(
        manifest.some((r) => r.path === prefix || r.path.startsWith(`${prefix}/`)),
        prefix
      ).toBe(true);
    }
  });

  it("keeps a TypeScript fallback route for every switched Go route", () => {
    const tsPath = (goPath: string) =>
      path.join(
        process.cwd(),
        "src/app",
        goPath.replace(/\{\w+\.\.\.\}/g, "[...rest]").replace(/\{\w+\}/g, "[id]"),
        "route.ts"
      );
    const dirExists = (file: string) => {
      // Dynamic segment names differ between Go ({coachId}) and Next ([id]),
      // so match any bracketed directory at each dynamic position.
      const parts = path.relative(process.cwd(), file).split(path.sep);
      let dirs = [process.cwd()];
      for (const part of parts) {
        const next: string[] = [];
        for (const dir of dirs) {
          if (part.startsWith("[")) {
            for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
              if (entry.startsWith("[")) next.push(path.join(dir, entry));
            }
          } else if (fs.existsSync(path.join(dir, part))) {
            next.push(path.join(dir, part));
          }
        }
        dirs = next;
      }
      return dirs.length > 0;
    };
    const switched = manifest.filter((r) => GO_BACKEND_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`)));
    // gym-training serves workouts/{id}/start and workouts/sessions/{id} with
    // one pattern, because ServeMux rejects the two as overlapping.
    const sharedPatterns = ["/api/member-portal/gym/workouts/{a}/{b}"];
    const missing = switched
      .filter((r) => !sharedPatterns.includes(r.path) && !dirExists(tsPath(r.path)))
      .map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });
});
