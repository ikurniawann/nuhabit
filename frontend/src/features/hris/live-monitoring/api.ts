export type LiveSessionType = "psikotes" | "interview";

export interface LiveMonitorSession {
  session_type: LiveSessionType;
  session_id: string;
  started_at: string | null;
  candidate_name: string;
  position_title: string | null;
  frame_updated_at: string | null;
  last_message_at: string | null;
  last_message_sender: "candidate" | "hr" | null;
}

export interface LiveMonitorChatMessage {
  id: string;
  sender: "candidate" | "hr";
  sender_name: string | null;
  message: string;
  created_at: string;
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof json === "object" && json && "error" in json
        ? String((json as { error?: string }).error)
        : `Permintaan gagal (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export const fetchLiveSessions = () =>
  fetch("/api/recruitment/live-monitoring")
    .then((r) => parse<{ data: LiveMonitorSession[] }>(r))
    .then((r) => r.data);

export const liveFrameUrl = (type: LiveSessionType, sessionId: string, tick: number) =>
  `/api/recruitment/live-monitoring/${type}/${sessionId}/frame?t=${tick}`;

export const fetchLiveMonitorChat = (type: LiveSessionType, sessionId: string, after?: string) =>
  fetch(
    `/api/recruitment/live-monitoring/${type}/${sessionId}/chat${
      after ? `?after=${encodeURIComponent(after)}` : ""
    }`
  )
    .then((r) => parse<{ data: LiveMonitorChatMessage[] }>(r))
    .then((r) => r.data);

export const sendLiveMonitorChat = (type: LiveSessionType, sessionId: string, message: string) =>
  fetch(`/api/recruitment/live-monitoring/${type}/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
    .then((r) => parse<{ data: LiveMonitorChatMessage }>(r))
    .then((r) => r.data);

/** Signaling WebRTC — sisi HRD (viewer). */
export const postWebrtcOffer = (
  type: LiveSessionType,
  sessionId: string,
  offerId: string,
  sdp: string
) =>
  fetch(`/api/recruitment/live-monitoring/${type}/${sessionId}/webrtc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer_id: offerId, sdp }),
  }).then((r) => parse<{ data: { ok: boolean } }>(r));

export const fetchWebrtcAnswer = (type: LiveSessionType, sessionId: string, offerId: string) =>
  fetch(
    `/api/recruitment/live-monitoring/${type}/${sessionId}/webrtc?offer_id=${encodeURIComponent(offerId)}`
  )
    .then((r) => parse<{ data: { sdp: string | null } }>(r))
    .then((r) => r.data.sdp);
