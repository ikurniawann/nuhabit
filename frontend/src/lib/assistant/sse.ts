/**
 * Pemotong aliran SSE (EPIC-017 Fase B).
 *
 * Dipakai dua sisi: server saat membaca stream OpenAI, dan browser saat membaca
 * stream dari route kita. Dipisah ke sini supaya logikanya satu dan bisa diuji —
 * bug parsing stream sulit terlihat di UI karena gejalanya cuma "jawaban
 * terpotong sesekali".
 */

/**
 * Pisahkan buffer menjadi event-event utuh; potongan terakhir yang belum
 * lengkap dikembalikan sebagai `rest` untuk digabung dengan chunk berikutnya.
 *
 * Ini inti kebenarannya: satu chunk jaringan TIDAK dijamin memuat satu event
 * utuh — bisa setengah, bisa tiga setengah.
 */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts, rest };
}

/** Ambil isi seluruh baris `data:` dalam satu event (bisa lebih dari satu). */
export function extractSseData(event: string): string[] {
  const out: string[] = [];
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload) out.push(payload);
  }
  return out;
}

/** Potongan teks dari satu payload delta OpenAI; null bila bukan delta teks. */
export function readOpenAiDelta(payload: string): string | null {
  if (payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    // Payload rusak dilewati, bukan menggagalkan seluruh stream.
    return null;
  }
}
