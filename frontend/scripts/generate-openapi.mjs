#!/usr/bin/env node
/**
 * EPIC-042: inventaris seluruh endpoint /api/* → JSON paths OpenAPI.
 *
 * Dipakai /api/openapi.json sebagai basis spec yang dikonsumsi agent
 * (OpenClaw dsb.). Jalankan ulang setelah `make -C backend generate` atau
 * setelah menambah/menghapus route Next:
 *
 *   node scripts/generate-openapi.mjs
 *
 * Sumber: route Go di src/lib/go-routes.generated.json plus route.ts yang
 * masih ada di src/app/api. Ringkasan dan nama parameter diambil dari file
 * keluaran sebelumnya bila operasinya sudah ada, supaya spec tetap stabil.
 * Pola dispatcher Go ({a}/{b}, method *) memakai operasi lama yang
 * dicocokkannya; operasi lama yang tidak dilayani siapa pun dibuang.
 *
 * Output: src/lib/api-docs/openapi-paths.generated.json (di-commit ke repo:
 * production build standalone tidak membawa source utk di-scan runtime).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "src", "app", "api");
const manifestFile = join(root, "src", "lib", "go-routes.generated.json");
const outFile = join(root, "src", "lib", "api-docs", "openapi-paths.generated.json");

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")).paths : {};
const goRoutes = JSON.parse(readFileSync(manifestFile, "utf8"));

/** Same rules as matchesGoPattern in src/lib/backend-routes.ts. */
function matchesGoPattern(pattern, pathname) {
  const want = pattern.split("/");
  const got = pathname.split("/");
  for (let i = 0; i < want.length; i++) {
    const seg = want[i];
    if (seg === "{$}") return i === got.length - 1 && got[i] === "";
    if (seg === "" && i === want.length - 1 && i > 0) return got.length > i;
    if (/^\{\w+\.\.\.\}$/.test(seg)) return true;
    if (i >= got.length) return false;
    if (/^\{\w+\}$/.test(seg)) {
      if (got[i] === "") return false;
      continue;
    }
    if (seg !== got[i]) return false;
  }
  return want.length === got.length;
}

/** "/x/{id}/{rest...}" → "/x/{}/{}": paths that differ only in parameter names share a key. */
const shape = (path) => path.replace(/\{[^}]+\}/g, "{}");
/** A concrete path for an OpenAPI path: "{id}" → "x1". */
const sample = (path) => path.replace(/\{[^}]+\}/g, "x1");
const tagOf = (path) => path.replace(/^\/api\//, "").split("/")[0] || "root";

function operation(path, method, summary) {
  const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  return {
    tags: [tagOf(path)],
    summary: summary || `${method} ${path}`,
    ...(params.length ? { parameters: params } : {}),
    responses: { 200: { description: "OK" } },
    security: [{ bearerAuth: [] }],
  };
}

const paths = {};
const add = (path, method, op) => {
  paths[path] ??= {};
  paths[path][method.toLowerCase()] = op;
};

const previousOps = Object.entries(previous).flatMap(([path, ops]) =>
  Object.entries(ops).map(([method, op]) => ({ path, method: method.toUpperCase(), op })),
);
const explicit = goRoutes.filter((r) => r.method !== "*");
const explicitShapes = new Set(explicit.map((r) => `${r.method} ${shape(r.path)}`));

// 1. Go routes: keep the earlier entry of the same shape, else a default one.
for (const r of explicit) {
  const old = previousOps.find((p) => p.method === r.method && shape(p.path) === shape(r.path));
  const path = r.path.replace(/\{(\w+)\.\.\.\}/g, "{$1}");
  if (old) add(old.path, old.method, old.op);
  else add(path, r.method, operation(path, r.method));
}

// 2. Earlier operations that a Go wildcard or method-less pattern now serves.
for (const p of previousOps) {
  if (explicitShapes.has(`${p.method} ${shape(p.path)}`)) continue;
  const served = goRoutes.some(
    (r) => (r.method === "*" || r.method === p.method) && matchesGoPattern(r.path, sample(p.path)),
  );
  if (served) add(p.path, p.method, p.op);
}

// 3. Routes Next still serves.
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name === "route.ts" || entry.name === "route.js") yield full;
  }
}

function apiPathFor(file) {
  const rel = file.slice(apiDir.length).replace(/\/route\.(ts|js)$/, "");
  // Next [param] / [...param] → {param} gaya OpenAPI
  return (
    "/api" +
    rel
      .split("/")
      .map((seg) => (seg.startsWith("[") ? `{${seg.replace(/^\[(\.\.\.)?/, "").replace(/\]$/, "")}}` : seg))
      .join("/")
  );
}

function firstDocLine(source) {
  const m = /\/\*\*?\s*\n?\s*\*?\s*([^\n*]{10,160})/.exec(source);
  return m ? m[1].trim() : "";
}

for (const file of walk(apiDir)) {
  const source = readFileSync(file, "utf8");
  const apiPath = apiPathFor(file);
  for (const method of METHODS) {
    const exported = [
      `export\\s+(async\\s+)?function\\s+${method}\\b`,
      `export\\s+const\\s+${method}\\b`,
      `export\\s+const\\s*\\{[^}]*\\b${method}\\b`,
    ].some((re) => new RegExp(re).test(source));
    if (exported) {
      add(apiPath, method, previous[apiPath]?.[method.toLowerCase()] ?? operation(apiPath, method, firstDocLine(source)));
    }
  }
}

// Order of the old directory walk: segments by name ("{id}" as "[id]"), the
// path's own route.ts among its children, methods in METHODS order.
const walkKey = (path) => [...path.split("/").slice(1).map((s) => s.replace(/^\{(.*)\}$/, "[$1]")), "route.ts"];
const byWalk = (a, b) => {
  const x = walkKey(a);
  const y = walkKey(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
};
const sorted = Object.fromEntries(
  Object.keys(paths)
    .sort(byWalk)
    .map((p) => [p, Object.fromEntries(METHODS.map((m) => m.toLowerCase()).filter((m) => paths[p][m]).map((m) => [m, paths[p][m]]))]),
);
const routeCount = Object.values(sorted).reduce((n, ops) => n + Object.keys(ops).length, 0);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ generated_route_count: routeCount, paths: sorted }, null, 1));
console.log(`OpenAPI paths: ${Object.keys(sorted).length} path, ${routeCount} operasi → ${outFile}`);
