import type { LiveChatWidgetMessage } from "@/components/recruitment/live-chat-widget";
import { jsonBody, portalRequest } from "@/lib/recruitment/portal-client";
import type {
  InterviewAnswerResult,
  InterviewPortalCurrentTurn,
  InterviewPortalData,
  InterviewProctorEventType,
} from "./types";

const base = (token: string) => `/api/interview/session/${token}`;

export const fetchInterviewSession = (token: string) =>
  portalRequest<{ data: InterviewPortalData }>(base(token)).then((r) => r.data);

export const startInterviewSession = (token: string) =>
  portalRequest<{ data: { turn: InterviewPortalCurrentTurn | null } }>(
    `${base(token)}/start`,
    jsonBody("POST", { webcam_consent: true })
  ).then((r) => r.data);

function postAnswer(token: string, turnId: string, fill: (form: FormData) => void) {
  const form = new FormData();
  form.append("turn_id", turnId);
  fill(form);
  return portalRequest<{ data: InterviewAnswerResult }>(`${base(token)}/answer`, {
    method: "POST",
    body: form,
  }).then((r) => r.data);
}

/** Kirim jawaban suara (rekaman MediaRecorder). */
export const answerInterviewVoice = (token: string, turnId: string, audio: Blob) =>
  postAnswer(token, turnId, (form) => {
    form.append("mode", "voice");
    form.append("audio", audio, "answer.webm");
  });

/** Kirim jawaban ketik (fallback bila mikrofon bermasalah). */
export const answerInterviewText = (token: string, turnId: string, text: string) =>
  postAnswer(token, turnId, (form) => {
    form.append("mode", "text");
    form.append("answer_text", text);
  });

/** Fire-and-forget: kegagalan proctoring tidak boleh mengganggu interview. */
export const postInterviewProctorEvent = (
  token: string,
  eventType: InterviewProctorEventType,
  extra?: { meta?: Record<string, string | number | boolean>; snapshot?: string }
) =>
  fetch(`${base(token)}/proctor-event`, jsonBody("POST", { event_type: eventType, ...extra }, { keepalive: true })).catch(
    () => undefined
  );

/** Frame near-live utk Live Monitoring HRD, fire-and-forget. */
export const postInterviewLiveFrame = (token: string, frame: string) =>
  fetch(`${base(token)}/live-frame`, jsonBody("POST", { frame })).catch(() => undefined);

export const fetchInterviewLiveChat = (token: string, after?: string) =>
  portalRequest<{ data: LiveChatWidgetMessage[] }>(
    `${base(token)}/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`
  ).then((r) => r.data);

export const sendInterviewLiveChat = (token: string, message: string) =>
  portalRequest<{ data: LiveChatWidgetMessage }>(`${base(token)}/chat`, jsonBody("POST", { message })).then(
    (r) => r.data
  );

/** Signaling WebRTC live monitoring, sisi kandidat. */
export const fetchInterviewWebrtcOffers = (token: string) =>
  portalRequest<{ data: { offers: { offer_id: string; sdp: string }[] } }>(`${base(token)}/webrtc`).then(
    (r) => r.data.offers
  );

export const postInterviewWebrtcAnswer = (token: string, offerId: string, sdp: string) =>
  portalRequest(`${base(token)}/webrtc`, jsonBody("POST", { offer_id: offerId, sdp }));

/** Unggah potongan rekaman video interview; dipanggil berurutan tiap 10 dtk. */
export const postRecordingChunk = (token: string, part: string, chunk: Blob) => {
  const form = new FormData();
  form.append("part", part);
  form.append("chunk", chunk, "chunk.webm");
  return fetch(`${base(token)}/recording-chunk`, {
    method: "POST",
    body: form,
    keepalive: chunk.size < 60_000, // flush terakhir saat tab ditutup
  }).catch(() => undefined);
};
