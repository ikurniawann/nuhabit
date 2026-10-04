import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadAnnouncementFeed } from "@/lib/hris/announcements-repo";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/announcements/feed — pengumuman tayang yang menyasar karyawan
 * login (global atau departemennya) + penanda sudah dibaca.
 */
export const GET = apiHandler(async () => {
  const actor = await requireWorkforceActor();
  // akun tak tertaut karyawan → tidak ada feed personal
  if (!actor.employeeId) return NextResponse.json({ data: [], unread: 0 });
  const { rows, unread } = await loadAnnouncementFeed(actor.employeeId);
  return NextResponse.json({ data: rows, unread });
}, "hris/announcements/feed GET");
