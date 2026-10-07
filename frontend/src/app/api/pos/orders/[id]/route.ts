import { NextRequest, NextResponse } from 'next/server';
import { resolveOrderItemSkus } from '@/lib/pos/order-item-sku';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { restoreMerchandiseStockForOrder } from '@/lib/pos/merchandise-stock';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidNfcUid, normalizeNfcUid } from '@/lib/ticketing/server';
import { chargeFnbOrderToTab } from '@/lib/ticketing/tab-server';
import {
  redeemGiftCardForPosOrder,
  refundGiftCardForPosOrder,
} from '@/lib/giftcard/giftcard-server';
import { ensureQueueNumber } from '@/lib/pos/queue-number';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
import { isFocPaymentMethod, resolvePaymentCatalogStamp } from '@/lib/pos/payment-methods';
import { approveWithSupervisorPin, supervisorPinRejection } from '@/lib/pos/supervisor-pin-server';
import { notifyCompTransaction } from '@/lib/wa/comp-notification';
import { sanitizeXenditRef } from '@/lib/pos/xendit-ids';
import { assertQrisSaleMaySettle } from '@/lib/pos/qris-settle-guard';
import { formatRupiah } from "@/lib/format";

type OrderPatchBody = {
  status?: string;
  payment_status?: string;
  /** EPIC-043 — 'owner_comp': open bill diselesaikan gratis dgn PIN supervisor. */
  comp_type?: string;
  supervisor_pin?: string;
  payment_method?: string;
  amount_paid?: number | string;
  ark_coins_used?: number | string;
  notes?: string;
  changed_by?: string;
  status_notes?: string;
  /** UID gelang ticketing — wajib saat bayar open bill via 'nfc_tab' */
  nfc_tab_uid?: string;
  /** Kode gift card — wajib saat bayar open bill via 'gift_card' (EPIC-034) */
  gift_card_code?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// PATCH /api/pos/orders/:id - Update order status and payment
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Endpoint pemindah uang — sesi WAJIB tervalidasi penuh (middleware hanya
  // cek keberadaan cookie, bukan keabsahan token).
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { id: orderId } = await params;
    const body = (await request.json()) as OrderPatchBody;
    const { status, payment_status, payment_method, amount_paid, ark_coins_used, notes } = body;

    // Convert to numbers
    const numericAmountPaid = Number(amount_paid) || 0;
    const numericArkUsed = Number(ark_coins_used) || 0;

    const updateData: Record<string, string | number | null> = {};
    if (status && status !== 'completed') updateData.status = status;
    if (payment_status) updateData.payment_status = payment_status;
    if (payment_method) updateData.payment_method = payment_method;
    if (amount_paid !== undefined) updateData.amount_paid = numericAmountPaid;
    if (ark_coins_used !== undefined) updateData.ark_coins_used = numericArkUsed;
    if (notes) updateData.notes = notes;
    const xenditQrId = sanitizeXenditRef(body.xendit_qr_id);
    const xenditExternalId = sanitizeXenditRef(body.xendit_external_id);
    if (xenditQrId) updateData.xendit_qr_id = xenditQrId;
    if (xenditExternalId) updateData.xendit_external_id = xenditExternalId;
    const catalog = resolvePaymentCatalogStamp({
      code: body.payment_method_code,
      name: body.payment_method_name,
    });
    if (catalog.payment_method_code) updateData.payment_method_code = catalog.payment_method_code;
    if (catalog.payment_method_name) updateData.payment_method_name = catalog.payment_method_name;

    // Payment no longer drives kitchen status. Client may still send
    // status=completed when paying; treat it as paid only.
    if (status === 'completed' || payment_status === 'paid') {
      updateData.payment_status = 'paid';
    }

    const { data: existing, error: fetchErr } = await db
      .from('pos_orders')
      .select('customer_id, payment_status, payment_method, subtotal, total_amount, order_number, company_id, branch_id, queue_number, status, checkout_id, xendit_qr_id, xendit_external_id')
      .eq('id', orderId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    // EPIC-043: Owner Comp — open bill diselesaikan GRATIS dengan persetujuan
    // PIN supervisor (padanan digital tanda tangan di struk). Seluruh order
    // digratiskan: diskon = subtotal, total & dibayar 0, penyetuju tercatat.
    let ownerComp: { supervisorId: string; supervisorName: string } | null = null;
    let ownerCompFamily: { checkoutId: string; siblingIds: string[] } | null = null;
    if (String(body.comp_type || '') === 'owner_comp') {
      if (payment_status !== 'paid') {
        return NextResponse.json(
          { success: false, error: 'owner_comp hanya berlaku saat pelunasan open bill' },
          { status: 400 }
        );
      }
      if (existing.payment_status === 'paid') {
        return NextResponse.json(
          { success: false, error: 'Bill sudah dibayar — tidak bisa diubah jadi komplimen' },
          { status: 400 }
        );
      }
      const pin = String(body.supervisor_pin || '').trim();
      if (!pin) {
        return NextResponse.json(
          { success: false, error: 'Owner Comp membutuhkan PIN supervisor' },
          { status: 400 }
        );
      }
      const { findSupervisorByPin } = await import('@/lib/pos/supervisor-pin');
      const { data: supervisorRows } = await db
        .from('users')
        .select('id, full_name, role, pos_pin')
        .eq('role', 'pos_supervisor');
      const supervisor = await findSupervisorByPin(supervisorRows ?? [], pin);
      if (!supervisor) {
        return NextResponse.json(
          { success: false, error: 'PIN supervisor tidak valid' },
          { status: 403 }
        );
      }
      ownerComp = {
        supervisorId: supervisor.id,
        supervisorName: supervisor.full_name || 'Supervisor',
      };
      const gross = Number(existing.subtotal) || Number(existing.total_amount) || 0;
      updateData.discount_amount = gross;
      updateData.discount_reason = 'Owner Comp';
      updateData.total_amount = 0;
      updateData.amount_paid = 0;
      updateData.change_amount = 0;
      updateData.comp_type = 'owner_comp';
      updateData.comp_approved_by = ownerComp.supervisorId;
      updateData.comp_approved_name = ownerComp.supervisorName;

      // Checkout gabungan (CHK): SELURUH anak-order digratiskan — bukan
      // hanya order yang diklik (laporan owner 2026-08-24: sebelumnya hanya
      // satu anak yang ter-comp). Saudara-saudaranya + baris checkout
      // dibereskan setelah update utama sukses (lihat blok compFamily).
      if ((existing as { checkout_id?: string | null }).checkout_id) {
        const checkoutId = String((existing as { checkout_id?: string | null }).checkout_id);
        const { data: siblings } = await db
          .from('pos_orders')
          .select('id, subtotal, payment_status, status')
          .eq('checkout_id', checkoutId)
          .neq('id', orderId);
        ownerCompFamily = {
          checkoutId,
          siblingIds: ((siblings ?? []) as Array<{
            id: string;
            payment_status?: string | null;
            status?: string | null;
          }>)
            .filter(
              (row) =>
                row.payment_status !== 'paid' &&
                !['cancelled', 'voided', 'merged'].includes(String(row.status || ''))
            )
            .map((row) => row.id),
        };
      }
    }

    // 1 pembayaran = 1 metode (EPIC-011): ARK Coin tidak boleh dicampur metode
    // lain, dan kalau metodenya ARK Coin maka harus menutup seluruh total.
    const effectiveMethod = payment_method ?? existing.payment_method ?? null;
    const settlingQris =
      effectiveMethod === 'qris' &&
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    if (settlingQris) {
      const qrisId = xenditQrId || sanitizeXenditRef(existing.xendit_qr_id);
      const qrisExternalId = xenditExternalId || sanitizeXenditRef(existing.xendit_external_id);
      let qrisAlreadyUsed = false;
      if (qrisId || qrisExternalId) {
        let usedQuery = db
          .from('pos_orders')
          .select('id')
          .eq('payment_status', 'paid')
          .neq('id', orderId)
          .limit(1);
        usedQuery = qrisId
          ? usedQuery.eq('xendit_qr_id', qrisId)
          : usedQuery.eq('xendit_external_id', qrisExternalId);
        const { data: usedRow } = await usedQuery.maybeSingle();
        qrisAlreadyUsed = Boolean(usedRow);
      }
      const qrisGate = assertQrisSaleMaySettle({
        paymentMethod: 'qris',
        xenditQrId: qrisId,
        xenditExternalId: qrisExternalId,
        alreadyUsedByPaidOrder: qrisAlreadyUsed,
      });
      if (!qrisGate.ok) {
        return NextResponse.json({ success: false, error: qrisGate.message }, { status: 400 });
      }
    }
    const orderTotal = Number(existing.total_amount) || 0;
    if (numericArkUsed > 0 && effectiveMethod !== 'ark_coin') {
      return NextResponse.json(
        { success: false, error: 'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran' },
        { status: 400 }
      );
    }
    if (effectiveMethod === 'ark_coin' && ark_coins_used !== undefined && numericArkUsed < orderTotal) {
      return NextResponse.json(
        { success: false, error: 'Pembayaran ARK Coin harus menutup seluruh total order' },
        { status: 400 }
      );
    }

    // Insiden 2026-08-23 (POS-20260823-0132/0138): keranjang layar kasir bisa
    // menyimpang dari bill tersimpan setelah open bill — QRIS ditagih dari
    // total layar lalu order ditandai lunas dengan nominal yang tidak cocok.
    // Guard: nominal pelunasan HARUS cocok dengan total bill tersimpan —
    // tunai boleh lebih (kembalian), non-tunai wajib sama persis. ARK/NFC/
    // gift card punya validasi khususnya sendiri di atas/di bawah.
    const settlingNow =
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    const methodHandlesOwnAmount = ['ark_coin', 'nfc_tab', 'gift_card'].includes(
      String(effectiveMethod || '')
    );
    // Metode FOC (Free of Charge) — keputusan owner 2026-08-24: pelunasan
    // dengan metode FOC wajib disetujui PIN supervisor. Pengakuannya sama
    // seperti Owner Comp: pendapatan 0 — diskon 100% dari gross, total &
    // dibayar 0, penyetuju tercatat di comp_approved_by/name (migrasi 015).
    let focComp = false;
    if (
      settlingNow &&
      !ownerComp &&
      isFocPaymentMethod(body.payment_method_code, body.payment_method_name)
    ) {
      // Keputusan owner 2026-08-24: FOC WAJIB ber-customer/member.
      if (!existing.customer_id) {
        return NextResponse.json(
          { success: false, error: 'Metode FOC membutuhkan customer/member — pasangkan customer ke bill dulu' },
          { status: 400 }
        );
      }
      const pin = String(body.supervisor_pin || '').trim();
      if (!pin) {
        return NextResponse.json(
          { success: false, error: 'Metode FOC membutuhkan PIN supervisor' },
          { status: 400 }
        );
      }
      const approval = await approveWithSupervisorPin({ callerId: sessionUserId, pin });
      if (!approval.ok) return supervisorPinRejection(approval);
      const approver = approval.supervisor;
      focComp = true;
      const gross = Number(existing.subtotal) || Number(existing.total_amount) || 0;
      updateData.discount_amount = gross;
      updateData.discount_reason = 'FOC';
      updateData.total_amount = 0;
      updateData.amount_paid = 0;
      updateData.change_amount = 0;
      updateData.comp_type = 'foc_comp';
      updateData.comp_approved_by = approver.id;
      updateData.comp_approved_name = approver.name;
    }

    // ownerComp/focComp: total baru saja di-nol-kan di updateData — guard
    // nominal membandingkan ke total LAMA sehingga wajib dilewati utk komplimen.
    if (settlingNow && !methodHandlesOwnAmount && !ownerComp && !focComp && amount_paid !== undefined) {
      const fmt = formatRupiah;
      if (numericAmountPaid + numericArkUsed < orderTotal - 0.5) {
        return NextResponse.json(
          {
            success: false,
            error: `Nominal pembayaran (${fmt(numericAmountPaid)}) kurang dari total bill ${existing.order_number || ''} (${fmt(orderTotal)})`,
          },
          { status: 400 }
        );
      }
      if (effectiveMethod !== 'cash' && Math.abs(numericAmountPaid - orderTotal) > 1) {
        return NextResponse.json(
          {
            success: false,
            error: `Nominal pembayaran (${fmt(numericAmountPaid)}) tidak sama dengan total bill tersimpan ${existing.order_number || ''} (${fmt(orderTotal)}) — muat ulang bill sebelum menagih`,
          },
          { status: 409 }
        );
      }
    }

    // NFC Tab (EPIC-023 Fase C): bayar open bill dengan memindahkan tagihan
    // ke tab visit — charge dulu (transaksional + idempotent per order),
    // baru order ditandai paid. Order yang sudah paid tidak di-charge ulang.
    const paysWithNfcTab =
      effectiveMethod === 'nfc_tab' &&
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    if (paysWithNfcTab) {
      const rate = checkRateLimit(`pos-nfc-tab:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan NFC Tab — tunggu sebentar' },
          { status: 429 }
        );
      }
      // Order partial sudah menerima uang sebagian — full total ke tab bakal
      // menagih dobel. Tolak; NFC Tab hanya untuk order yang belum terbayar.
      if (existing.payment_status === 'partial') {
        return NextResponse.json(
          { success: false, error: 'Order sudah terbayar sebagian — NFC Tab hanya untuk order yang belum terbayar' },
          { status: 400 }
        );
      }
      const nfcTabUid = String(body.nfc_tab_uid || '').trim();
      if (!nfcTabUid) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran NFC Tab membutuhkan tap gelang' },
          { status: 400 }
        );
      }
      if (!isValidNfcUid(normalizeNfcUid(nfcTabUid))) {
        return NextResponse.json(
          { success: false, error: 'UID gelang tidak valid — tap ulang gelang' },
          { status: 400 }
        );
      }
      if (numericArkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!existing.company_id || !existing.branch_id) {
        return NextResponse.json(
          { success: false, error: 'Order tanpa venue — tidak bisa charge ke tab' },
          { status: 400 }
        );
      }
      const tabResult = await chargeFnbOrderToTab({
        orderId,
        orderNumber: String(existing.order_number || orderId),
        amount: orderTotal,
        bandUid: nfcTabUid,
        companyId: existing.company_id,
        branchId: existing.branch_id,
        createdBy: sessionUserId,
        // paid ditandai atomik bersama charge — update generik di bawah
        // hanya mengulang nilai yang sama (aman bila gagal)
        markOrderPaid: true,
      });
      if (!tabResult.ok) {
        console.error(
          `[pos] nfc_tab charge rejected: order=${orderId} user=${sessionUserId} reason=${tabResult.reason}`
        );
        return NextResponse.json(
          { success: false, error: tabResult.reason },
          { status: tabResult.status === 402 ? 400 : tabResult.status }
        );
      }
      updateData.amount_paid = 0;
    }

    // EPIC-034 Fase C — bayar open bill dengan saldo gift card. Pola persis
    // NFC Tab di atas: debit ber-lock dulu (idempoten per order), baru order
    // ditandai lunas oleh update generik di bawah. Full-cover only —
    // saldo kurang ditolak, kasir minta metode lain.
    const paysWithGiftCard =
      effectiveMethod === 'gift_card' &&
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    if (paysWithGiftCard) {
      const rate = checkRateLimit(`pos-gift-card:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan gift card — tunggu sebentar' },
          { status: 429 }
        );
      }
      // Order partial sudah menerima uang sebagian — debit full total bakal
      // menagih dobel (alasan sama dgn NFC Tab).
      if (existing.payment_status === 'partial') {
        return NextResponse.json(
          { success: false, error: 'Order sudah terbayar sebagian — gift card hanya untuk order yang belum terbayar' },
          { status: 400 }
        );
      }
      const giftCardCode = String(body.gift_card_code || '').trim().toUpperCase();
      if (!giftCardCode) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran gift card membutuhkan kode kartu' },
          { status: 400 }
        );
      }
      if (numericArkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!existing.company_id || !existing.branch_id) {
        return NextResponse.json(
          { success: false, error: 'Order tanpa venue — gift card tidak bisa dipakai' },
          { status: 400 }
        );
      }
      const redeem = await redeemGiftCardForPosOrder({
        scope: { companyId: existing.company_id, branchId: existing.branch_id },
        code: giftCardCode,
        amount: orderTotal,
        orderId,
        createdBy: sessionUserId,
      });
      if (!redeem.ok) {
        console.error(
          `[pos] gift_card debit rejected: order=${orderId} user=${sessionUserId} reason=${redeem.reason}`
        );
        return NextResponse.json(
          { success: false, error: redeem.reason },
          { status: redeem.status }
        );
      }
      // Uang masuk lewat saldo kartu, bukan laci kasir
      updateData.amount_paid = 0;
    }

    // Deduct ARK coins atomically BEFORE marking the order paid. The RPC locks
    // the customer row and rejects an insufficient balance in-transaction, so a
    // failed/insufficient deduction never leaves a paid order without the
    // matching coin debit (previously the failure was swallowed).
    // EPIC-041: RPC mengembalikan saldo SETELAH potong — snapshot dibawa ke
    // respons utk baris "Sisa saldo" di struk (sama seperti jalur POST).
    //
    // Guard unpaid→paid saja (insiden 2026-09-04): PATCH ulang / double-submit
    // pada order yang sudah paid tidak boleh memanggil potong lagi. RPC juga
    // idempotent per order_id untuk type=payment.
    let arkBalanceAfter: number | null = null;
    const shouldDeductArk =
      numericArkUsed > 0 &&
      Boolean(existing.customer_id) &&
      existing.payment_status !== 'paid';
    if (shouldDeductArk) {
      const { data: coinBalance, error: coinError } = await db.rpc('update_ark_coin_balance', {
        p_customer_id: existing.customer_id,
        p_amount: -numericArkUsed,
        p_type: 'payment',
        p_order_id: orderId,
      });

      if (coinError) {
        const insufficient = coinError.message?.includes('Insufficient');
        return NextResponse.json(
          { success: false, error: insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin' },
          { status: 400 }
        );
      }

      arkBalanceAfter = Number(coinBalance);
      if (!Number.isFinite(arkBalanceAfter)) arkBalanceAfter = null;
    } else if (
      numericArkUsed > 0 &&
      existing.customer_id &&
      existing.payment_status === 'paid'
    ) {
      // Order sudah lunas — jangan potong; ambil saldo terkini utk struk bila ada.
      const { data: customerRow } = await db
        .from('pos_customers')
        .select('ark_coin_balance')
        .eq('id', existing.customer_id)
        .maybeSingle();
      const bal = Number(
        (customerRow as { ark_coin_balance?: number | string } | null)?.ark_coin_balance
      );
      arkBalanceAfter = Number.isFinite(bal) ? bal : null;
    }

    const { data, error } = await db
      .from('pos_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) {
      // EPIC-034 Fase C — saldo sudah terpotong tapi order gagal ditandai
      // lunas → kembalikan saldo tamu (kompensasi otomatis, idempoten).
      if (paysWithGiftCard) {
        await refundGiftCardForPosOrder({
          scope: { companyId: existing.company_id, branchId: existing.branch_id },
          orderId,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — order gagal ditandai lunas',
        }).catch((refundErr) =>
          console.error(`[pos] gift_card refund failed: order=${orderId}:`, refundErr)
        );
      }
      throw error;
    }

    // EPIC-043 (owner comp keluarga CHK): gratiskan juga seluruh saudara
    // anak-order + stempel checkout-nya. Dilakukan SETELAH update utama
    // sukses supaya kegagalan parsial tidak menyisakan order utama unpaid.
    if (ownerComp && ownerCompFamily) {
      const now = new Date().toISOString();
      for (const siblingId of ownerCompFamily.siblingIds) {
        const { data: sib } = await db
          .from('pos_orders')
          .select('subtotal, total_amount')
          .eq('id', siblingId)
          .maybeSingle();
        const sibGross =
          Number((sib as { subtotal?: number | string } | null)?.subtotal) ||
          Number((sib as { total_amount?: number | string } | null)?.total_amount) ||
          0;
        const { error: sibErr } = await db
          .from('pos_orders')
          .update({
            payment_status: 'paid',
            discount_amount: sibGross,
            discount_reason: 'Owner Comp',
            total_amount: 0,
            amount_paid: 0,
            change_amount: 0,
            comp_type: 'owner_comp',
            comp_approved_by: ownerComp.supervisorId,
            comp_approved_name: ownerComp.supervisorName,
            updated_at: now,
          })
          .eq('id', siblingId);
        if (sibErr) {
          console.error(`[pos] owner comp sibling gagal: ${siblingId}:`, sibErr.message);
        }
      }
      const { data: chkAgg } = await db
        .from('pos_orders')
        .select('subtotal')
        .eq('checkout_id', ownerCompFamily.checkoutId);
      const chkGross = ((chkAgg ?? []) as Array<{ subtotal?: number | string }>).reduce(
        (sum, row) => sum + (Number(row.subtotal) || 0),
        0
      );
      const { error: chkErr } = await db
        .from('pos_checkouts')
        .update({
          payment_status: 'paid',
          discount_amount: chkGross,
          total_amount: 0,
          amount_paid: 0,
          change_amount: 0,
          updated_at: now,
        })
        .eq('id', ownerCompFamily.checkoutId);
      if (chkErr) {
        console.error('[pos] owner comp checkout stamp gagal:', chkErr.message);
      }

      // Notifikasi WA owner (2026-08-24): satu pesan utk seluruh keluarga CHK.
      void notifyCompTransaction({
        compType: 'owner_comp',
        orderNumber: existing.order_number || orderId,
        orderCount: 1 + ownerCompFamily.siblingIds.length,
        grossIdr: chkGross,
        approvedName: ownerComp.supervisorName,
        customerId: existing.customer_id || null,
      });
    } else if (ownerComp) {
      // Owner Comp order tunggal → notifikasi WA owner.
      void notifyCompTransaction({
        compType: 'owner_comp',
        orderNumber: existing.order_number || orderId,
        grossIdr: Number(existing.subtotal) || Number(existing.total_amount) || 0,
        approvedName: ownerComp.supervisorName,
        customerId: existing.customer_id || null,
      });
    } else if (focComp) {
      // Metode FOC pada open bill → notifikasi WA owner.
      void notifyCompTransaction({
        compType: 'foc_comp',
        orderNumber: existing.order_number || orderId,
        grossIdr: Number(existing.subtotal) || Number(existing.total_amount) || 0,
        approvedName: String(updateData.comp_approved_name || '') || null,
        customerId: existing.customer_id || null,
      });
    }

    // EPIC-039 Fase A — order batal → kembalikan stok merchandise yang
    // sudah terpotong (idempoten via flag inventory_deducted per item).
    if (status === 'cancelled') {
      await restoreMerchandiseStockForOrder(db, orderId);
    }

    // Log status change
    if (status) {
      await db.from('pos_order_status_history').insert({
        order_id: orderId,
        from_status: null, // Should fetch previous status
        to_status: status,
        changed_by: body.changed_by || 'system',
        notes: body.status_notes
      });
    }

    const nowPaid =
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';

    if (nowPaid) {
      const queueNumber = await ensureQueueNumber(db, {
        id: orderId,
        queue_number: existing.queue_number as string | null,
        company_id: existing.company_id as string | null,
        branch_id: existing.branch_id as string | null,
      });
      if (queueNumber && data) {
        (data as { queue_number?: string | null }).queue_number = queueNumber;
      }
    }

    let accountingNote: string | null = null;
    if (nowPaid) {
      try {
        const { postPosSaleAccountingJournals } = await import('@/lib/pos/accounting-posting');
        const accounting = await postPosSaleAccountingJournals({
          db,
          orderId,
          userId: sessionUserId,
          paymentMethod: effectiveMethod,
        });
        accountingNote = accounting.note;
      } catch (err) {
        if (err instanceof AccountingPostError) {
          return NextResponse.json({ success: false, error: err.message }, { status: 500 });
        }
        throw err;
      }
    }

    let crmXp = null;
    if (data.customer_id && (status === 'completed' || payment_status === 'paid')) {
      // Statistik kunjungan/belanja untuk SEMUA metode; hanya sekali per order
      // (saat transisi ke paid), agar visit_count tidak dobel.
      if (nowPaid) {
        await syncPosCustomerOrderStats(db, data.customer_id, Number(data.total_amount || 0));
      }

      const { data: orderItems } = await db
        .from('pos_order_items')
        .select('product_id, quantity, unit_price, subtotal, total_amount')
        .eq('order_id', orderId);

      crmXp = await awardCrmXpForPosOrder(db, {
        orderId,
        customerId: data.customer_id,
        totalAmount: Number(data.total_amount || 0),
        items: orderItems || [],
        outletId: data.branch_id || null,
        paymentMethod: effectiveMethod,
      });
    }

    // EPIC-041 task 2: total XP member SETELAH award, utk baris "Total XP"
    // di struk (mirror jalur POST /api/pos/orders).
    let xpTotalAfter: number | null = null;
    if (data.customer_id && crmXp) {
      const { data: xpCustomer } = await db
        .from('pos_customers')
        .select('total_xp')
        .eq('id', data.customer_id)
        .maybeSingle();
      const totalXp = Number((xpCustomer as { total_xp?: unknown } | null)?.total_xp);
      xpTotalAfter = Number.isFinite(totalXp) ? totalXp : null;
    }

    return NextResponse.json({
      success: true,
      data,
      crm_xp: crmXp,
      ark_balance_after: arkBalanceAfter,
      xp_total_after: xpTotalAfter,
      message: accountingNote || undefined,
    });
  } catch (error: unknown) {
    console.error('Error updating order:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// GET /api/pos/orders/:id - Get single order details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = createPgClient();
    const { id: orderId } = await params;

    const { data, error } = await db
      .from('pos_orders')
      .select(`
        *,
        customer:pos_customers(name, phone, membership_tier, ark_coin_balance),
        items:pos_order_items(*)
      `)
      .eq('id', orderId)
      .single();

    if (error) throw error;

    // EPIC-041 task 4: resolve nama kasir & pelaku void — UI detail sudah
    // punya slot created_by_name/voided_by_name tapi tidak pernah terisi.
    // Lookup terpisah, bukan embed: cashier_id → hrd_employees, sedangkan
    // voided_by → users (kolomnya tidak berpola <alias>_id, embed shim tidak
    // bisa menebak join-nya).
    const detail = data as Record<string, unknown>;
    // EPIC-041 lanjutan (temuan owner: "Stall: —"): nama stall di-resolve dari
    // warehouse_id order. Satu order = satu stall by design (keranjang
    // lintas stall dipecah jadi beberapa order anak lewat checkout).
    if (detail?.warehouse_id) {
      const { data: stall } = await db
        .from('warehouses')
        .select('name, code')
        .eq('id', detail.warehouse_id)
        .maybeSingle();
      const stallRow = stall as { name?: string; code?: string } | null;
      detail.stall_name = stallRow?.name ?? null;
      detail.stall_code = stallRow?.code ?? null;
    }
    if (detail?.cashier_id) {
      const { data: cashier } = await db
        .from('employees')
        .select('full_name')
        .eq('id', detail.cashier_id)
        .maybeSingle();
      detail.created_by_name = (cashier as { full_name?: string } | null)?.full_name ?? null;
    }
    if (detail?.voided_by) {
      const { data: voider } = await db
        .from('users')
        .select('full_name')
        .eq('id', detail.voided_by)
        .maybeSingle();
      detail.voided_by_name = (voider as { full_name?: string } | null)?.full_name ?? null;
    }

    // SKU item: kolom snapshot sering berisi UUID (owner 2026-09-04) — pakai
    // kode produk master / sku POS untuk tampilan.
    if (Array.isArray(detail.items)) {
      detail.items = await resolveOrderItemSkus(
        db,
        detail.items as { product_id?: string | null; product_sku?: string | null }[]
      );
    }
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
