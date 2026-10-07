-- =============================================================================
-- Reset data purchasing & production lama sebelum penerapan business scope
-- (company/branch). Sesuai keputusan: data lama dihapus, lalu diselaraskan ulang
-- dengan skema baru (re-seed dilakukan terpisah).
--
-- TRUNCATE ... CASCADE akan ikut mengosongkan tabel anak (items/details) dan
-- baris lain yang ber-FK ke tabel ini (mis. riwayat pergerakan dari GRN/produksi).
-- Hanya tabel yang benar-benar ada yang diproses (cek to_regclass).
-- =============================================================================

DO $$
DECLARE
    targets text[] := ARRAY[
        -- Master purchasing
        'purchasing.suppliers',
        'purchasing.vendors',
        'purchasing.vendor_documents',
        'purchasing.vendor_payments',
        'purchasing.supplier_price_lists',
        'purchasing.cogs_additional_costs',
        -- Transaksi purchasing
        'purchasing.purchase_requests',
        'purchasing.pr_items',
        'purchasing.purchase_orders',
        'purchasing.purchase_order_items',
        'purchasing.purchase_order_payment_terms',
        'purchasing.deliveries',
        'purchasing.grn',
        'purchasing.grn_items',
        'purchasing.purchase_returns',
        'purchasing.purchase_return_items',
        -- Produksi (manufacturing) — dipakai dari modul purchasing
        'manufacturing.production_orders',
        'manufacturing.production_order_materials',
        'manufacturing.production_batches'
    ];
    existing text[] := ARRAY[]::text[];
    t text;
BEGIN
    FOREACH t IN ARRAY targets LOOP
        IF to_regclass(t) IS NOT NULL THEN
            existing := array_append(existing, t);
        END IF;
    END LOOP;

    IF array_length(existing, 1) IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || array_to_string(existing, ', ') || ' RESTART IDENTITY CASCADE';
    END IF;
END $$;
