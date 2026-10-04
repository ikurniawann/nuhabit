import { jsonBody, portalRequest } from "@/lib/recruitment/portal-client";
import type { OfferPortalData, OfferRespondAction } from "./types";

const base = (token: string) => `/api/offer/session/${token}`;

export const fetchOffer = (token: string) =>
  portalRequest<{ data: { offer: OfferPortalData } }>(base(token)).then((r) => r.data.offer);

export const respondOffer = (token: string, action: OfferRespondAction, note?: string) =>
  portalRequest(`${base(token)}/respond`, jsonBody("POST", { action, note: note || undefined }));
