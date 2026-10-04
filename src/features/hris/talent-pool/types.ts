export type { CandidateRow as TalentPoolCandidate } from "../candidates/types";

export interface SendCandidateNotificationPayload {
  candidate_id: string;
  channel: string;
  message: string;
}
