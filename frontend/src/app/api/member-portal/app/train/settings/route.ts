import { getSettings, updateSettings } from "@/lib/gym/athlete-server";
import {
  athleteRoute,
  parseBody,
  settingsSchema,
} from "@/lib/gym/athlete-route";
import { memberJson } from "@/lib/member-portal/route";

/** GET — pengaturan atlet (satuan, pengingat, target mingguan, bahasa). */
export const GET = athleteRoute("Gagal memuat pengaturan", async (customerId) =>
  memberJson(await getSettings(customerId)),
);

/** PUT — patch parsial; weeklyGoalKm null menghapus target. */
export const PUT = athleteRoute(
  "Gagal menyimpan pengaturan",
  async (customerId, request: Request) => {
    const patch = await parseBody(
      request,
      settingsSchema,
      "Pengaturan tidak valid (target 1-1000 km)",
    );
    return memberJson(await updateSettings(customerId, patch));
  },
);
