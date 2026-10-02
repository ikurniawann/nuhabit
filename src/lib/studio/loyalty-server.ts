import type { PoolClient } from "pg";
import { ApiError } from "@/lib/api/auth";
import { longDate } from "@/lib/studio/jobs";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  consecutiveStreakWeeks,
  isFrozen,
  isOffpeak,
  isoWeekStart,
  leaderboardAlias,
  type MemberStatus,
  parseBenefits,
  resolveTier,
  ruleXp,
  type Tier,
  type TierBenefits,
} from "@/lib/studio/loyalty";

/**
 * Mesin XP NüHabit Progress (EPIC-066). Semua pemberian XP idempoten lewat
 * `crm_xp_ledger.idempotency_key` dan non-blocking bagi pemanggil (kegagalan
 * XP tidak boleh menggagalkan booking/penjualan).
 */

export interface StudioRule {
  id: string;
  code: string;
  name: string;
  source_type: string;
  xp_mode: string;
  xp_value: number;
  amount_step: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  metadata: Record<string, unknown>;
  priority: number;
}

export async function loadTiers(): Promise<Tier[]> {
  const rows = await query<{ id: string; code: string; name: string; rank: number; min_lifetime_xp: number; discount_percent: number; display_color: string | null; metadata: unknown }>(
    `SELECT id, code, name, rank, min_lifetime_xp, discount_percent::float8 AS discount_percent, display_color, metadata
     FROM crm.crm_membership_tiers WHERE is_active ORDER BY min_lifetime_xp`
  );
  return rows.map((r) => ({ ...r, benefits: parseBenefits(r.metadata) }));
}

export async function loadStudioRules(): Promise<StudioRule[]> {
  return query<StudioRule>(
    `SELECT id, code, name, source_type, xp_mode, xp_value::float8 AS xp_value, amount_step::float8 AS amount_step,
            is_active, starts_at, ends_at, metadata, priority
     FROM crm.crm_xp_rules WHERE source_channel = 'studio' ORDER BY priority, code`
  );
}

function ruleLive(r: StudioRule, now = Date.now()): boolean {
  if (!r.is_active) return false;
  if (r.starts_at && Date.parse(r.starts_at) > now) return false;
  if (r.ends_at && Date.parse(r.ends_at) < now) return false;
  return true;
}

/** Profil CRM member (dibuat bila belum ada, tier dasar). */
async function ensureProfile(client: PoolClient, customerId: string) {
  await client.query(
    `INSERT INTO crm.crm_member_profiles (customer_id, tier_id)
     SELECT $1, (SELECT id FROM crm.crm_membership_tiers WHERE is_active ORDER BY min_lifetime_xp LIMIT 1)
     ON CONFLICT (customer_id) DO NOTHING`,
    [customerId]
  );
  const { rows } = await client.query(
    `SELECT mp.id, mp.status, mp.xp_balance, COALESCE(c.total_xp, mp.lifetime_xp, 0)::int AS lifetime
     FROM crm.crm_member_profiles mp JOIN pos.pos_customers c ON c.id = mp.customer_id
     WHERE mp.customer_id = $1 FOR UPDATE OF mp`,
    [customerId]
  );
  return rows[0] as { id: string; status: MemberStatus; xp_balance: number; lifetime: number } | undefined;
}

export interface AwardInput {
  customerId: string;
  sourceType: string;
  idempotencyKey: string;
  referenceTable: string;
  referenceId: string;
  amount?: number;
  description: string;
  companyId?: string | null;
  branchId?: string | null;
}

/** Beri XP menurut aturan studio. Mengembalikan XP yang diberikan (0 = dilewati/duplikat). */
export async function awardStudioXp(input: AwardInput, rules?: StudioRule[], tiers?: Tier[]): Promise<number> {
  const rule = (rules ?? (await loadStudioRules())).find((r) => r.source_type === input.sourceType && ruleLive(r));
  if (!rule) return 0;
  const xp = ruleXp(rule, input.amount ?? 0);
  if (xp <= 0) return 0;
  const allTiers = tiers ?? (await loadTiers());

  return withTransaction(async (client) => {
    const dup = await client.query(`SELECT 1 FROM crm.crm_xp_ledger WHERE idempotency_key = $1`, [input.idempotencyKey]);
    if (dup.rowCount) return 0;
    const p = await ensureProfile(client, input.customerId);
    if (!p || isFrozen(p.status)) return 0;
    const lifetimeAfter = p.lifetime + xp;
    const balanceAfter = p.xp_balance + xp;
    const ins = await client.query(
      `INSERT INTO crm.crm_xp_ledger (member_id, customer_id, direction, source_channel, source_type, source_id, xp_delta,
         balance_before, balance_after, lifetime_before, lifetime_after, rule_id, reference_table, reference_id,
         idempotency_key, description, company_id, branch_id)
       VALUES ($1,$2,'earn','studio',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        p.id, input.customerId, input.sourceType, rule.code, xp, p.xp_balance, balanceAfter, p.lifetime, lifetimeAfter,
        rule.id, input.referenceTable, input.referenceId, input.idempotencyKey, input.description, input.companyId ?? null, input.branchId ?? null,
      ]
    );
    if (!ins.rowCount) return 0;
    const earned = resolveTier(allTiers, lifetimeAfter, p.status).earnedTier;
    await client.query(
      `UPDATE crm.crm_member_profiles SET lifetime_xp = $2, xp_balance = $3, last_activity_at = now(),
         tier_id = COALESCE($4, tier_id), updated_at = now() WHERE id = $1`,
      [p.id, lifetimeAfter, balanceAfter, earned?.id ?? null]
    );
    await client.query(
      `UPDATE pos.pos_customers SET total_xp = $2, membership_tier = COALESCE($3, membership_tier), updated_at = now() WHERE id = $1`,
      [input.customerId, lifetimeAfter, earned?.code ?? null]
    );
    return xp;
  });
}

const safe = async (label: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    console.error(`[loyalty] ${label} gagal (non-blocking):`, e);
  }
};

/** XP hadir (+ bonus jam sepi) untuk semua peserta hadir sebuah sesi yang diselesaikan. */
export async function awardSessionXp(sessionId: string): Promise<void> {
  await safe("XP sesi", async () => {
    const rows = await query<{ booking_id: string; customer_id: string; kind: "class" | "pt"; start_time: string; session_date: string; program: string; company_id: string; branch_id: string }>(
      `SELECT b.id AS booking_id, b.customer_id, p.kind, to_char(s.start_time,'HH24:MI') AS start_time, s.session_date::text AS session_date,
              p.name AS program, s.company_id, s.branch_id
       FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id JOIN studio.programs p ON p.id = s.program_id
       WHERE b.session_id = $1 AND b.status = 'attended'`,
      [sessionId]
    );
    if (rows.length === 0) return;
    const [rules, tiers] = await Promise.all([loadStudioRules(), loadTiers()]);
    const offpeak = rules.find((r) => r.source_type === "offpeak_attended");
    for (const r of rows) {
      const base = { customerId: r.customer_id, referenceTable: "studio.bookings", referenceId: r.booking_id, companyId: r.company_id, branchId: r.branch_id };
      await awardStudioXp(
        { ...base, sourceType: r.kind === "pt" ? "pt_attended" : "class_attended", idempotencyKey: `studio:attend:${r.booking_id}`, description: `Hadir ${r.program} · ${longDate(r.session_date)} ${r.start_time.replace(":", ".")}` },
        rules,
        tiers
      );
      if (r.kind === "class" && offpeak && isOffpeak(r.start_time, offpeak.metadata)) {
        await awardStudioXp({ ...base, sourceType: "offpeak_attended", idempotencyKey: `studio:offpeak:${r.booking_id}`, description: `Bonus jam sepi · ${r.program} ${r.start_time.replace(":", ".")}` }, rules, tiers);
      }
    }
  });
}

/**
 * Streak (dipanggil tutup hari): member dengan ≥ min sesi hadir di minggu ini
 * dapat bonus mingguan sekali; tiap kelipatan 4 minggu berturut-turut dapat bonus 4 minggu.
 */
export async function awardStreaks(venue: { companyId: string; branchId: string }, today: string): Promise<{ weekly: number; fourWeek: number }> {
  const out = { weekly: 0, fourWeek: 0 };
  const rules = await loadStudioRules();
  const weekly = rules.find((r) => r.source_type === "weekly_streak" && ruleLive(r));
  if (!weekly) return out;
  const minSessions = Math.max(1, Number(weekly.metadata?.min_sessions) || 3);
  const weekStart = isoWeekStart(today);
  const rows = await query<{ customer_id: string; dates: string[] }>(
    `SELECT b.customer_id, array_agg(s.session_date::text) AS dates
     FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
     WHERE b.branch_id = $1 AND b.status = 'attended' AND s.session_date BETWEEN ($2::date - 28) AND $3::date
     GROUP BY b.customer_id`,
    [venue.branchId, weekStart, today]
  );
  const tiers = await loadTiers();
  for (const r of rows) {
    const streak = consecutiveStreakWeeks(r.dates, weekStart, minSessions);
    if (streak < 1) continue;
    const base = { customerId: r.customer_id, referenceTable: "studio.weekly_streak", referenceId: weekStart, companyId: venue.companyId, branchId: venue.branchId };
    out.weekly += (await awardStudioXp({ ...base, sourceType: "weekly_streak", idempotencyKey: `studio:streak:${r.customer_id}:${weekStart}`, description: `Streak mingguan · minggu ${longDate(weekStart).split(", ")[1]} (≥${minSessions} sesi)` }, rules, tiers)) > 0 ? 1 : 0;
    if (streak % 4 === 0) {
      out.fourWeek += (await awardStudioXp({ ...base, sourceType: "streak_4w", idempotencyKey: `studio:streak4:${r.customer_id}:${weekStart}`, description: `Streak ${streak} minggu berturut-turut` }, rules, tiers)) > 0 ? 1 : 0;
    }
  }
  return out;
}

/** XP beli paket (per nominal) + bonus perpanjang bila paket lain masih berlaku. */
export async function awardPassPurchaseXp(passId: string): Promise<void> {
  await safe("XP beli paket", async () => {
    const p = await queryOne<{ id: string; customer_id: string; price_paid: number; channel: string; product_name: string; pass_code: string; company_id: string; branch_id: string; renewal: boolean }>(
      `SELECT mp.id, mp.customer_id, mp.price_paid::float8 AS price_paid, mp.channel, mp.product_name, mp.pass_code, mp.company_id, mp.branch_id,
              EXISTS (SELECT 1 FROM studio.member_passes o WHERE o.customer_id = mp.customer_id AND o.id <> mp.id
                        AND o.status IN ('active','exhausted') AND o.created_at < mp.created_at
                        AND o.valid_until >= (now() AT TIME ZONE 'Asia/Jakarta')::date) AS renewal
       FROM studio.member_passes mp WHERE mp.id = $1`,
      [passId]
    );
    if (!p || p.channel === "complimentary" || p.price_paid <= 0) return;
    const [rules, tiers] = await Promise.all([loadStudioRules(), loadTiers()]);
    const base = { customerId: p.customer_id, referenceTable: "studio.member_passes", referenceId: p.id, companyId: p.company_id, branchId: p.branch_id };
    await awardStudioXp({ ...base, sourceType: "pass_purchase", amount: p.price_paid, idempotencyKey: `studio:pass:${p.id}`, description: `Beli paket ${p.product_name}` }, rules, tiers);
    if (p.renewal) {
      await awardStudioXp({ ...base, sourceType: "early_renewal", idempotencyKey: `studio:renewal:${p.id}`, description: `Perpanjang sebelum paket habis (${p.pass_code})` }, rules, tiers);
    }
  });
}

// ── Status member & benefit ────────────────────────────────────────────────

export async function memberStatus(customerId: string): Promise<MemberStatus> {
  const row = await queryOne<{ status: MemberStatus }>(`SELECT status FROM crm.crm_member_profiles WHERE customer_id = $1`, [customerId]);
  return row?.status ?? "active";
}

/** Member banned tidak bisa booking (diblokir hanya kehilangan benefit & XP). */
export async function assertCanBook(customerId: string): Promise<void> {
  if ((await memberStatus(customerId)) === "banned") {
    throw ApiError.forbidden("Akun member ini dinonaktifkan. Silakan hubungi front desk.");
  }
}

export async function memberBenefits(customerId: string): Promise<TierBenefits> {
  const row = await queryOne<{ status: MemberStatus; lifetime: number }>(
    `SELECT COALESCE(mp.status, 'active') AS status, COALESCE(c.total_xp, 0)::int AS lifetime
     FROM pos.pos_customers c LEFT JOIN crm.crm_member_profiles mp ON mp.customer_id = c.id WHERE c.id = $1`,
    [customerId]
  );
  if (!row) return resolveTier([], 0, "active").benefits;
  return resolveTier(await loadTiers(), row.lifetime, row.status).benefits;
}

/** Ringkasan progres untuk Member App. */
export async function memberProgress(customerId: string) {
  const row = await queryOne<{ status: MemberStatus; lifetime: number; balance: number }>(
    `SELECT COALESCE(mp.status, 'active') AS status, COALESCE(c.total_xp, 0)::int AS lifetime, COALESCE(mp.xp_balance, 0)::int AS balance
     FROM pos.pos_customers c LEFT JOIN crm.crm_member_profiles mp ON mp.customer_id = c.id WHERE c.id = $1`,
    [customerId]
  );
  const tiers = await loadTiers();
  const t = resolveTier(tiers, row?.lifetime ?? 0, row?.status ?? "active");
  return { status: row?.status ?? "active", lifetime_xp: row?.lifetime ?? 0, xp_balance: row?.balance ?? 0, ...t, tiers };
}

/** Ubah status member (aktif / diblokir / banned) — staf. */
export async function setMemberStatus(customerId: string, status: "active" | "suspended" | "banned", reason: string | null, userId: string) {
  await withTransaction(async (client) => {
    const p = await ensureProfile(client, customerId);
    if (!p) throw ApiError.notFound("Member tidak ditemukan");
    await client.query(
      `UPDATE crm.crm_member_profiles SET status = $2, status_reason = $3, status_changed_at = now(), status_changed_by = $4, updated_at = now() WHERE id = $1`,
      [p.id, status, status === "active" ? null : reason, userId]
    );
  });
}

// ── Leaderboard & data backoffice ──────────────────────────────────────────

/**
 * Leaderboard bulanan: sesi hadir bulan ini (WIB), hanya member yang memilih
 * tampil dan berstatus aktif. Peringkat saya dihitung walau belum tampil.
 */
export async function leaderboard(branchId: string, customerId: string | null, limit = 20) {
  const rows = await query<{ customer_id: string; name: string | null; sessions: number; opted: boolean; tier_name: string | null; lifetime: number }>(
    `SELECT b.customer_id, c.name, COUNT(*)::int AS sessions, COALESCE(pr.leaderboard_opt_in, false) AS opted,
            t.name AS tier_name, COALESCE(c.total_xp, 0)::int AS lifetime
     FROM studio.bookings b
     JOIN studio.class_sessions s ON s.id = b.session_id
     JOIN pos.pos_customers c ON c.id = b.customer_id
     LEFT JOIN studio.member_prefs pr ON pr.customer_id = b.customer_id
     LEFT JOIN crm.crm_member_profiles mp ON mp.customer_id = b.customer_id
     LEFT JOIN crm.crm_membership_tiers t ON t.id = mp.tier_id
     WHERE b.branch_id = $1 AND b.status = 'attended'
       AND s.session_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta'))::date
       AND COALESCE(mp.status, 'active') NOT IN ('suspended', 'banned')
     GROUP BY b.customer_id, c.name, pr.leaderboard_opt_in, t.name, c.total_xp
     ORDER BY sessions DESC, lifetime DESC, c.name`,
    [branchId]
  );
  const visible = rows.filter((r) => r.opted);
  let rank = 0;
  let prev: number | null = null;
  const ranked = visible.map((r, i) => {
    if (r.sessions !== prev) rank = i + 1;
    prev = r.sessions;
    return { rank, alias: leaderboardAlias(r.name), sessions: r.sessions, tier_name: r.tier_name, me: r.customer_id === customerId };
  });
  const mine = customerId ? rows.find((r) => r.customer_id === customerId) : undefined;
  // Peringkat relatif terhadap yang tampil — sama dengan posisi di daftar bila saya ikut tampil.
  const myRank = mine ? visible.filter((r) => r.customer_id !== mine.customer_id && r.sessions > mine.sessions).length + 1 : null;
  return { entries: ranked.slice(0, limit), me: { opted_in: mine?.opted ?? false, sessions: mine?.sessions ?? 0, rank: myRank } };
}

/** Sinkronkan tier tersimpan semua member setelah ambang tier diubah. */
export async function resyncAllTiers(): Promise<number> {
  const res = await query<{ id: string }>(
    `WITH target AS (
       SELECT mp.id, c.id AS customer_id,
              (SELECT t.id FROM crm.crm_membership_tiers t WHERE t.is_active AND t.min_lifetime_xp <= COALESCE(c.total_xp, 0)
               ORDER BY t.min_lifetime_xp DESC LIMIT 1) AS tier_id
       FROM crm.crm_member_profiles mp JOIN pos.pos_customers c ON c.id = mp.customer_id
     )
     UPDATE crm.crm_member_profiles mp SET tier_id = target.tier_id, updated_at = now()
     FROM target WHERE target.id = mp.id AND target.tier_id IS NOT NULL AND mp.tier_id IS DISTINCT FROM target.tier_id
     RETURNING mp.id`
  );
  await query(
    `UPDATE pos.pos_customers c SET membership_tier = t.code, updated_at = now()
     FROM crm.crm_member_profiles mp JOIN crm.crm_membership_tiers t ON t.id = mp.tier_id
     WHERE mp.customer_id = c.id AND c.membership_tier IS DISTINCT FROM t.code`
  );
  return res.length;
}

/** Cari member + data loyalitas (tab Status member). q kosong = yang diblokir/banned. */
export async function searchLoyaltyMembers(q: string) {
  const term = q.trim();
  return query(
    `SELECT c.id, c.name, c.phone, COALESCE(c.total_xp, 0)::int AS lifetime_xp, COALESCE(mp.xp_balance, 0)::int AS xp_balance,
            COALESCE(mp.status, 'active') AS status, mp.status_reason, mp.status_changed_at, t.name AS tier_name
     FROM pos.pos_customers c
     LEFT JOIN crm.crm_member_profiles mp ON mp.customer_id = c.id
     LEFT JOIN crm.crm_membership_tiers t ON t.id = mp.tier_id
     WHERE ${term ? "(c.name ILIKE $1 OR regexp_replace(COALESCE(c.phone,''), '\\D', '', 'g') LIKE $1)" : "mp.status IN ('suspended', 'banned')"}
     ORDER BY c.name LIMIT 30`,
    term ? [`%${term.replace(/^0/, "")}%`] : []
  );
}
