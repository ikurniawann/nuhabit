import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, '').trim();
}

function normalizeNfcUid(value: unknown) {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw || null;
}

const CUSTOMER_SELECT =
  'id, name, phone, email, membership_tier, member_type, ark_coin_balance, total_xp, visit_count, is_active, nfc_uid, is_kol';

type PgClient = ReturnType<typeof createPgClient>;

// Diskon per tier dibaca dari konfigurasi crm_membership_tiers (EPIC-011),
// bukan hardcode. Gagal baca (schema crm belum ada) → tanpa diskon.
async function getTierDiscountMap(db: PgClient): Promise<Record<string, number>> {
  try {
    const { data, error } = await db
      .from('crm_membership_tiers')
      .select('code, discount_percent')
      .eq('is_active', true);
    if (error || !data) return {};
    return Object.fromEntries(
      (data as Array<{ code: string; discount_percent: unknown }>).map((tier) => [
        String(tier.code).toLowerCase(),
        Number(tier.discount_percent) || 0,
      ])
    );
  } catch {
    return {};
  }
}

function withTierDiscount<T extends { membership_tier?: string | null }>(
  customer: T,
  discounts: Record<string, number>
) {
  const tierCode = String(customer.membership_tier ?? '').toLowerCase();
  return { ...customer, discount_percent: discounts[tierCode] ?? 0 };
}

// GET /api/pos/customers - List customers with search
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const phone = searchParams.get('phone');
    const nfcUid = normalizeNfcUid(searchParams.get('nfc_uid'));
    const tier = searchParams.get('tier');

    let query = db
      .from('pos_customers')
      .select(CUSTOMER_SELECT)
      .eq('is_active', true)
      .order('name')
      .limit(phone || nfcUid ? 1 : 500);

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,nfc_uid.ilike.%${search}%`);
    }

    if (phone) {
      query = query.eq('phone', phone);
    }

    if (nfcUid) {
      query = query.eq('nfc_uid', nfcUid);
    }

    if (tier) {
      query = query.eq('membership_tier', tier);
    }

    const [{ data, error }, discounts] = await Promise.all([
      query,
      getTierDiscountMap(db),
    ]);

    if (error) throw error;

    const withDiscounts = (data ?? []).map((customer: { membership_tier?: string | null }) =>
      withTierDiscount(customer, discounts)
    );

    return NextResponse.json({ success: true, data: withDiscounts });
  } catch (error: unknown) {
    console.error('Error fetching customers:', error, getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: 'Gagal memuat data customer' },
      { status: 500 }
    );
  }
}

// POST /api/pos/customers - Create or update customer
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const body = await request.json();
    const {
      phone,
      name,
      email,
      membership_tier = 'regular',
      notes,
      enroll_member = false,
      nfc_uid,
    } = body;
    // EPIC-043: ceklis KOL dari dialog Add Customer kasir/top-up. Hanya
    // dipakai bila dikirim eksplisit — update tanpa field ini tidak
    // mengubah status KOL yang sudah ada.
    const isKol = typeof body.is_kol === 'boolean' ? body.is_kol : undefined;
    const normalizedPhone = normalizePhone(String(phone || ''));
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim();
    const normalizedNfcUid = normalizeNfcUid(nfc_uid);
    const tierCode = String(membership_tier || 'regular').trim().toLowerCase();

    // Validate required fields
    if (!normalizedPhone) {
      return NextResponse.json(
        { success: false, error: 'Nomor HP wajib diisi' },
        { status: 400 }
      );
    }

    if (normalizedNfcUid) {
      const { data: uidOwner } = await db
        .from('pos_customers')
        .select('id, phone')
        .eq('nfc_uid', normalizedNfcUid)
        .maybeSingle();

      if (uidOwner && uidOwner.phone !== normalizedPhone) {
        return NextResponse.json(
          { success: false, error: 'Card ID sudah terdaftar pada member lain' },
          { status: 409 }
        );
      }
    }

    // Check if customer exists by phone
    const { data: existingCustomer } = await db
      .from('pos_customers')
      .select('*')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    let savedCustomer;
    if (existingCustomer) {
      const { data, error } = await db
        .from('pos_customers')
        .update({
          name: normalizedName || existingCustomer.name,
          email: normalizedEmail || existingCustomer.email,
          membership_tier: tierCode,
          notes: notes || existingCustomer.notes,
          nfc_uid: normalizedNfcUid ?? existingCustomer.nfc_uid ?? null,
          // Penautan kartu NFC = upgrade jadi member kartu (EPIC-011)
          ...(normalizedNfcUid && existingCustomer.member_type !== 'card'
            ? { member_type: 'card', card_issued_at: new Date().toISOString() }
            : {}),
          ...(isKol !== undefined ? { is_kol: isKol } : {}),
        })
        .eq('id', existingCustomer.id)
        .select(CUSTOMER_SELECT)
        .single();

      if (error) throw error;
      savedCustomer = data;
    } else {
      const { data, error } = await db
        .from('pos_customers')
        .insert({
          phone: normalizedPhone,
          name: normalizedName || '',
          email: normalizedEmail || null,
          membership_tier: tierCode,
          notes: notes || null,
          nfc_uid: normalizedNfcUid,
          ...(normalizedNfcUid
            ? { member_type: 'card', card_issued_at: new Date().toISOString() }
            : {}),
          ...(isKol !== undefined ? { is_kol: isKol } : {}),
        })
        .select(CUSTOMER_SELECT)
        .single();

      if (error) throw error;
      savedCustomer = data;
    }

    if (enroll_member && savedCustomer?.id) {
      try {
        const { data: tier } = await db
          .from('crm_membership_tiers')
          .select('id')
          .eq('code', tierCode)
          .maybeSingle();

        let tierId = tier?.id || null;
        if (!tierId) {
          const { data: fallbackTier } = await db
            .from('crm_membership_tiers')
            .select('id')
            .eq('code', 'regular')
            .maybeSingle();
          tierId = fallbackTier?.id || null;
        }

        if (tierId) {
          await db
            .from('crm_member_profiles')
            .upsert(
              {
                customer_id: savedCustomer.id,
                tier_id: tierId,
                lifetime_xp: Number(savedCustomer.total_xp || 0),
                // XP lifetime append-only (EPIC-011): loyalty_score = lifetime XP
                loyalty_score: Number(savedCustomer.total_xp || 0),
                status: 'active',
                metadata: {
                  source: 'pos_customer_modal',
                  enrolled_by: sessionUserId,
                },
                last_activity_at: new Date().toISOString(),
              },
              { onConflict: 'customer_id' }
            );
        }
      } catch (crmError) {
        console.warn('CRM member enrollment skipped:', crmError);
      }
    }

    const discounts = await getTierDiscountMap(db);

    return NextResponse.json(
      {
        success: true,
        data: withTierDiscount(savedCustomer, discounts),
        message: existingCustomer ? 'Customer updated' : 'Customer created',
      },
      { status: existingCustomer ? 200 : 201 }
    );
  } catch (error: unknown) {
    console.error('Error saving customer:', error, getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: 'Gagal menyimpan customer' },
      { status: 500 }
    );
  }
}
