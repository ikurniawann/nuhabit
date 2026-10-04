import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Phase-1 guard: scan only the migrated theme/POS/shared UI areas.
// Phase 2/3 should widen SCAN_TARGETS as more modules are migrated to tokens.
const SCAN_TARGETS = [
  "src/features/pos",
  "src/components/ui",
  "src/components/motion",
  "src/components/providers",
  "src/components/shared",
  "src/features/configuration/appearance",
  "src/lib/theme",
  "src/lib/help",
  "src/hooks",
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/dashboard/(dashboard)/settings/appearance",
];

const BANNED_BRAND_HEX = /#(?:db2777|ec4899|be185d|ff00aa)\b/gi;
const SCANNED_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
// Whole-file allowlist: theme preset defaults, anti-flash script, chart SSR fallbacks.
const WHOLE_FILE_ALLOWLIST = new Set([
  "src/lib/theme/presets.ts",
  "src/components/providers/theme-script.tsx",
  "src/features/pos/dashboard/components/pos-dashboard-charts.tsx",
  "src/features/pos/reports/components/profit-report-charts.tsx",
  "src/features/pos/reports/components/apex-chart.tsx",
]);
const GLOBALS_CSS = "src/app/globals.css";

const TEST_FILE_PATTERN = /(?:^|[.-])(test|spec)\.[cm]?[jt]sx?$/;
const repoRoot = process.cwd();
const violations = [];
const scannedFiles = new Set();

for (const target of SCAN_TARGETS) {
  collectFiles(path.join(repoRoot, target));
}

for (const file of scannedFiles) {
  scanFile(file);
}

if (violations.length > 0) {
  console.error(
    [
      "Hardcoded brand hex found in Phase-1 scope. Use theme tokens instead:",
      ...violations,
    ].join("\n")
  );
  process.exit(1);
}

console.log("OK");

function collectFiles(targetPath) {
  if (!existsSync(targetPath)) return;

  const stat = statSync(targetPath);
  if (stat.isFile()) {
    addFile(targetPath);
    return;
  }

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;

    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath);
      continue;
    }

    if (entry.isFile()) {
      addFile(entryPath);
    }
  }
}

function addFile(filePath) {
  const relativePath = toRepoPath(filePath);
  if (!SCANNED_EXTENSIONS.has(path.extname(filePath))) return;
  if (TEST_FILE_PATTERN.test(path.basename(filePath))) return;

  scannedFiles.add(relativePath);
}

function scanFile(relativePath) {
  const content = readFileSync(path.join(repoRoot, relativePath), "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    BANNED_BRAND_HEX.lastIndex = 0;

    for (const match of line.matchAll(BANNED_BRAND_HEX)) {
      if (isAllowedMatch(relativePath, line, match[0])) continue;

      violations.push(`${relativePath}:${index + 1}:${line}`);
    }
  });
}

function isAllowedMatch(relativePath, line, _rawMatch) {
  if (WHOLE_FILE_ALLOWLIST.has(relativePath)) {
    return true;
  }

  // Brand defaults in globals.css only (e.g. --brand-primary: #db2777).
  if (relativePath === GLOBALS_CSS) {
    return /--brand-primary|--brand-secondary/.test(line);
  }

  return false;
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}
