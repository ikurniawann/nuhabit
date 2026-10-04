import { z } from "zod";
import type { LiveSessionType } from "./live-monitor";

/**
 * Signaling WebRTC Live Monitoring (EPIC-005): video smooth real-time
 * langsung dari kamera kandidat → browser HRD (P2P, STUN publik, vanilla
 * ICE non-trickle: SDP lengkap dipertukarkan sekali, tanpa endpoint ICE
 * terpisah dan tanpa media server).
 *
 * Alur: HRD buka detail → POST offer (disimpan di memori) → portal kandidat
 * polling offer pending → jawab semua offer → HRD polling answer → connect.
 * Store in-memory (PM2 single instance); entri kedaluwarsa 2 menit.
 * Bila P2P gagal (NAT simetris dua sisi tanpa TURN), HRD fallback otomatis
 * ke mode frame polling yang lama.
 */

interface SignalEntry {
  offerId: string;
  offerSdp: string;
  answerSdp: string | null;
  createdAt: number;
}

const TTL_MS = 2 * 60 * 1000;
const MAX_OFFERS_PER_SESSION = 3;
const MAX_SDP_CHARS = 100_000;

/** key sesi → daftar offer aktif (mendukung beberapa viewer HRD sekaligus). */
const store = new Map<string, SignalEntry[]>();

const sessionKey = (type: LiveSessionType, sessionId: string) => `${type}:${sessionId}`;

function pruneExpired(entries: SignalEntry[]): SignalEntry[] {
  const now = Date.now();
  return entries.filter((e) => now - e.createdAt < TTL_MS);
}

export const sdpSchema = z.string().min(1).max(MAX_SDP_CHARS);

/** HRD menaruh offer baru; offer terlama dibuang bila melewati kuota. */
export function putOffer(
  type: LiveSessionType,
  sessionId: string,
  offerId: string,
  offerSdp: string
): void {
  const key = sessionKey(type, sessionId);
  const entries = pruneExpired(store.get(key) ?? []);
  entries.push({ offerId, offerSdp, answerSdp: null, createdAt: Date.now() });
  while (entries.length > MAX_OFFERS_PER_SESSION) entries.shift();
  store.set(key, entries);
}

/** Kandidat mengambil offer yang belum terjawab. */
export function getPendingOffers(
  type: LiveSessionType,
  sessionId: string
): { offer_id: string; sdp: string }[] {
  const key = sessionKey(type, sessionId);
  const entries = pruneExpired(store.get(key) ?? []);
  store.set(key, entries);
  return entries
    .filter((e) => e.answerSdp === null)
    .map((e) => ({ offer_id: e.offerId, sdp: e.offerSdp }));
}

/** Kandidat menjawab satu offer. Return false bila offer tidak dikenal. */
export function putAnswer(
  type: LiveSessionType,
  sessionId: string,
  offerId: string,
  answerSdp: string
): boolean {
  const key = sessionKey(type, sessionId);
  const entries = pruneExpired(store.get(key) ?? []);
  const entry = entries.find((e) => e.offerId === offerId);
  if (!entry) return false;
  entry.answerSdp = answerSdp;
  store.set(key, entries);
  return true;
}

/** HRD mengambil answer utk offer miliknya (null bila belum dijawab). */
export function getAnswer(
  type: LiveSessionType,
  sessionId: string,
  offerId: string
): string | null {
  const key = sessionKey(type, sessionId);
  const entries = pruneExpired(store.get(key) ?? []);
  store.set(key, entries);
  return entries.find((e) => e.offerId === offerId)?.answerSdp ?? null;
}
