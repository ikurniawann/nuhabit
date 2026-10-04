import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getPosSession } from "@/lib/api/auth";
import { todayInJakarta } from "@/lib/ticketing/booking";

// EPIC-028 Fase D — lookup Season Pass utk benefit diskon member di POS.
// Cashier scan QR access_token / pass_code / UID gelang → kembalikan diskon
// member bila pass AKTIF & dalam masa berlaku. Match kode unik global; POS
// hanya boleh dipakai user login (getPosSession).

const HEX64 = /^[0-9a-f]{64}$/i;

interface PassRow {
  pass_code: string;
  holder_name: string;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  member_discount_percent: string;
  product_name: string;
}

export async function GET(request: NextRequest) {
  const userId = await getPosSession();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const raw = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { success: false, error: "Kode pass kosong" },
      { status: 400 }
    );
  }

  try {
    let where: string;
    let key: string;
    if (HEX64.test(raw)) {
      where = "sp.access_token = $1";
      key = raw.toLowerCase();
    } else if (/^SP-/i.test(raw)) {
      where = "sp.pass_code = $1";
      key = raw.toUpperCase();
    } else {
      where = "sp.band_uid = $1";
      key = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    }

    const rows = await query<PassRow>(
      `SELECT sp.pass_code, sp.holder_name, sp.status,
              sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
              pc.member_discount_percent, tp.name AS product_name
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
       WHERE ${where} LIMIT 1`,
      [key]
    );
    const pass = rows[0];
    if (!pass) {
      return NextResponse.json({
        success: true,
        data: { found: false, reason: "Pass tidak ditemukan" },
      });
    }

    const today = todayInJakarta();
    if (pass.status !== "active") {
      return NextResponse.json({
        success: true,
        data: { found: false, reason: `Pass ${pass.status}`, pass_code: pass.pass_code },
      });
    }
    if (
      (pass.valid_from && today < pass.valid_from) ||
      (pass.valid_until && today > pass.valid_until)
    ) {
      return NextResponse.json({
        success: true,
        data: {
          found: false,
          reason: "Pass di luar masa berlaku",
          pass_code: pass.pass_code,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        found: true,
        pass_code: pass.pass_code,
        holder_name: pass.holder_name,
        product_name: pass.product_name,
        discount_percent: Number(pass.member_discount_percent),
        valid_until: pass.valid_until,
      },
    });
  } catch (err) {
    console.error("[pos] pass lookup error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa pass" },
      { status: 500 }
    );
  }
}
