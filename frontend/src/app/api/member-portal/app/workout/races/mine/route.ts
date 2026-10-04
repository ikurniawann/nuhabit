import { memberRaceOverview } from "@/lib/gym/races-server";
import { countFullSimulations } from "@/lib/member-app/workout-server";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — race milik member (tanpa yang batal) + kesiapan 28 hari + jumlah simulasi penuh yang selesai. */
export const GET = withMemberSession("Gagal memuat race saya", async (customerId) => {
  const [overview, simulationCount] = await Promise.all([memberRaceOverview(customerId), countFullSimulations(customerId)]);
  return memberJson({
    my_races: overview.my_races.filter((race) => race.status !== "cancelled"),
    readiness: overview.readiness,
    simulation_count: simulationCount,
  });
});
