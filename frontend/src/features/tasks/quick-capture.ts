import { addDays } from "@/lib/dates";
import type { CreateTaskPayload, TaskPriority, TaskRecurrence } from "./types";

/**
 * Tangkap cepat: satu baris teks jadi task untuk diri sendiri. Kata di
 * akhir kalimat yang dikenali dibuang dari judul: "besok", "lusa", "hari
 * ini", nama hari ("jumat"), "setiap hari|minggu|bulan", dan tanda "!"
 * (tinggi) atau "!!" (mendesak). Contoh: "Kirim laporan stok besok !!".
 */

const DAY_NAMES = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];

/** Hari-dalam-minggu (0 = Minggu) dari YYYY-MM-DD tanpa pergeseran zona. */
function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Tanggal hari bernama berikutnya setelah hari ini (minimal besok). */
export function nextWeekday(today: string, weekday: number): string {
  const diff = (weekday - weekdayOf(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

export interface QuickCapture {
  title: string;
  due_date: string;
  recurrence: TaskRecurrence;
  priority?: TaskPriority;
}

export function parseQuickCapture(text: string, today: string): QuickCapture | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let dueDate = today;
  let priority: TaskPriority | undefined;
  let recurrence: TaskRecurrence = "once";

  // Baca dari belakang sampai bertemu kata yang bukan penanda.
  for (;;) {
    const last = words[words.length - 1]?.toLowerCase();
    if (!last || words.length === 1) break;
    const prev = words[words.length - 2]?.toLowerCase();
    if (last === "!!") {
      priority = "urgent";
      words.pop();
    } else if (last === "!") {
      priority = "high";
      words.pop();
    } else if (last === "besok") {
      dueDate = addDays(today, 1);
      words.pop();
    } else if (last === "lusa") {
      dueDate = addDays(today, 2);
      words.pop();
    } else if (last === "ini" && prev === "hari" && words.length > 2) {
      dueDate = today;
      words.splice(-2, 2);
    } else if (prev === "setiap" && words.length > 2 && (last === "hari" || last === "minggu" || last === "bulan")) {
      recurrence = last === "hari" ? "daily" : last === "minggu" ? "weekly" : "monthly";
      words.splice(-2, 2);
    } else if (DAY_NAMES.includes(last)) {
      dueDate = nextWeekday(today, DAY_NAMES.indexOf(last));
      words.pop();
    } else {
      break;
    }
  }
  const title = words.join(" ").trim();
  if (!title) return null;
  return { title, due_date: dueDate, recurrence, ...(priority ? { priority } : {}) };
}

/** Hari ISO (1 = Senin … 7 = Minggu) dan tanggal (maks 28) dari YYYY-MM-DD. */
export function scheduleFor(recurrence: TaskRecurrence, dueDate: string): Pick<CreateTaskPayload, "weekly_day" | "monthly_day" | "due_date"> {
  const iso = weekdayOf(dueDate) || 7;
  const day = Math.min(Number(dueDate.slice(8, 10)), 28);
  switch (recurrence) {
    case "weekly":
      return { weekly_day: iso, monthly_day: null, due_date: null };
    case "monthly":
      return { weekly_day: null, monthly_day: day, due_date: null };
    case "daily":
      return { weekly_day: null, monthly_day: null, due_date: null };
    default:
      return { weekly_day: null, monthly_day: null, due_date: dueDate };
  }
}

/** Payload POST dari hasil tangkap cepat, untuk diri sendiri. */
export function quickCapturePayload(q: QuickCapture, assigneeEmployeeId: string | null, departmentId?: string | null): CreateTaskPayload {
  return {
    title: q.title,
    recurrence: q.recurrence,
    ...scheduleFor(q.recurrence, q.due_date),
    ...(q.priority ? { priority: q.priority } : {}),
    assignee_employee_id: assigneeEmployeeId,
    ...(departmentId ? { department_id: departmentId } : {}),
    subtasks: [],
  };
}
