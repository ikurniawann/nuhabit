export type ActivityType = "telepon" | "wa" | "meeting" | "catatan";

export interface SalesActivity {
  id: string;
  lead_id: string | null;
  deal_id: string | null;
  activity_type: ActivityType;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  owner_user_id: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  // hasil join API
  owner_name: string | null;
  deal_title: string | null;
  org_name: string | null;
  pic_name: string | null;
  pic_phone: string | null;
}

export interface ActivityFilters {
  deal_id?: string;
  lead_id?: string;
  view?: "today";
}

export interface ActivityFormValues {
  activity_type: ActivityType;
  notes: string;
  due_at: string; // datetime-local, "" = tanpa jatuh tempo
  is_done: boolean;
}

export interface WaTemplate {
  id: string;
  name: string;
  body: string;
  is_active: boolean;
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  telepon: "Telepon",
  wa: "WhatsApp",
  meeting: "Meeting",
  catatan: "Catatan",
};

export const EMPTY_ACTIVITY_FORM: ActivityFormValues = {
  activity_type: "catatan",
  notes: "",
  due_at: "",
  is_done: false,
};

/** datetime-local (waktu lokal) → ISO string dengan offset zona server user. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isOverdue(activity: SalesActivity): boolean {
  if (!activity.due_at || activity.done_at) return false;
  return new Date(activity.due_at).getTime() < Date.now();
}
