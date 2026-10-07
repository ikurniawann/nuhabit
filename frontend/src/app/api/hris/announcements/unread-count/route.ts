import { NextResponse } from "next/server";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { countUnreadAnnouncements } from "@/lib/hris/nav-badges";

/**
 * GET /api/hris/announcements/unread-count — badge sidebar: pengumuman tayang
 * yang menyasar karyawan & belum dibaca. Query tinggal di lib/hris/nav-badges
 * agar endpoint ini dan badge navigasi tidak menyimpang.
 *
 * Sengaja tanpa apiHandler: badge tidak boleh memunculkan galat, kegagalan
 * apa pun dibalas { unread: 0 }.
 */
export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor?.employeeId) return NextResponse.json({ unread: 0 });
    return NextResponse.json({ unread: await countUnreadAnnouncements(actor.employeeId) });
  } catch (error) {
    console.error("[announcements/unread-count] GET failed:", error);
    return NextResponse.json({ unread: 0 });
  }
}
