import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { SETTING_KEYS, getSetting } from "@/lib/settings/app-settings";
import {
  buildShiftReportMessage,
  normalizeWaPhone,
} from "@/lib/pos/receipt-wa";

/** Baca daftar penerima dari settings — JSON array, disaring & dinormalisasi.
 *  (Tidak di-export: file route Next hanya boleh meng-export handler HTTP.) */
async function readShiftReportRecipients(): Promise<string[]> {
  const raw = await getSetting(SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .map((value) => normalizeWaPhone(String(value)))
          .filter((value): value is string => Boolean(value))
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * POST /api/pos/shifts/[id]/send-report — kirim laporan tutup kasir via WA
 * ke daftar penerima di Settings (bisa lebih dari satu nomor).
 *
 * Dipicu UI setelah kasir mencetak laporan (keputusan owner: print dulu,
 * lalu WA menyusul otomatis). Angka dimuat dari baris pos_shifts yang sudah
 * ditulis endpoint close — bukan dari payload klien.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id: shiftId } = await params;
    const db = createPgClient();

    const { data: shift } = await db
      .from("pos_shifts")
      .select(
        `id, shift_number, status, opened_at, closed_at, opening_cash,
         closing_cash, expected_cash, total_orders, total_sales, cashier_id`
      )
      .eq("id", shiftId)
      .single();

    if (!shift) {
      return NextResponse.json(
        { success: false, error: "Shift tidak ditemukan" },
        { status: 404 }
      );
    }
    if (shift.status !== "closed") {
      return NextResponse.json(
        { success: false, error: "Laporan hanya untuk shift yang sudah ditutup" },
        { status: 400 }
      );
    }

    const recipients = await readShiftReportRecipients();
    if (recipients.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Belum ada nomor penerima laporan tutup kasir — isi dulu di Settings → Notifikasi WA",
        },
        { status: 400 }
      );
    }

    const [outlet, kasir] = await Promise.all([
      queryOne<{ name: string }>(
        "SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1"
      ),
      queryOne<{ full_name: string }>(
        "SELECT full_name FROM configuration.users WHERE id = $1",
        [shift.cashier_id]
      ),
    ]);

    const expectedCash = Number(shift.expected_cash) || 0;
    const closingCash = Number(shift.closing_cash) || 0;
    const message = buildShiftReportMessage({
      outletName: outlet?.name ?? "Kasir",
      shiftNumber: String(shift.shift_number ?? shiftId),
      cashierName: kasir?.full_name ?? "-",
      openedAt: String(shift.opened_at),
      closedAt: String(shift.closed_at ?? new Date().toISOString()),
      totalOrders: Number(shift.total_orders) || 0,
      totalSales: Number(shift.total_sales) || 0,
      openingCash: Number(shift.opening_cash) || 0,
      expectedCash,
      closingCash,
      variance: closingCash - expectedCash,
    });

    // Kirim berurutan (bukan Promise.all): gateway memberi jeda antar pesan,
    // dan laporan ke 3 nomor tidak butuh paralelisme — butuh sampai semua.
    const hasil: Array<{ phone: string; success: boolean; reason?: string }> = [];
    for (const phone of recipients) {
      const result = await sendWhatsAppText(
        { target: phone, message },
        { messageType: "notification", sentByUserId: sessionUserId }
      );
      hasil.push({ phone, success: result.success, reason: result.reason });
    }

    const terkirim = hasil.filter((h) => h.success).length;
    return NextResponse.json({
      success: terkirim > 0,
      data: { terkirim, total: recipients.length, rincian: hasil },
      ...(terkirim === 0 ? { error: "Semua pengiriman gagal — cek gateway WA" } : {}),
    });
  } catch (error) {
    console.error("[pos:shift:send-report] gagal:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim laporan" },
      { status: 500 }
    );
  }
}
