import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  goBackendTarget,
  goOwnsRoute,
  matchesGoPattern,
  type GoRoute,
} from "./backend-routes";

const env = { BACKEND_URL: "http://go-api:8080" };
const routes: GoRoute[] = [
  { module: "t", method: "GET", path: "/api/gym" },
  { module: "t", method: "GET", path: "/api/gym/packages/{id}" },
  { module: "t", method: "POST", path: "/api/member-portal/workouts/{a}/{b}" },
  { module: "t", method: "*", path: "/api/gym/members/{id}/{sub}" },
];
const opts = { routes, env };

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
  it("returns BACKEND_URL + path for a route Go registers", () => {
    expect(goBackendTarget("/api/gym", "GET", opts)).toEqual({
      url: "http://go-api:8080/api/gym",
    });
    expect(goBackendTarget("/api/gym/packages/1", "HEAD", opts)).toEqual({
      url: "http://go-api:8080/api/gym/packages/1",
    });
    expect(
      goBackendTarget("/api/member-portal/workouts/9/start", "post", opts),
    ).toEqual({ url: "http://go-api:8080/api/member-portal/workouts/9/start" });
  });

  it("forwards every method for a method-less pattern", () => {
    for (const method of ["PATCH", "DELETE"]) {
      expect(
        goBackendTarget("/api/gym/members/7/notes", method, opts),
      ).toEqual({ url: "http://go-api:8080/api/gym/members/7/notes" });
    }
  });

  it("leaves a method or path Go does not register to Next", () => {
    expect(goBackendTarget("/api/gym/packages/1", "DELETE", opts)).toBeNull();
    expect(
      goBackendTarget("/api/gym/packages/1/thumbnail", "POST", opts),
    ).toBeNull();
    expect(goBackendTarget("/api/gymnastics", "GET", opts)).toBeNull();
    expect(goBackendTarget("/gym", "GET", opts)).toBeNull();
  });

  it("keeps a Go route away from Next while BACKEND_URL is unset", () => {
    expect(goBackendTarget("/api/gym", "GET", { routes, env: {} })).toEqual({
      url: null,
    });
    expect(
      goBackendTarget("/api/gym", "GET", {
        routes,
        env: { BACKEND_URL: "  " },
      }),
    ).toEqual({ url: null });
  });

  it("drops a trailing slash on BACKEND_URL", () => {
    expect(
      goBackendTarget("/api/gym", "GET", {
        routes,
        env: { BACKEND_URL: "http://go:8080//" },
      }),
    ).toEqual({ url: "http://go:8080/api/gym" });
  });

  it("uses the generated manifest by default", () => {
    expect(goBackendTarget("/api/auth/me", "GET", { env })).toEqual({
      url: "http://go-api:8080/api/auth/me",
    });
    expect(goBackendTarget("/api/auth/me", "GET", { env: {} })).toEqual({
      url: null,
    });
    expect(
      goBackendTarget("/api/gym/credits/no/such/route", "GET", { env }),
    ).toBeNull();
  });

  it("leaves the Next health and readiness probes to Next", () => {
    expect(goBackendTarget("/api/health", "GET", { env })).toBeNull();
    expect(goBackendTarget("/api/ready", "GET", { env })).toBeNull();
  });
});

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Every exported HTTP method of every Next API route, as "METHOD /api/x/[id]". */
function nextApiRoutes(): string[] {
  const root = path.join(process.cwd(), "src/app");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const src = fs.readFileSync(full, "utf8");
        const route = "/" + path.relative(root, dir).split(path.sep).join("/");
        for (const m of HTTP_METHODS) {
          const exported = [
            `export\\s+(const|async function|function)\\s+${m}\\b`,
            `export\\s+const\\s*\\{[^}]*\\b${m}\\b`,
            `export\\s*\\{[^}]*\\b${m}\\b`,
          ].some((re) => new RegExp(re).test(src));
          if (exported) out.push(`${m} ${route}`);
        }
      }
    }
  };
  walk(path.join(root, "api"));
  return out;
}

/** A concrete path for a Next route: "[id]" -> "x1", "[...path]" -> "a/b". */
const samplePath = (route: string) =>
  route.replace(/\[\.\.\.\w+\]/g, "a/b").replace(/\[\w+\]/g, "x1");

describe("Next API routes", () => {
  it("never shadow a route Go registers", () => {
    const shadowed = nextApiRoutes().filter((entry) => {
      const [method, route] = entry.split(" ");
      return goOwnsRoute(samplePath(route), method);
    });
    expect(shadowed).toEqual([]);
  });
});
