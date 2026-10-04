import { apiPost } from "@/lib/api-client";
import { fetchAllCandidates } from "../candidates/api";
import type { SendCandidateNotificationPayload } from "./types";

export const fetchTalentPool = (brandId?: string) =>
  fetchAllCandidates({ status: "talent_pool", brand_id: brandId === "all" ? undefined : brandId });

/** Lewat endpoint stage supaya perpindahan tercatat di jejak aktivitas. */
export const updateCandidateStatus = (id: string, status: string) =>
  apiPost(`/api/candidates/${id}/stage`, { status });

export const sendCandidateNotification = (body: SendCandidateNotificationPayload) =>
  apiPost<{ success?: boolean }>("/api/notifications/send", body);
