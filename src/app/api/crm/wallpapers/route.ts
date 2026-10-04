import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import {
  catalogId,
  deleteWallpaper,
  listWallpapers,
  saveWallpaper,
  wallpaperSchema,
} from "@/lib/crm/collectibles-admin-server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

/** CRUD wallpaper collectible (EPIC-014 Task 5) — gerbang menu crm.settings. */

export const GET = apiHandler(async () => {
  await requireCrmUser("settings");
  return NextResponse.json({ success: true, data: await listWallpapers() });
}, "crm.wallpapers.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const payload = parseCrmInput(wallpaperSchema, await request.json());
  return NextResponse.json({ success: true, data: await saveWallpaper(payload) });
}, "crm.wallpapers.POST");

export const DELETE = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("settings");
  const message = await deleteWallpaper(catalogId(request.nextUrl.searchParams.get("id")));
  return NextResponse.json(message ? { success: true, message } : { success: true });
}, "crm.wallpapers.DELETE");
