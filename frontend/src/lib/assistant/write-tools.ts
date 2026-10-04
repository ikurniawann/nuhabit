import { query } from "@/lib/db";

/**
 * Tool tulis untuk Do (EPIC-017 Fase E).
 *
 * Prinsip yang tidak boleh dilanggar:
 * 1. **Model tidak pernah mengeksekusi.** Saat model memanggil tool tulis,
 *    server hanya MEMBUAT USULAN (baris `pending` di ai_assistant_actions).
 *    Eksekusi nyata hanya terjadi lewat endpoint konfirmasi setelah user
 *    menekan tombol di UI.
 * 2. **Whitelist sempit.** Hanya aksi yang terdaftar di sini yang bisa
 *    diusulkan; masing-masing punya validasi argumen sendiri.
 * 3. **Ter-audit.** Baris usulan mencatat siapa & kapan mengusulkan,
 *    memutuskan, dan mengeksekusi — jangan menulis lewat jalur lain.
 */

/** Usulan menunggu konfirmasi paling lama 10 menit. */
export const WRITE_ACTION_TTL_MS = 10 * 60 * 1000;

export function isActionExpired(createdAt: string | Date, now: number = Date.now()): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  return now - created > WRITE_ACTION_TTL_MS;
}

export type WriteActionStatus = "pending" | "confirmed" | "cancelled" | "expired" | "failed";

/** Bentuk ringkas yang dikirim ke UI (lewat meta pesan) untuk kartu konfirmasi. */
export interface PendingActionMeta {
  id: string;
  name: string;
  summary: string;
  status: WriteActionStatus;
  result_note?: string;
}

export interface WriteActionContext {
  userId: string;
  userName: string;
}

export type WriteActionProposal =
  | { ok: true; payload: Record<string, unknown>; summary: string }
  | { ok: false; error: string };

export interface AssistantWriteAction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Validasi argumen + resolusi referensi. TIDAK menulis apa pun. */
  propose: (args: Record<string, unknown>, ctx: WriteActionContext) => Promise<WriteActionProposal>;
  /** Eksekusi nyata. HANYA boleh dipanggil endpoint konfirmasi. */
  execute: (payload: Record<string, unknown>, ctx: WriteActionContext) => Promise<Record<string, unknown>>;
}

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Isi pengumuman dikirim model sebagai teks polos; di-escape sebelum jadi HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Teks polos → paragraf HTML sederhana (baris kosong = pemisah paragraf). */
export function plainTextToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br />")}</p>`)
    .join("\n");
}

const JUDUL_MIN = 3;
const JUDUL_MAX = 150;
const ISI_MIN = 10;
const ISI_MAX = 5000;
const TAG_MAX_COUNT = 5;
const TAG_MAX_LEN = 30;
const CATATAN_MIN = 3;
const CATATAN_MAX = 2000;

export type PengumumanPayload = { judul: string; isi: string; tags: string[] };

/** Validasi murni (tanpa DB) supaya mudah diuji. */
export function validatePengumumanArgs(
  args: Record<string, unknown>
): { ok: true; value: PengumumanPayload } | { ok: false; error: string } {
  const judul = argString(args, "judul");
  const isi = argString(args, "isi");
  if (judul.length < JUDUL_MIN || judul.length > JUDUL_MAX) {
    return { ok: false, error: `Judul harus ${JUDUL_MIN}-${JUDUL_MAX} karakter` };
  }
  if (isi.length < ISI_MIN || isi.length > ISI_MAX) {
    return { ok: false, error: `Isi pengumuman harus ${ISI_MIN}-${ISI_MAX} karakter` };
  }
  const rawTags = Array.isArray(args.tags) ? args.tags : [];
  const tags = rawTags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= TAG_MAX_LEN)
    .slice(0, TAG_MAX_COUNT);
  return { ok: true, value: { judul, isi, tags } };
}

export type CatatanKandidatArgs = { kandidat: string; catatan: string };

export function validateCatatanKandidatArgs(
  args: Record<string, unknown>
): { ok: true; value: CatatanKandidatArgs } | { ok: false; error: string } {
  const kandidat = argString(args, "kandidat");
  const catatan = argString(args, "catatan");
  if (kandidat.length < 2 || kandidat.length > 100) {
    return { ok: false, error: "Nama kandidat harus 2-100 karakter" };
  }
  if (catatan.length < CATATAN_MIN || catatan.length > CATATAN_MAX) {
    return { ok: false, error: `Catatan harus ${CATATAN_MIN}-${CATATAN_MAX} karakter` };
  }
  return { ok: true, value: { kandidat, catatan } };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const ASSISTANT_WRITE_ACTIONS: AssistantWriteAction[] = [
  {
    name: "usulkan_pengumuman_draft",
    description:
      "Siapkan DRAFT pengumuman perusahaan (tidak langsung terbit; user harus konfirmasi dulu, lalu HRD mempublikasikan dari CMS Pengumuman). Gunakan saat user minta dibuatkan pengumuman.",
    parameters: {
      type: "object",
      properties: {
        judul: { type: "string", description: "Judul pengumuman (3-150 karakter)" },
        isi: { type: "string", description: "Isi pengumuman dalam teks polos (10-5000 karakter)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Maksimal 5 tag pendek, opsional",
        },
      },
      required: ["judul", "isi"],
    },
    propose: async (args) => {
      const parsed = validatePengumumanArgs(args);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const { judul, isi, tags } = parsed.value;
      const tagInfo = tags.length ? `, tag: ${tags.join(", ")}` : "";
      return {
        ok: true,
        payload: { judul, isi, tags },
        summary:
          `Buat DRAFT pengumuman "${judul}" (${isi.length} karakter${tagInfo}). ` +
          "Draft tidak tampil ke karyawan sampai dipublikasikan lewat CMS Pengumuman.",
      };
    },
    execute: async (payload) => {
      const parsed = validatePengumumanArgs(payload);
      if (!parsed.ok) throw new Error(parsed.error);
      const { judul, isi, tags } = parsed.value;
      const [row] = await query(
        `INSERT INTO hris.announcements (title, body_html, tags, status)
         VALUES ($1, $2, $3, 'draft')
         RETURNING id, title`,
        [judul, plainTextToHtml(isi), tags]
      );
      return { announcement_id: row?.id, judul: row?.title, status: "draft" };
    },
  },
  {
    name: "usulkan_catatan_kandidat",
    description:
      "Siapkan catatan internal HR pada timeline seorang kandidat rekrutmen (butuh konfirmasi user sebelum tercatat). Gunakan saat user minta mencatat sesuatu tentang kandidat.",
    parameters: {
      type: "object",
      properties: {
        kandidat: { type: "string", description: "Nama kandidat (sebisa mungkin nama lengkap)" },
        catatan: { type: "string", description: "Isi catatan (3-2000 karakter)" },
      },
      required: ["kandidat", "catatan"],
    },
    propose: async (args) => {
      const parsed = validateCatatanKandidatArgs(args);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const { kandidat, catatan } = parsed.value;

      // Kandidat di-resolve SEKARANG supaya kartu konfirmasi menampilkan orang
      // yang pasti — bukan pencarian ulang saat eksekusi yang hasilnya bisa beda.
      const rows = await query(
        `SELECT id, full_name FROM recruitment.candidates
          WHERE full_name ILIKE $1
          ORDER BY created_at DESC
          LIMIT 6`,
        [`%${kandidat}%`]
      );
      if (rows.length === 0) {
        return { ok: false, error: `Tidak ada kandidat bernama "${kandidat}"` };
      }
      if (rows.length > 1) {
        const names = rows.map((r) => String(r.full_name)).join(", ");
        return {
          ok: false,
          error: `Lebih dari satu kandidat cocok (${names}). Minta user menyebut nama lengkap yang persis.`,
        };
      }
      return {
        ok: true,
        payload: {
          candidate_id: rows[0].id,
          candidate_name: rows[0].full_name,
          catatan,
        },
        summary: `Tambah catatan HR ke kandidat "${rows[0].full_name}": ${truncate(catatan, 140)}`,
      };
    },
    execute: async (payload, ctx) => {
      const candidateId = typeof payload.candidate_id === "string" ? payload.candidate_id : "";
      const catatan = typeof payload.catatan === "string" ? payload.catatan.trim() : "";
      if (!candidateId || catatan.length < CATATAN_MIN) {
        throw new Error("Payload catatan kandidat tidak valid");
      }
      const [row] = await query(
        `INSERT INTO recruitment.candidate_notes (candidate_id, content, created_by, created_by_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [candidateId, catatan, ctx.userId, ctx.userName]
      );
      return { note_id: row?.id, kandidat: payload.candidate_name };
    },
  },
];

export function isWriteActionName(name: string): boolean {
  return ASSISTANT_WRITE_ACTIONS.some((action) => action.name === name);
}

export function getWriteAction(name: string): AssistantWriteAction | undefined {
  return ASSISTANT_WRITE_ACTIONS.find((action) => action.name === name);
}

/** Bentuk function untuk OpenAI, digabung dengan tool baca di route. */
export function writeToolDefinitions() {
  return ASSISTANT_WRITE_ACTIONS.map((action) => ({
    type: "function" as const,
    function: {
      name: action.name,
      description: action.description,
      parameters: action.parameters,
    },
  }));
}

/**
 * Buat usulan aksi (baris pending) dari panggilan tool model. Tidak menulis
 * data bisnis apa pun — hanya baris usulan yang menunggu konfirmasi.
 */
export async function proposeWriteAction(
  name: string,
  args: Record<string, unknown>,
  ctx: WriteActionContext & { sessionId?: string }
): Promise<{ pending: PendingActionMeta } | { error: string }> {
  const action = getWriteAction(name);
  if (!action) return { error: `Aksi tidak dikenal: ${name}` };
  try {
    const proposal = await action.propose(args, ctx);
    if (!proposal.ok) return { error: proposal.error };
    const [row] = await query(
      `INSERT INTO ai_assistant_actions (session_id, user_id, action_name, payload, summary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [ctx.sessionId ?? null, ctx.userId, name, JSON.stringify(proposal.payload), proposal.summary]
    );
    return {
      pending: { id: String(row?.id), name, summary: proposal.summary, status: "pending" },
    };
  } catch (error) {
    console.error(`[do:write] usulan ${name} gagal:`, error);
    return { error: "Aksi gagal disiapkan" };
  }
}
