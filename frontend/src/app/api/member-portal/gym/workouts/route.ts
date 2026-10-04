import { z } from "zod";
import { DIVISIONS, equipmentCatalog, WORKOUT_TYPES } from "@/lib/gym/hyrox";
import { generateMemberWorkout, loadLibrary, memberWorkoutHistory } from "@/lib/gym/training-server";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

const generateSchema = z.object({
  type: z.enum(WORKOUT_TYPES),
  division: z.enum(DIVISIONS),
  station_orders: z.array(z.number().int().min(1).max(8)).max(8).default([]),
  excluded_exercise_ids: z.array(z.string().uuid()).max(20).default([]),
  /** null/tidak dikirim = semua alat tersedia. */
  available_equipment: z.array(z.string().max(30)).max(30).nullable().default(null),
});

/** GET — bahan generator (stasiun + alat) dan riwayat workout member. */
export const GET = withMemberSession("Gagal memuat workout", async (customerId) => {
  const [{ exercises }, history] = await Promise.all([loadLibrary(), memberWorkoutHistory(customerId)]);
  return memberJson({
    stations: exercises
      .filter((e) => e.hyroxStationOrder !== null)
      .map((e) => ({ id: e.id, name: e.name, order: e.hyroxStationOrder, equipment: e.equipment })),
    exercises: exercises.map((e) => ({ id: e.id, name: e.name, equipment: e.equipment })),
    equipment: equipmentCatalog(exercises),
    workouts: history,
  });
});

/** POST — susun workout HYROX baru sesuai tipe, divisi, dan alat yang ada. */
export const POST = withMemberSession("Gagal menyusun workout", async (customerId, request: Request) => {
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return memberError("Pilihan workout tidak valid");
  const input = parsed.data;
  const outcome = await generateMemberWorkout(customerId, {
    type: input.type,
    division: input.division,
    stationOrders: input.station_orders,
    excludedExerciseIds: input.excluded_exercise_ids,
    availableEquipment: input.available_equipment,
  });
  if (!outcome.ok) return memberError(outcome.error, 409);
  return memberJson({ workout: outcome.workout, unresolved_exercise_ids: outcome.unresolvedExerciseIds });
});
