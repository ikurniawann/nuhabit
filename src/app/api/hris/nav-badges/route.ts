import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  buildNavBadges,
  isEssModule,
  markEssModuleSeen,
  type EssModule,
} from "@/lib/hris/nav-badges";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { readJson } from "@/lib/hris/workforce-route";

/** GET: jumlah antrean persetujuan (HR) & pembaruan pengajuan (ESS). */
export const GET = apiHandler(async () => {
  const actor = await getWorkforceActor();
  if (!actor) return NextResponse.json({ badges: {} });
  try {
    return NextResponse.json({ badges: await buildNavBadges(actor) });
  } catch (error) {
    // Badge bersifat hiasan: kegagalannya tidak boleh merusak navigasi.
    console.error("[nav-badges] gagal membangun badge:", error);
    return NextResponse.json({ badges: {} });
  }
}, "hris/nav-badges.GET");

const seenSchema = z.object({ module: z.custom<EssModule>(isEssModule) });

/** POST { module }: tandai satu modul ESS sudah dilihat. */
export const POST = apiHandler(async (request: NextRequest) => {
  const actor = await getWorkforceActor();
  if (!actor?.employeeId) throw ApiError.forbidden("Karyawan tidak ditemukan");
  const { module } = await readJson(request, seenSchema, "Modul tidak valid");
  await markEssModuleSeen(actor.employeeId, module);
  return NextResponse.json({ success: true });
}, "hris/nav-badges.POST");
