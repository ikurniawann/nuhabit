import { NextResponse } from "next/server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { studioRoute } from "@/lib/studio/server";

export async function GET() {
  return studioRoute("coach me", async () => {
    const { coach } = await requireCoach();
    return NextResponse.json({ success: true, data: { id: coach.id, full_name: coach.full_name, display_name: coach.display_name, level: coach.level, photo_url: coach.photo_url } });
  });
}
