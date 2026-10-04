import { loadLibrary } from "@/lib/gym/training-server";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — pustaka latihan aktif (dengan video teknik) + aturan substitusi. */
export const GET = withMemberSession("Gagal memuat pustaka latihan", async () => memberJson(await loadLibrary()));
