import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import goRoutes from "@/lib/go-routes.generated.json";
import { goOwnsRoute, type GoRoute } from "@/lib/backend-routes";

const root = join(__dirname, "..", "..");
const template = readFileSync(join(root, "..", ".gitlab", "edge", "default.conf.template"), "utf8");

/** Paths the edge hands to Next although they sit under /api/. */
const edgeNextPaths = [...template.matchAll(/^\s*location = (\/api\/\S+) \{/gm)].map((m) => m[1]).sort();

function nextApiRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return nextApiRoutes(full);
    if (name !== "route.ts") return [];
    return ["/" + relative(join(root, "src", "app"), dir).split(sep).join("/")];
  });
}

describe("edge nginx routing", () => {
  it("sends exactly the Next /api handlers to Next", () => {
    expect(edgeNextPaths).toEqual(nextApiRoutes(join(root, "src", "app", "api")).sort());
  });

  it("never sends a route Go owns to Next", () => {
    for (const path of edgeNextPaths) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        expect(goOwnsRoute(path, method), `${method} ${path}`).toBe(false);
      }
    }
  });

  it("covers every Go route with the /api/ prefix", () => {
    expect((goRoutes as GoRoute[]).filter((r) => !r.path.startsWith("/api/"))).toEqual([]);
  });
});
