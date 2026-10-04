/**
 * Escape nilai untuk disisipkan ke HTML (teks atau atribut ber-kutip).
 * Dipakai setiap kali HTML dirakit sebagai string: jendela print
 * (document.write) dan badan email. null/undefined menjadi string kosong.
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
