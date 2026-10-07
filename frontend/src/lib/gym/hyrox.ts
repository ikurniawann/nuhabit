/**
 * HYROX: pustaka latihan, generator workout, dan sesi workout aktif.
 * Port dari packages/domain/src/hyrox.ts (referensi NüHabit). Fungsi murni;
 * akses DB ada di training-server.ts.
 */

/* ── Pustaka latihan ─────────────────────────────────────────────────── */

export const EXERCISE_CATEGORIES = ["ERG", "SLED", "JUMP", "CARRY", "LUNGE", "THROW", "RUN", "CONDITIONING"] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export interface ExerciseSpec {
  distanceM: number | null;
  reps: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  /** Kode alat yang dibutuhkan (mis. "sled"). Kosong = tanpa alat. */
  equipment: string[];
  /** 1–8 bila latihan ini salah satu stasiun race HYROX. */
  hyroxStationOrder: number | null;
  difficulty: 1 | 2 | 3;
  defaultSpec: ExerciseSpec;
  videoUrl: string | null;
}

/** Substitusi sebagai data: pengganti, kemiripannya, dan konversi volumenya. */
export interface SubstitutionRule {
  originalExerciseId: string;
  alternativeExerciseId: string;
  /** 0–1: kemiripan otot + sistem energi. */
  similarity: number;
  /** Pengali jarak/repetisi pengganti (mis. 0.5 = separuh jarak). */
  volumeFactor: number;
  conversionNote: string;
}

/** Di bawah kemiripan ini sesi tidak lagi sebanding dengan race. */
export const RACE_COMPARABLE_SIMILARITY = 0.7;

export function listSubstitutes(
  exerciseId: string,
  substitutions: readonly SubstitutionRule[],
  exercises: readonly Exercise[]
): { exercise: Exercise; rule: SubstitutionRule }[] {
  return substitutions
    .filter((s) => s.originalExerciseId === exerciseId)
    .sort((a, b) => b.similarity - a.similarity)
    .flatMap((rule) => {
      const exercise = exercises.find((e) => e.id === rule.alternativeExerciseId);
      return exercise ? [{ exercise, rule }] : [];
    });
}

/**
 * Latihan yang tidak bisa dikerjakan dengan alat yang tersedia. `null` berarti
 * member tidak membatasi alat, jadi semuanya bisa.
 */
export function unavailableExerciseIds(
  exercises: readonly Exercise[],
  availableEquipment: readonly string[] | null
): string[] {
  if (availableEquipment === null) return [];
  const have = new Set(availableEquipment);
  return exercises.filter((e) => e.equipment.some((item) => !have.has(item))).map((e) => e.id);
}

/** Semua kode alat di pustaka, terurut, untuk pilihan di generator. */
export function equipmentCatalog(exercises: readonly Exercise[]): string[] {
  return [...new Set(exercises.flatMap((e) => e.equipment))].sort();
}

/* ── Generator ───────────────────────────────────────────────────────── */

export const WORKOUT_TYPES = ["FULL_SIMULATION", "COVERAGE", "QUICK", "PRACTICE"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const DIVISIONS = ["MEN_OPEN", "MEN_PRO", "WOMEN_OPEN", "WOMEN_PRO"] as const;
export type Division = (typeof DIVISIONS)[number];

export interface WorkoutBlock {
  order: number;
  kind: "RUN" | "STATION";
  exerciseId: string;
  exerciseName: string;
  /** Terisi bila blok ini pengganti stasiun yang dikecualikan/tidak ada alatnya. */
  originalExerciseId: string | null;
  originalExerciseName: string | null;
  /** Kemiripan pengganti; null bila tidak disubstitusi. */
  similarity: number | null;
  distanceM: number | null;
  reps: number | null;
  weightNote: string | null;
  targetSec: number;
  videoUrl: string | null;
}

/** Beban per divisi untuk stasiun berbeban (sesuai standar race). */
const WEIGHT_NOTES: Record<number, Record<Division, string>> = {
  2: { MEN_OPEN: "Sled 152 kg", MEN_PRO: "Sled 202 kg", WOMEN_OPEN: "Sled 102 kg", WOMEN_PRO: "Sled 152 kg" },
  3: { MEN_OPEN: "Sled 103 kg", MEN_PRO: "Sled 153 kg", WOMEN_OPEN: "Sled 78 kg", WOMEN_PRO: "Sled 103 kg" },
  6: { MEN_OPEN: "2×24 kg", MEN_PRO: "2×32 kg", WOMEN_OPEN: "2×16 kg", WOMEN_PRO: "2×24 kg" },
  7: { MEN_OPEN: "Sandbag 20 kg", MEN_PRO: "Sandbag 30 kg", WOMEN_OPEN: "Sandbag 10 kg", WOMEN_PRO: "Sandbag 20 kg" },
  8: { MEN_OPEN: "Bola 6 kg", MEN_PRO: "Bola 9 kg", WOMEN_OPEN: "Bola 4 kg", WOMEN_PRO: "Bola 6 kg" },
};

/** Repetisi wall ball berbeda per divisi. */
const WALL_BALL_REPS: Record<Division, number> = { MEN_OPEN: 100, MEN_PRO: 100, WOMEN_OPEN: 75, WOMEN_PRO: 100 };

/** Target detik satu stasiun penuh (tingkat Men Open). */
const STATION_TARGET_SEC: Record<number, number> = { 1: 240, 2: 180, 3: 210, 4: 270, 5: 250, 6: 120, 7: 260, 8: 300 };
const RUN_PACE_SEC_PER_KM: Record<Division, number> = { MEN_OPEN: 330, MEN_PRO: 300, WOMEN_OPEN: 360, WOMEN_PRO: 330 };
const DIVISION_FACTOR: Record<Division, number> = { MEN_OPEN: 1, MEN_PRO: 0.9, WOMEN_OPEN: 1.05, WOMEN_PRO: 0.95 };

/** Jarak lari per blok dan volume stasiun per tipe workout. */
const PLAN: Record<WorkoutType, { runM: number; volume: number }> = {
  FULL_SIMULATION: { runM: 1000, volume: 1 },
  COVERAGE: { runM: 600, volume: 1 },
  QUICK: { runM: 400, volume: 0.5 },
  PRACTICE: { runM: 200, volume: 0.5 },
};

export interface GenerateWorkoutArgs {
  type: WorkoutType;
  division: Division;
  /** COVERAGE/QUICK/PRACTICE: stasiun (1–8) pilihan; kosong → dipilih acak lewat `pick`. */
  stationOrders: readonly number[];
  excludedExerciseIds: readonly string[];
  /** Alat yang tersedia; null = semua. Latihan tanpa alatnya ikut dikecualikan. */
  availableEquipment: readonly string[] | null;
  exercises: readonly Exercise[];
  substitutions: readonly SubstitutionRule[];
  /** Pemilih deterministik: bilangan bulat di [0, n). */
  pick: (n: number) => number;
}

export interface GeneratedWorkout {
  blocks: WorkoutBlock[];
  totalTargetSec: number;
  /** Semua latihan yang dihindari (pilihan member + alat tidak ada). */
  excludedExerciseIds: string[];
  /** Latihan yang dihindari tapi tidak punya pengganti, jadi tetap muncul. */
  unresolvedExerciseIds: string[];
}

const scale = (value: number | null, factor: number) => (value ? Math.round(value * factor) : null);

export function generateWorkout(args: GenerateWorkoutArgs): GeneratedWorkout {
  const { division, exercises, substitutions } = args;
  const excluded = [...new Set([...args.excludedExerciseIds, ...unavailableExerciseIds(exercises, args.availableEquipment)])];
  const stations = exercises
    .filter((e) => e.hyroxStationOrder !== null)
    .sort((a, b) => a.hyroxStationOrder! - b.hyroxStationOrder!);
  const running = exercises.find((e) => e.category === "RUN") ?? null;
  const unresolved = new Set<string>();
  const blocks: WorkoutBlock[] = [];

  /** Latihan asli bila boleh; selain itu pengganti paling mirip yang boleh. */
  const resolve = (exercise: Exercise) => {
    if (!excluded.includes(exercise.id)) return { exercise, rule: null, original: null };
    const sub = listSubstitutes(exercise.id, substitutions, exercises).find((s) => !excluded.includes(s.exercise.id));
    if (!sub) {
      unresolved.add(exercise.id);
      return { exercise, rule: null, original: null };
    }
    return { exercise: sub.exercise, rule: sub.rule, original: exercise };
  };

  const push = (block: Omit<WorkoutBlock, "order">) => blocks.push({ order: blocks.length + 1, ...block });

  const pushRun = (distanceM: number) => {
    const targetSec = Math.round((RUN_PACE_SEC_PER_KM[division] * distanceM) / 1000);
    if (!running) {
      push({
        kind: "RUN", exerciseId: "run", exerciseName: "Lari", originalExerciseId: null, originalExerciseName: null,
        similarity: null, distanceM, reps: null, weightNote: null, targetSec, videoUrl: null,
      });
      return;
    }
    const { exercise, rule, original } = resolve(running);
    push({
      kind: "RUN",
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      originalExerciseId: original?.id ?? null,
      originalExerciseName: original?.name ?? null,
      similarity: rule?.similarity ?? null,
      distanceM: scale(distanceM, rule?.volumeFactor ?? 1),
      reps: null,
      weightNote: null,
      targetSec,
      videoUrl: exercise.videoUrl,
    });
  };

  const pushStation = (station: Exercise, volume: number) => {
    const { exercise, rule, original } = resolve(station);
    const stationOrder = station.hyroxStationOrder!;
    const baseReps = stationOrder === 8 ? WALL_BALL_REPS[division] : station.defaultSpec.reps;
    const factor = volume * (rule?.volumeFactor ?? 1);
    push({
      kind: "STATION",
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      originalExerciseId: original?.id ?? null,
      originalExerciseName: original?.name ?? null,
      similarity: rule?.similarity ?? null,
      distanceM: scale(station.defaultSpec.distanceM, factor),
      reps: scale(baseReps, factor),
      // Beban race hanya berlaku bila stasiunnya sendiri yang dikerjakan.
      weightNote: original ? null : (WEIGHT_NOTES[stationOrder]?.[division] ?? null),
      targetSec: Math.round((STATION_TARGET_SEC[stationOrder] ?? 240) * DIVISION_FACTOR[division] * volume),
      videoUrl: exercise.videoUrl,
    });
  };

  const chooseStations = (count: number): Exercise[] => {
    if (args.stationOrders.length > 0) {
      return stations.filter((s) => args.stationOrders.includes(s.hyroxStationOrder!));
    }
    const pool = [...stations];
    const chosen: Exercise[] = [];
    while (chosen.length < count && pool.length > 0) {
      const index = Math.min(Math.max(0, args.pick(pool.length)), pool.length - 1);
      chosen.push(pool.splice(index, 1)[0]!);
    }
    return chosen.sort((a, b) => a.hyroxStationOrder! - b.hyroxStationOrder!);
  };

  const plan = PLAN[args.type];
  if (args.type === "PRACTICE") {
    const target = chooseStations(1)[0];
    if (target) {
      for (let round = 0; round < 3; round++) {
        pushRun(plan.runM);
        pushStation(target, plan.volume);
      }
    }
  } else {
    const chosen = args.type === "FULL_SIMULATION" ? stations : chooseStations(4);
    for (const station of chosen) {
      pushRun(plan.runM);
      pushStation(station, plan.volume);
    }
  }

  return {
    blocks,
    totalTargetSec: blocks.reduce((sum, b) => sum + b.targetSec, 0),
    excludedExerciseIds: excluded,
    unresolvedExerciseIds: [...unresolved],
  };
}

/* ── Sesi workout aktif ──────────────────────────────────────────────── */

export const WORKOUT_SESSION_STATUSES = ["ready", "started", "paused", "completed", "partial"] as const;
export type WorkoutSessionStatus = (typeof WORKOUT_SESSION_STATUSES)[number];

export const WORKOUT_SESSION_TRANSITIONS: Readonly<Record<WorkoutSessionStatus, readonly WorkoutSessionStatus[]>> = {
  ready: ["started"],
  started: ["paused", "completed", "partial"],
  paused: ["started", "completed", "partial"],
  completed: [],
  partial: [],
};

export interface WorkoutBlockResult {
  order: number;
  durationSec: number;
}

export interface WorkoutSessionState {
  status: WorkoutSessionStatus;
  /** Urutan blok yang sedang dikerjakan (mulai 1). */
  currentBlock: number;
  startedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  blockResults: WorkoutBlockResult[];
  pauseCount: number;
  totalPauseSec: number;
}

export type SessionError =
  | { code: "invalid_transition"; from: WorkoutSessionStatus; to: WorkoutSessionStatus }
  | { code: "finished" }
  | { code: "invalid_block"; order: number }
  | { code: "invalid_duration" };

export type SessionResult = { ok: true; session: WorkoutSessionState } | { ok: false; error: SessionError };

const SESSION_ERROR_MESSAGES: Record<SessionError["code"], string> = {
  invalid_transition: "Status sesi tidak bisa diubah ke langkah itu.",
  finished: "Sesi ini sudah selesai.",
  invalid_block: "Blok itu tidak ada di workout ini.",
  invalid_duration: "Durasi blok tidak valid.",
};

export const sessionErrorMessage = (error: SessionError) => SESSION_ERROR_MESSAGES[error.code];

const fail = (error: SessionError): SessionResult => ({ ok: false, error });

function move(session: WorkoutSessionState, to: WorkoutSessionStatus): SessionError | null {
  return WORKOUT_SESSION_TRANSITIONS[session.status].includes(to)
    ? null
    : { code: "invalid_transition", from: session.status, to };
}

const secondsBetween = (fromIso: string, to: Date) => Math.max(0, Math.round((to.getTime() - new Date(fromIso).getTime()) / 1000));

export function newSession(now: Date): WorkoutSessionState {
  return {
    status: "started",
    currentBlock: 1,
    startedAt: now.toISOString(),
    endedAt: null,
    pausedAt: null,
    blockResults: [],
    pauseCount: 0,
    totalPauseSec: 0,
  };
}

/** Jeda: jam berhenti dan jumlah jeda dicatat. */
export function pauseSession(session: WorkoutSessionState, now: Date): SessionResult {
  const error = move(session, "paused");
  if (error) return fail(error);
  return { ok: true, session: { ...session, status: "paused", pausedAt: now.toISOString(), pauseCount: session.pauseCount + 1 } };
}

/** Tutup jeda yang sedang berjalan: lamanya ditambahkan ke total jeda. */
function closePause(session: WorkoutSessionState, now: Date): WorkoutSessionState {
  if (!session.pausedAt) return session;
  return { ...session, pausedAt: null, totalPauseSec: session.totalPauseSec + secondsBetween(session.pausedAt, now) };
}

export function resumeSession(session: WorkoutSessionState, now: Date): SessionResult {
  const error = move(session, "started");
  if (error) return fail(error);
  return { ok: true, session: { ...closePause(session, now), status: "started" } };
}

/**
 * Simpan durasi satu blok. Blok yang sama dicatat ulang menimpa (bukan
 * menambah), supaya persentase selesai tidak melewati 100.
 */
export function recordBlock(
  session: WorkoutSessionState,
  totalBlocks: number,
  result: WorkoutBlockResult
): SessionResult {
  if (session.status !== "started" && session.status !== "paused") return fail({ code: "finished" });
  if (!Number.isInteger(result.order) || result.order < 1 || result.order > totalBlocks) {
    return fail({ code: "invalid_block", order: result.order });
  }
  if (!Number.isFinite(result.durationSec) || result.durationSec < 0) return fail({ code: "invalid_duration" });
  const durationSec = Math.round(result.durationSec);
  const others = session.blockResults.filter((r) => r.order !== result.order);
  return {
    ok: true,
    session: {
      ...session,
      blockResults: [...others, { order: result.order, durationSec }].sort((a, b) => a.order - b.order),
      currentBlock: Math.max(session.currentBlock, Math.min(result.order + 1, totalBlocks + 1)),
    },
  };
}

/**
 * Selesaikan sesi. Hasil blok yang dikirim ikut disimpan. Sesi dianggap
 * `completed` hanya bila setiap blok punya hasil; sisanya `partial`, juga bila
 * member memilih berhenti di tengah.
 */
export function finishSession(
  session: WorkoutSessionState,
  totalBlocks: number,
  input: { blockResults?: readonly WorkoutBlockResult[]; partial?: boolean },
  now: Date
): SessionResult {
  if (session.status !== "started" && session.status !== "paused") return fail({ code: "finished" });
  let next = session;
  for (const result of input.blockResults ?? []) {
    const recorded = recordBlock(next, totalBlocks, result);
    if (!recorded.ok) return recorded;
    next = recorded.session;
  }
  const target: WorkoutSessionStatus =
    !input.partial && next.blockResults.length >= totalBlocks && totalBlocks > 0 ? "completed" : "partial";
  const error = move(next, target);
  if (error) return fail(error);
  return { ok: true, session: { ...closePause(next, now), status: target, endedAt: now.toISOString() } };
}

export function sessionActiveSec(session: Pick<WorkoutSessionState, "blockResults">): number {
  return session.blockResults.reduce((sum, r) => sum + r.durationSec, 0);
}

export function sessionCompletionPct(session: Pick<WorkoutSessionState, "blockResults">, totalBlocks: number): number {
  if (totalBlocks <= 0) return 0;
  return Math.min(100, Math.round((session.blockResults.length / totalBlocks) * 100));
}

/* ── Label ───────────────────────────────────────────────────────────── */

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  FULL_SIMULATION: "Simulasi penuh",
  COVERAGE: "Coverage 4 stasiun",
  QUICK: "Sesi cepat",
  PRACTICE: "Latihan 1 stasiun",
};

export const DIVISION_LABELS: Record<Division, string> = {
  MEN_OPEN: "Men Open",
  MEN_PRO: "Men Pro",
  WOMEN_OPEN: "Women Open",
  WOMEN_PRO: "Women Pro",
};

/** Detik → "1:05:09" atau "4:05". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1:30:00" atau "90:00" → detik; angka polos dibaca sebagai menit. Null bila tidak valid. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p.trim()))) return null;
  const [a = 0, b = 0, c = 0] = parts.map(Number);
  const sec = parts.length === 1 ? a * 60 : parts.length === 2 ? a * 60 + b : a * 3600 + b * 60 + c;
  return sec > 0 ? sec : null;
}

/* ── Ganti latihan satu blok ─────────────────────────────────────────── */

/**
 * Tukar latihan satu blok stasiun dengan pengganti pilihan member. Latihan
 * asli hanya dicatat pada penukaran pertama, jadi blok tetap menyebut stasiun
 * race yang digantikannya. Beban race tidak berlaku lagi untuk pengganti.
 */
export function replaceBlockExercise(block: WorkoutBlock, replacement: Exercise, rule: SubstitutionRule): WorkoutBlock {
  return {
    ...block,
    exerciseId: replacement.id,
    exerciseName: replacement.name,
    originalExerciseId: block.originalExerciseId ?? block.exerciseId,
    originalExerciseName: block.originalExerciseName ?? block.exerciseName,
    similarity: rule.similarity,
    weightNote: null,
    videoUrl: replacement.videoUrl,
  };
}
