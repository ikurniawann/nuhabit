export type OfferPortalStatus = "sent" | "negotiating" | "accepted" | "declined" | "expired";

export interface OfferPortalData {
  status: OfferPortalStatus;
  version: number;
  candidate_name: string;
  brand_name: string | null;
  position_title: string | null;
  base_salary: number;
  benefits: string[];
  start_date: string | null;
  response_note: string | null;
  responded_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
}

export type OfferRespondAction = "accept" | "negotiate" | "decline";
