#!/usr/bin/env node
/**
 * Lists modules under src/ that no Next entry point imports, directly or
 * through other modules, and the tests that cover only those modules.
 *
 *   node scripts/find-dead-modules.mjs          # summary plus file lists
 *   node scripts/find-dead-modules.mjs --json   # machine-readable
 *
 * Entry points: the app router files (page, layout, route, loading, error,
 * not-found, template, default, sitemap, robots and the image routes),
 * proxy.ts, instrumentation*.ts, *.d.ts, the vitest setup file, next.config.ts,
 * everything under scripts/ and the modules that backend/ Go tests load by
 * path (parity checks). Imports are resolved with tsconfig.json, so
 * the "@/" alias, index files and type-only imports count. A module that only
 * tests reach is dead.
 *
 * Tests fall in three groups: dead (every src module they import is dead or
 * gone), mixed (some are) and live. vi.mock() targets do not count as
 * coverage, but a `typeof import()` inside a mock factory does, so review
 * mixed tests by hand: most only need the types. The script reads only
 * string-literal imports: check template literal import() calls and
 * file-system lookups by hand before deleting.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "package.json"))("typescript");

const src = path.join(root, "src");
const { config } = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
const host = ts.createCompilerHost(options);

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST = /\.(test|spec)\.(ts|tsx|js|jsx)$|\/__tests__\//;
// Test helpers: dead once no test imports them.
const SUPPORT = /\.test-(util|fixtures)\.|\/src\/test\/|\/__mocks__\//;
const APP_ENTRY =
  /^(page|layout|route|loading|error|global-error|not-found|template|default|sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.(ts|tsx|js|jsx)$/;
const ROOT_ENTRY = /^(proxy|middleware|instrumentation(-client)?)\.(ts|js)$/;

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

const isLocal = (spec) => spec.startsWith(".") || spec.startsWith("@/");
const resolve = (spec, from) => {
  const hit = ts.resolveModuleName(spec, from, options, host).resolvedModule;
  if (hit && !hit.isExternalLibraryImport) return path.resolve(hit.resolvedFileName);
  if (!isLocal(spec)) return null;
  const file = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
};

const parsed = new Map();
/** { imports, mocks, missing } for one file: resolved paths, plus local specifiers that resolve to nothing. */
const parse = (file) => {
  if (parsed.has(file)) return parsed.get(file);
  const out = { imports: [], mocks: [], missing: [] };
  if (CODE.test(file)) {
    const text = fs.readFileSync(file, "utf8");
    const specs = ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName);
    const mocks = [...text.matchAll(/\bvi\.(?:mock|doMock|importActual|importMock)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    for (const [list, into] of [[specs, out.imports], [mocks, out.mocks]]) {
      for (const spec of list) {
        const file2 = resolve(spec, file);
        if (file2) into.push(file2);
        else if (isLocal(spec)) out.missing.push(spec);
      }
    }
  }
  parsed.set(file, out);
  return out;
};

const reach = (starts) => {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const { imports, mocks } = parse(file);
    stack.push(...imports, ...mocks);
  }
  return seen;
};

const files = listFiles(src);
const entries = files.filter((f) => {
  const rel = path.relative(src, f);
  return (rel.startsWith(`app${path.sep}`) && APP_ENTRY.test(path.basename(f))) || ROOT_ENTRY.test(rel) || f.endsWith(".d.ts");
});
const setup = path.join(src, "test", "setup.ts");
if (fs.existsSync(setup)) entries.push(setup);
const nextConfig = path.join(root, "next.config.ts");
if (fs.existsSync(nextConfig)) entries.push(nextConfig);
entries.push(...listFiles(path.join(root, "scripts")).filter((f) => CODE.test(f)));
// Go parity tests import TS modules by path, e.g. lib + "/spreadsheet/exceljs-safe.ts".
const backend = path.join(root, "..", "backend");
if (fs.existsSync(backend)) {
  const goTests = listFiles(backend)
    .filter((f) => f.endsWith("_test.go"))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  const named = (rel) => goTests.includes(`/${rel}"`) || goTests.includes(`"${rel}"`);
  entries.push(...files.filter((f) => named(path.relative(path.join(src, "lib"), f)) || named(path.relative(src, f))));
}

const live = reach(entries);
const tests = files.filter((f) => TEST.test(f));
const testReach = reach(tests);
const dead = files.filter(
  (f) => CODE.test(f) && !TEST.test(f) && !f.endsWith(".d.ts") && !live.has(f) && !(SUPPORT.test(f) && testReach.has(f)),
);
const deadSet = new Set(dead);

const deadTests = [];
const mixedTests = [];
for (const test of tests) {
  const { imports, missing } = parse(test);
  const covered = imports.filter((d) => d.startsWith(src) && !TEST.test(d) && !SUPPORT.test(d));
  const gone = [...covered.filter((d) => deadSet.has(d)), ...missing];
  if (gone.length === 0) continue;
  if (gone.length === covered.length + missing.length) deadTests.push(test);
  else mixedTests.push({ test, gone, kept: covered.filter((d) => !deadSet.has(d)) });
}
const broken = files.filter((f) => live.has(f) && !TEST.test(f) && parse(f).missing.length);

const rel = (f) => (path.isAbsolute(f) ? path.relative(root, f) : f);
const report = {
  dead: dead.map(rel),
  deadTests: deadTests.map(rel),
  mixedTests: mixedTests.map((m) => ({ test: rel(m.test), gone: [...new Set(m.gone.map(rel))], kept: [...new Set(m.kept.map(rel))] })),
  brokenLive: broken.map((f) => ({ file: rel(f), missing: parse(f).missing })),
};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`entries ${entries.length}, live ${live.size}, dead ${dead.length}, dead tests ${deadTests.length}, mixed tests ${mixedTests.length}`);
  for (const f of report.dead) console.log(`dead       ${f}`);
  for (const f of report.deadTests) console.log(`dead test  ${f}`);
  for (const m of report.mixedTests) console.log(`mixed test ${m.test}: gone ${m.gone.join(", ")}; live ${m.kept.join(", ")}`);
  for (const b of report.brokenLive) console.log(`broken     ${b.file}: ${b.missing.join(", ")}`);
}
