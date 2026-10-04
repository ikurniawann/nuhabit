import type { LiveChatWidgetMessage } from "@/components/recruitment/live-chat-widget";
import { jsonBody, portalRequest } from "@/lib/recruitment/portal-client";
import type { PortalSessionData, PortalTestStartData, ProctorEventType } from "./types";

const base = (token: string) => `/api/psikotes/session/${token}`;

export const fetchPortalSession = (token: string) =>
  portalRequest<{ data: PortalSessionData }>(base(token)).then((r) => r.data);

export const startPortalSession = (token: string, webcamConsent: boolean) =>
  portalRequest(`${base(token)}/start`, jsonBody("POST", { webcam_consent: webcamConsent }));

export const startPortalTest = (token: string, testId: string) =>
  portalRequest<{ data: PortalTestStartData }>(`${base(token)}/tests/${testId}/start`, { method: "POST" }).then(
    (r) => r.data
  );

export const savePortalAnswers = (token: string, testId: string, answers: Record<string, string>) =>
  portalRequest(`${base(token)}/tests/${testId}/answers`, jsonBody("PUT", { answers }));

export const finishPortalTest = (token: string, testId: string, answers?: Record<string, string>) =>
  portalRequest(
    `${base(token)}/tests/${testId}/finish`,
    // auto-submit saat waktu habis harus tetap terkirim walau tab ditutup
    jsonBody("POST", answers ? { answers } : {}, { keepalive: true })
  );

export const uploadPortalDrawing = (token: string, testId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return portalRequest(`${base(token)}/tests/${testId}/upload`, { method: "POST", body: form });
};

export const finishPortalSession = (token: string) =>
  portalRequest(`${base(token)}/finish`, { method: "POST", keepalive: true });

/** Fire-and-forget: kegagalan proctoring tidak boleh mengganggu tes. */
export const postProctorEvent = (
  token: string,
  eventType: ProctorEventType,
  extra?: { meta?: Record<string, string | number | boolean>; snapshot?: string }
) =>
  fetch(`${base(token)}/proctor-event`, jsonBody("POST", { event_type: eventType, ...extra }, { keepalive: true })).catch(
    () => undefined
  );

/** Frame near-live utk Live Monitoring HRD, fire-and-forget. */
export const postLiveFrame = (token: string, frame: string) =>
  fetch(`${base(token)}/live-frame`, jsonBody("POST", { frame })).catch(() => undefined);

export const fetchLiveChat = (token: string, after?: string) =>
  portalRequest<{ data: LiveChatWidgetMessage[] }>(
    `${base(token)}/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`
  ).then((r) => r.data);

export const sendLiveChat = (token: string, message: string) =>
  portalRequest<{ data: LiveChatWidgetMessage }>(`${base(token)}/chat`, jsonBody("POST", { message })).then(
    (r) => r.data
  );

/** Signaling WebRTC live monitoring, sisi kandidat. */
export const fetchWebrtcOffers = (token: string) =>
  portalRequest<{ data: { offers: { offer_id: string; sdp: string }[] } }>(`${base(token)}/webrtc`).then(
    (r) => r.data.offers
  );

export const postWebrtcAnswer = (token: string, offerId: string, sdp: string) =>
  portalRequest(`${base(token)}/webrtc`, jsonBody("POST", { offer_id: offerId, sdp }));
