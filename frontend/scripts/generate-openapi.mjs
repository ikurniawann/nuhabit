#!/usr/bin/env node
/**
 * EPIC-042: inventaris seluruh endpoint /api/* → JSON paths OpenAPI.
 *
 * Dipakai /api/openapi.json sebagai basis spec yang dikonsumsi agent
 * (OpenClaw dsb.). Jalankan ulang setiap kali menambah/menghapus route:
 *
 *   node scripts/generate-openapi.mjs
 *
 * Output: src/lib/api-docs/openapi-paths.generated.json (di-commit ke repo —
 * production build standalone tidak membawa source utk di-scan runtime).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "src", "app", "api");
const outFile = join(root, "src", "lib", "api-docs", "openapi-paths.generated.json");

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

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
      .map((seg) =>
        seg.startsWith("[") ? `{${seg.replace(/^\[(\.\.\.)?/, "").replace(/\]$/, "")}}` : seg
      )
      .join("/")
  );
}

function firstDocLine(source) {
  const m = /\/\*\*?\s*\n?\s*\*?\s*([^\n*]{10,160})/.exec(source);
  return m ? m[1].trim() : "";
}

const paths = {};
let routeCount = 0;
for (const file of walk(apiDir)) {
  const source = readFileSync(file, "utf8");
  const apiPath = apiPathFor(file);
  const summary = firstDocLine(source);
  const params = [...apiPath.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  const tag = apiPath.replace(/^\/api\//, "").split("/")[0] || "root";
  for (const method of METHODS) {
    const has =
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s+const\\s+${method}\\b`).test(source);
    if (!has) continue;
    paths[apiPath] ??= {};
    paths[apiPath][method.toLowerCase()] = {
      tags: [tag],
      summary: summary || `${method} ${apiPath}`,
      ...(params.length ? { parameters: params } : {}),
      responses: { 200: { description: "OK" } },
      security: [{ bearerAuth: [] }],
    };
    routeCount += 1;
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ generated_route_count: routeCount, paths }, null, 1));
console.log(`OpenAPI paths: ${Object.keys(paths).length} path, ${routeCount} operasi → ${outFile}`);
