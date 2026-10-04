import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { sniffImageMime } from "@/lib/storage-private";
import { deleteFile, uploadFile } from "@/lib/storage";
import {
  DESKTOP_WALLPAPER_BUCKET,
  DESKTOP_WALLPAPER_MAX_BYTES,
  DESKTOP_WALLPAPERS_SETTING_KEY,
  addDesktopWallpaper,
  normalizeWallpaperName,
  parseDesktopWallpapers,
  removeDesktopWallpaper,
  serializeDesktopWallpapers,
  type DesktopWallpaper,
} from "@/lib/desktop/wallpapers";

/**
 * Wallpaper desktop Arkiv OS.
 * - GET   : publik (desktop juga tampil untuk pengunjung belum login).
 * - POST  : unggah gambar — butuh hak menu Settings → Appearance.
 * - DELETE: hapus satu wallpaper (+ berkasnya) — hak yang sama.
 * Daftar disimpan di configuration.app_settings, berkas di bucket publik.
 */
export const dynamic = "force-dynamic";

async function loadItems(): Promise<DesktopWallpaper[]> {
  return parseDesktopWallpapers(await getSetting(DESKTOP_WALLPAPERS_SETTING_KEY));
}

export async function GET() {
  try {
    const items = await loadItems();
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error("[desktop/wallpapers] GET gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat wallpaper" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsAppearance);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ success: false, error: "Pilih file gambar dulu" }, { status: 400 });
    }
    if (file.size > DESKTOP_WALLPAPER_MAX_BYTES) {
      return NextResponse.json({ success: false, error: "Gambar maksimal 8 MB" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!sniffImageMime(buffer)) {
      return NextResponse.json({ success: false, error: "File harus gambar JPG/PNG/WebP" }, { status: 400 });
    }

    const items = await loadItems();
    const next: DesktopWallpaper = {
      id: `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: normalizeWallpaperName(form?.get("name")?.toString(), file.name),
      src: "",
      created_at: new Date().toISOString(),
      created_by: user.id,
    };
    // Cek batas dulu supaya tidak mengunggah berkas yang lalu ditolak.
    const guard = addDesktopWallpaper(items, next);
    if (!guard.ok) {
      return NextResponse.json({ success: false, error: guard.error }, { status: 400 });
    }

    const { url, error } = await uploadFile(DESKTOP_WALLPAPER_BUCKET, file);
    if (error || !url) {
      return NextResponse.json({ success: false, error: error || "Upload gagal" }, { status: 500 });
    }
    const saved = { ...next, src: url };
    await setSetting(
      DESKTOP_WALLPAPERS_SETTING_KEY,
      serializeDesktopWallpapers([saved, ...items])
    );
    return NextResponse.json({ success: true, data: saved });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/wallpapers] POST gagal:", error);
    return NextResponse.json({ success: false, error: "Upload gagal" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsAppearance);
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ success: false, error: "id wajib" }, { status: 400 });
    }
    const items = await loadItems();
    const { items: rest, removed } = removeDesktopWallpaper(items, id);
    if (!removed) {
      return NextResponse.json({ success: false, error: "Wallpaper tidak ditemukan" }, { status: 404 });
    }
    await setSetting(DESKTOP_WALLPAPERS_SETTING_KEY, serializeDesktopWallpapers(rest));
    // Berkas yatim tidak fatal — daftar sudah bersih; cukup dicatat.
    const { error } = await deleteFile(DESKTOP_WALLPAPER_BUCKET, removed.src);
    if (error) console.warn("[desktop/wallpapers] berkas tidak terhapus:", removed.src, error);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/wallpapers] DELETE gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal menghapus" }, { status: 500 });
  }
}
