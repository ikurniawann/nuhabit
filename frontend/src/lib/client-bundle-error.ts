const STALE_BUNDLE_RE =
  /Loading chunk [\w.-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleClientBundleError(error: { name?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return STALE_BUNDLE_RE.test(String(error.message || ""));
}
