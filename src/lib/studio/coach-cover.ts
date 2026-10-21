/**
 * Pengganti coach saat cuti (EPIC-067 T-067-A4). Logika murni — query ada di
 * coach-cover-server.ts. Alur: coach yang cuti meminta pengganti per sesi →
 * pengganti menerima/menolak sebelum batas waktu → Program Director bisa
 * menunjuk langsung atau membatalkan kelas → cuti baru bisa disetujui bila
 * semua sesi tertangani.
 */

export type CoverStatus = "open" | "requested" | "accepted" | "assigned" | "cancel" | "void";

export const COVER_STATUS_LABEL: Record<CoverStatus, string> = {
  open: "Butuh pengganti",
  requested: "Menunggu jawaban",
  accepted: "Pengganti menerima",
  assigned: "Ditunjuk Program Director",
  cancel: "Kelas akan dibatalkan",
  void: "Tidak berlaku",
};

/** Status yang sudah "tertangani" — syarat cuti coach boleh disetujui. */
export function isCoverResolved(status: CoverStatus): boolean {
  return status === "accepted" || status === "assigned" || status === "cancel";
}

/** Baris yang masih menghalangi persetujuan cuti. */
export function coverBlockers<T extends { status: CoverStatus }>(covers: T[]): T[] {
  return covers.filter((c) => c.status !== "void" && !isCoverResolved(c.status));
}

/** Coach yang cuti hanya boleh meminta pengganti untuk sesi yang belum ditangani PD. */
export function canRequestSubstitute(status: CoverStatus): boolean {
  return status === "open";
}

/** Program Director boleh menunjuk / membatalkan selama baris belum void (termasuk menimpa jawaban). */
export function canDirectorDecide(status: CoverStatus): boolean {
  return status !== "void";
}

export const DEFAULT_SUBSTITUTE_RESPONSE_HOURS = 24;
export const MAX_SUBSTITUTE_RESPONSE_HOURS = 72;

/**
 * Batas jawaban pengganti: N jam dari sekarang, tetapi tidak melewati 1 jam
 * sebelum sesi mulai (supaya PD masih sempat menunjuk). Bila sesi sudah kurang
 * dari 1 jam lagi, batasnya = sekarang + 15 menit.
 */
export function substituteRespondBy(now: Date, hours: number, sessionStart: Date): Date {
  const byHours = new Date(now.getTime() + hours * 3_600_000);
  const beforeSession = new Date(sessionStart.getTime() - 3_600_000);
  const latest = beforeSession > now ? beforeSession : new Date(now.getTime() + 15 * 60_000);
  return byHours < latest ? byHours : latest;
}

/** Mulai sesi (WIB) sebagai Date. */
export function sessionStartAt(sessionDate: string, startTime: string): Date {
  return new Date(`${sessionDate}T${startTime.slice(0, 5)}:00+07:00`);
}

export interface SubstituteCandidate {
  coach_id: string;
  name: string;
  /** Bentrok dengan sesi lain (atau permintaan pengganti lain) di jam itu. */
  clash: boolean;
  /** Cuti disetujui / time-off di tanggal sesi. */
  on_leave: boolean;
  /** Pernah/terdaftar mengajar program ini. Wajib untuk Personal Training. */
  teaches_program: boolean;
  /** Jumlah sesi minggu itu (ISO week) — beban mengajar. */
  week_load: number;
}

/**
 * Saran pengganti: buang yang bentrok, sedang cuti, atau (untuk Personal
 * Training) tidak membawakan program itu; urutkan yang membawakan program
 * dulu, lalu beban minggu itu paling ringan, lalu nama.
 */
export function rankSubstitutes(candidates: SubstituteCandidate[], programKind: string): SubstituteCandidate[] {
  return candidates
    .filter((c) => !c.clash && !c.on_leave && (programKind !== "pt" || c.teaches_program))
    .sort(
      (a, b) =>
        Number(b.teaches_program) - Number(a.teaches_program) || a.week_load - b.week_load || a.name.localeCompare(b.name, "id")
    );
}

// ── Pesan WA (staf; tanpa jam tenang) ──────────────────────────────────────

const tanggalJam = (sessionDate: string, startTime: string) =>
  `${new Date(`${sessionDate}T00:00:00+07:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  })} ${startTime.slice(0, 5)}`;

const jamBatas = (d: Date) =>
  d.toLocaleString("id-ID", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export interface CoverWaSession {
  program_name: string;
  session_date: string;
  start_time: string;
}

export function substituteRequestMessage(input: {
  substituteName: string;
  requesterName: string;
  session: CoverWaSession;
  respondBy: Date;
  portalUrl: string;
}): string {
  return [
    `NüHabit — Permintaan menggantikan`,
    `Halo ${input.substituteName}, ${input.requesterName} cuti dan meminta Anda menggantikan:`,
    `${input.session.program_name} · ${tanggalJam(input.session.session_date, input.session.start_time)}`,
    "",
    `Mohon jawab di Coach Portal sebelum ${jamBatas(input.respondBy)}:`,
    input.portalUrl,
  ].join("\n");
}

export function substituteAssignedMessage(input: { substituteName: string; requesterName: string; session: CoverWaSession; portalUrl: string }): string {
  return [
    `NüHabit — Anda ditunjuk sebagai pengganti`,
    `Halo ${input.substituteName}, Program Director menunjuk Anda menggantikan ${input.requesterName}:`,
    `${input.session.program_name} · ${tanggalJam(input.session.session_date, input.session.start_time)}`,
    "",
    `Jadwal berlaku setelah cuti disetujui. Detail di Coach Portal: ${input.portalUrl}`,
  ].join("\n");
}

export function substituteDeclinedMessage(input: { requesterName: string; substituteName: string; session: CoverWaSession; portalUrl: string }): string {
  return [
    `NüHabit — Permintaan pengganti ditolak`,
    `Halo ${input.requesterName}, ${input.substituteName} tidak bisa menggantikan ${input.session.program_name} · ${tanggalJam(input.session.session_date, input.session.start_time)}.`,
    `Pilih pengganti lain di Coach Portal: ${input.portalUrl}`,
  ].join("\n");
}

export function approverNewLeaveMessage(input: {
  approverName: string;
  coachName: string;
  leaveLabel: string;
  range: string;
  sessions: number;
  shortNotice: boolean;
  backofficeUrl: string;
}): string {
  return [
    `NüHabit — ${input.shortNotice ? "CUTI MENDADAK coach" : "Cuti coach menunggu persetujuan"}`,
    `Kepada: ${input.approverName}`,
    `Coach : ${input.coachName}`,
    `Cuti  : ${input.leaveLabel}, ${input.range}`,
    input.sessions > 0 ? `Sesi terdampak: ${input.sessions} (perlu pengganti)` : "Tidak ada sesi terdampak",
    "",
    `Tinjau di: ${input.backofficeUrl}`,
  ].join("\n");
}
