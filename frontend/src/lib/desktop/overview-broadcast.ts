import { createHash } from "node:crypto";
import { buildDesktopOverview, type DesktopOverview } from "@/lib/desktop/overview";

/**
 * Sumber tunggal perubahan papan desktop untuk SSE.
 *
 * Tanpa ini, tiap tab yang terhubung akan menjalankan polling-nya sendiri ke
 * database. Di sini SATU interval melayani semua pelanggan, dan hanya
 * menyiarkan ketika isinya benar-benar berubah (dibandingkan lewat hash).
 */

const POLL_MS = 30_000;

type Listener = (payload: { overview: DesktopOverview; hash: string }) => void;

const listeners = new Set<Listener>();
let timer: NodeJS.Timeout | null = null;
let lastHash: string | null = null;
let lastOverview: DesktopOverview | null = null;
let polling = false;

function hashOverview(overview: DesktopOverview): string {
  // `dibuatPada` berubah tiap poll — dibuang supaya tidak selalu "berubah".
  const { dibuatPada: _ignored, ...rest } = overview;
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex");
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const overview = await buildDesktopOverview("today");
    const hash = hashOverview(overview);
    lastOverview = overview;
    if (hash === lastHash) return;
    lastHash = hash;
    for (const listener of listeners) {
      try {
        listener({ overview, hash });
      } catch {
        /* satu pelanggan bermasalah tidak boleh menjatuhkan yang lain */
      }
    }
  } catch (error) {
    console.warn("[desktop:broadcast] poll gagal:", error);
  } finally {
    polling = false;
  }
}

export function subscribeOverview(listener: Listener): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => void poll(), POLL_MS);
    // Interval ini tidak boleh menahan proses tetap hidup saat shutdown.
    timer.unref?.();
    void poll();
  } else if (lastOverview && lastHash) {
    // Pelanggan baru langsung mendapat snapshot terakhir, tanpa menunggu poll.
    queueMicrotask(() => listener({ overview: lastOverview!, hash: lastHash! }));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function overviewSubscriberCount(): number {
  return listeners.size;
}
