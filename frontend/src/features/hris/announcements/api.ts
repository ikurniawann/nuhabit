import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { Announcement, AnnouncementPayload, Department } from "./types";

export const fetchAnnouncements = () =>
  apiGet<{ data: Announcement[] }>("/api/hris/announcements").then((res) => res.data ?? []);

export const fetchDepartments = () =>
  apiGet<{ data: Department[] }>("/api/hris/departments").then((res) => res.data ?? []);

export const saveAnnouncement = (payload: AnnouncementPayload, id?: string) =>
  id
    ? apiPatch<{ message?: string }>(`/api/hris/announcements/${id}`, payload)
    : apiPost<{ message?: string }>("/api/hris/announcements", payload);

export const deleteAnnouncement = (id: string) => apiDelete(`/api/hris/announcements/${id}`);

/** Kirim gambar data URL, kembalikan path cover tersimpan. */
export const uploadAnnouncementCover = (image: string) =>
  apiPost<{ data: { path: string } }>("/api/hris/announcements/cover", { image }).then(
    (res) => res.data.path
  );
