import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  normalizeDesktopPreferences,
} from "@/lib/desktop/preferences";

/**
 * Preferensi desktop per pengguna (wallpaper, widget, suara, periode).
 * Dipakai supaya tampilan ikut akun, bukan menempel di satu perangkat.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const db = createPgClient();
    const { data, error } = await db
      .from("user_desktop_prefs")
      .select("prefs")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      success: true,
      data: data?.prefs ? normalizeDesktopPreferences(data.prefs) : null,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/preferences] GET gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat preferensi" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const body = await request.json().catch(() => null);
    // Dinormalkan dulu: klien tidak boleh menitipkan key sembarangan ke jsonb.
    const prefs = normalizeDesktopPreferences(body ?? DEFAULT_DESKTOP_PREFERENCES);
    const db = createPgClient();
    const { error } = await db
      .from("user_desktop_prefs")
      .upsert({ user_id: user.id, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    return NextResponse.json({ success: true, data: prefs });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/preferences] PUT gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan preferensi" }, { status: 500 });
  }
}
