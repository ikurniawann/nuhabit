"use client";

/**
 * Helper WebRTC client Live Monitoring (EPIC-005) — dipakai portal kandidat
 * (menjawab offer HRD, mengalirkan kamera) dan halaman HRD (viewer).
 * Vanilla ICE (non-trickle): tunggu ICE gathering selesai lalu tukar SDP
 * lengkap sekali — tanpa endpoint ICE candidate terpisah.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

const OFFER_POLL_MS = 3_000;
const MAX_PEER_CONNECTIONS = 3;
const ICE_GATHER_TIMEOUT_MS = 3_000;

/** Tunggu ICE gathering complete (atau timeout) supaya SDP memuat semua kandidat. */
export function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export interface AnswerLoopOptions {
  stream: MediaStream;
  fetchOffers: () => Promise<{ offer_id: string; sdp: string }[]>;
  postAnswer: (offerId: string, sdp: string) => Promise<unknown>;
}

/**
 * Sisi kandidat: polling offer HRD, jawab tiap offer baru dgn mengalirkan
 * track kamera/mikrofon. Mendukung beberapa viewer sekaligus (maks 3 pc).
 * Return fungsi cleanup.
 */
export function startWebrtcAnswerLoop({
  stream,
  fetchOffers,
  postAnswer,
}: AnswerLoopOptions): () => void {
  const peers = new Map<string, RTCPeerConnection>();
  let cancelled = false;

  const closePeer = (offerId: string) => {
    peers.get(offerId)?.close();
    peers.delete(offerId);
  };

  const answerOffer = async (offer: { offer_id: string; sdp: string }) => {
    if (peers.has(offer.offer_id)) return;
    // batasi jumlah koneksi — tutup yang paling lama
    while (peers.size >= MAX_PEER_CONNECTIONS) {
      const oldest = peers.keys().next().value;
      if (!oldest) break;
      closePeer(oldest);
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.set(offer.offer_id, pc);
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        closePeer(offer.offer_id);
      }
    };
    try {
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      if (cancelled || !pc.localDescription) {
        closePeer(offer.offer_id);
        return;
      }
      await postAnswer(offer.offer_id, pc.localDescription.sdp);
    } catch {
      closePeer(offer.offer_id);
    }
  };

  const poll = async () => {
    if (cancelled) return;
    try {
      const offers = await fetchOffers();
      for (const offer of offers) void answerOffer(offer);
    } catch {
      // polling gagal — coba lagi tick berikutnya
    }
  };
  void poll();
  const timer = setInterval(poll, OFFER_POLL_MS);

  return () => {
    cancelled = true;
    clearInterval(timer);
    for (const pc of peers.values()) pc.close();
    peers.clear();
  };
}

export interface ViewerOptions {
  postOffer: (offerId: string, sdp: string) => Promise<unknown>;
  fetchAnswer: (offerId: string) => Promise<string | null>;
  onStream: (stream: MediaStream) => void;
  onStatus: (status: "connecting" | "connected" | "failed") => void;
}

const ANSWER_POLL_MS = 1_500;
const ANSWER_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 30_000;

/** Sisi HRD: buat offer recvonly, tunggu answer kandidat, sambungkan video. */
export function startWebrtcViewer({
  postOffer,
  fetchAnswer,
  onStream,
  onStatus,
}: ViewerOptions): () => void {
  const offerId = crypto.randomUUID();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let cancelled = false;
  let answerTimer: ReturnType<typeof setInterval> | null = null;
  let failTimer: ReturnType<typeof setTimeout> | null = null;

  const fail = () => {
    if (cancelled) return;
    cancelled = true;
    if (answerTimer) clearInterval(answerTimer);
    if (failTimer) clearTimeout(failTimer);
    pc.close();
    onStatus("failed");
  };

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (event) => {
    if (event.streams[0]) onStream(event.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      if (failTimer) clearTimeout(failTimer);
      onStatus("connected");
    }
    if (["failed", "disconnected", "closed"].includes(pc.connectionState) && !cancelled) fail();
  };

  onStatus("connecting");
  void (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      if (cancelled || !pc.localDescription) return;
      await postOffer(offerId, pc.localDescription.sdp);

      const startedAt = Date.now();
      answerTimer = setInterval(async () => {
        if (cancelled) return;
        if (Date.now() - startedAt > ANSWER_TIMEOUT_MS) {
          fail();
          return;
        }
        try {
          const sdp = await fetchAnswer(offerId);
          if (sdp && pc.signalingState === "have-local-offer") {
            if (answerTimer) clearInterval(answerTimer);
            await pc.setRemoteDescription({ type: "answer", sdp });
            failTimer = setTimeout(() => {
              if (pc.connectionState !== "connected") fail();
            }, CONNECT_TIMEOUT_MS);
          }
        } catch {
          // coba lagi tick berikutnya
        }
      }, ANSWER_POLL_MS);
    } catch {
      fail();
    }
  })();

  return () => {
    cancelled = true;
    if (answerTimer) clearInterval(answerTimer);
    if (failTimer) clearTimeout(failTimer);
    pc.close();
  };
}
