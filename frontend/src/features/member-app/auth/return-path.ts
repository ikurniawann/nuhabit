import { m } from "../lib/links";

/** Where to land after sign-in: `?from=` set by the app guard or /join, same-origin app paths only. */
export function returnPath(): string {
  const from = new URLSearchParams(window.location.search).get("from");
  const allowed = from && !from.startsWith("//") && (from.startsWith("/member") || from.startsWith("/join"));
  return allowed ? from : m("/");
}
