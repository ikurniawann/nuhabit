"use client";

/**
 * Jejak buka/klik notifikasi in-app untuk laporan kampanye CRM.
 * Fire-and-forget: kegagalan jejak tidak boleh mengganggu member.
 * `keepalive` menjaga permintaan klik tetap terkirim saat halaman berpindah.
 */
export function trackNotification(id: string, event: "open" | "click"): void {
  void fetch("/api/member-portal/notifications/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, event }),
    keepalive: true,
  }).catch(() => {});
}
