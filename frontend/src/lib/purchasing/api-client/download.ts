/**
 * Unduh file ekspor (xlsx) dari API purchasing. Nama file diambil dari
 * Content-Disposition, jatuh ke `fallbackName` bila tidak ada.
 */
export async function downloadExport(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(payload?.message || payload?.error || "Ekspor gagal");
  }

  const blob = await response.blob();
  const match = (response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = match?.[1] || fallbackName;
  link.click();
  URL.revokeObjectURL(href);
}
