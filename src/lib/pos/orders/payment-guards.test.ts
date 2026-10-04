import { describe, expect, it } from 'vitest';
import {
  guardBalancePayment,
  guardCompRequest,
  guardFocRequest,
  guardSettlement,
} from './payment-guards';

const VALID_UID = '04A1B2C3D4E5F6';

describe('guardBalancePayment', () => {
  const base = {
    paymentMethod: 'cash',
    nfcTabUid: '',
    giftCardCode: '',
    arkUsed: 0,
    venue: { companyId: 'c1', branchId: 'b1' },
    sellsGiftCard: false,
  };

  it('passes ordinary cash payments', () => {
    expect(guardBalancePayment(base)).toEqual({ ok: true });
  });

  it('requires a band tap for NFC Tab', () => {
    expect(guardBalancePayment({ ...base, paymentMethod: 'nfc_tab' })).toEqual({
      ok: false,
      status: 400,
      error: 'Pembayaran NFC Tab membutuhkan tap gelang',
    });
  });

  it('rejects an invalid band UID', () => {
    expect(guardBalancePayment({ ...base, paymentMethod: 'nfc_tab', nfcTabUid: 'zz' })).toEqual({
      ok: false,
      status: 400,
      error: 'UID gelang tidak valid — tap ulang gelang',
    });
  });

  it('rejects NFC Tab mixed with ARK Coin', () => {
    expect(
      guardBalancePayment({ ...base, paymentMethod: 'nfc_tab', nfcTabUid: VALID_UID, arkUsed: 1 })
    ).toEqual({
      ok: false,
      status: 400,
      error: 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode',
    });
  });

  it('accepts a valid NFC Tab payment', () => {
    expect(
      guardBalancePayment({ ...base, paymentMethod: 'nfc_tab', nfcTabUid: VALID_UID })
    ).toEqual({ ok: true });
  });

  it('checks the band before ARK mixing', () => {
    const result = guardBalancePayment({ ...base, paymentMethod: 'nfc_tab', arkUsed: 5 });
    expect(result).toMatchObject({ error: 'Pembayaran NFC Tab membutuhkan tap gelang' });
  });

  it('requires a gift card code', () => {
    expect(guardBalancePayment({ ...base, paymentMethod: 'gift_card' })).toEqual({
      ok: false,
      status: 400,
      error: 'Pembayaran gift card membutuhkan kode kartu',
    });
  });

  it('rejects gift card mixed with ARK Coin before the venue check', () => {
    expect(
      guardBalancePayment({
        ...base,
        paymentMethod: 'gift_card',
        giftCardCode: 'GC-1',
        arkUsed: 1,
        venue: { companyId: null, branchId: null },
      })
    ).toEqual({
      ok: false,
      status: 400,
      error: 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode',
    });
  });

  it('requires a configured venue for gift card payments', () => {
    expect(
      guardBalancePayment({
        ...base,
        paymentMethod: 'gift_card',
        giftCardCode: 'GC-1',
        venue: { companyId: 'c1', branchId: null },
      })
    ).toEqual({
      ok: false,
      status: 400,
      error: 'Venue belum dikonfigurasi — gift card tidak bisa dipakai',
    });
  });

  it.each(['gift_card', 'nfc_tab', 'ark_coin'])(
    'rejects buying a gift card with %s balance',
    (paymentMethod) => {
      expect(
        guardBalancePayment({
          ...base,
          paymentMethod,
          nfcTabUid: VALID_UID,
          giftCardCode: 'GC-1',
          sellsGiftCard: true,
        })
      ).toEqual({
        ok: false,
        status: 400,
        error: 'Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo',
      });
    }
  );

  it('lets cash buy a gift card', () => {
    expect(guardBalancePayment({ ...base, sellsGiftCard: true })).toEqual({ ok: true });
  });

  it('reports the payment-method error before the gift card sale error', () => {
    expect(
      guardBalancePayment({ ...base, paymentMethod: 'gift_card', sellsGiftCard: true })
    ).toMatchObject({ error: 'Pembayaran gift card membutuhkan kode kartu' });
  });
});

describe('guardFocRequest', () => {
  it('requires a customer first', () => {
    expect(guardFocRequest({ customerId: undefined, supervisorPin: '' })).toEqual({
      ok: false,
      status: 400,
      error: 'Metode FOC membutuhkan customer/member — pilih customer dulu',
    });
  });

  it('requires a supervisor PIN', () => {
    expect(guardFocRequest({ customerId: 'c', supervisorPin: '' })).toEqual({
      ok: false,
      status: 400,
      error: 'Metode FOC membutuhkan PIN supervisor',
    });
  });

  it('passes with customer and PIN', () => {
    expect(guardFocRequest({ customerId: 'c', supervisorPin: '1234' })).toEqual({ ok: true });
  });
});

describe('guardSettlement', () => {
  const base = {
    paymentMethod: 'cash',
    focApproved: false,
    paidAmount: 100000,
    arkUsed: 0,
    total: 100000,
    customerId: 'cust-1' as string | undefined,
  };

  it('passes an exact cash payment', () => {
    expect(guardSettlement(base)).toEqual({ ok: true });
  });

  it('rejects an insufficient payment', () => {
    expect(guardSettlement({ ...base, paidAmount: 99999 })).toEqual({
      ok: false,
      status: 400,
      error: 'Payment insufficient',
    });
  });

  it.each([
    ['nfc_tab', false],
    ['gift_card', false],
    ['cash', true],
  ])('skips the sufficiency check for %s (FOC approved: %s)', (paymentMethod, focApproved) => {
    expect(guardSettlement({ ...base, paymentMethod, focApproved, paidAmount: 0 })).toEqual({
      ok: true,
    });
  });

  it('rejects ARK Coin mixed with another method', () => {
    expect(guardSettlement({ ...base, arkUsed: 1000 })).toEqual({
      ok: false,
      status: 400,
      error: 'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran',
    });
  });

  it('requires a customer for ARK Coin', () => {
    expect(
      guardSettlement({
        ...base,
        paymentMethod: 'ark_coin',
        paidAmount: 0,
        arkUsed: 100000,
        customerId: undefined,
      })
    ).toEqual({ ok: false, status: 400, error: 'Pembayaran ARK Coin membutuhkan customer' });
  });

  it('requires ARK Coin to cover the whole total', () => {
    expect(
      guardSettlement({ ...base, paymentMethod: 'ark_coin', paidAmount: 50000, arkUsed: 50000 })
    ).toEqual({
      ok: false,
      status: 400,
      error: 'Pembayaran ARK Coin harus menutup seluruh total order',
    });
  });

  it('checks sufficiency before ARK rules', () => {
    expect(
      guardSettlement({ ...base, paymentMethod: 'ark_coin', paidAmount: 0, arkUsed: 10 })
    ).toMatchObject({ error: 'Payment insufficient' });
  });

  it('passes a full ARK Coin payment', () => {
    expect(
      guardSettlement({ ...base, paymentMethod: 'ark_coin', paidAmount: 0, arkUsed: 100000 })
    ).toEqual({ ok: true });
  });
});

describe('guardCompRequest', () => {
  it('treats missing or empty comp_type as no comp', () => {
    expect(guardCompRequest({ compType: undefined, customerId: undefined, total: 5 })).toEqual({
      ok: true,
      compType: null,
    });
    expect(guardCompRequest({ compType: '', customerId: undefined, total: 5 })).toEqual({
      ok: true,
      compType: null,
    });
  });

  it('rejects unknown comp types, including owner_comp', () => {
    expect(guardCompRequest({ compType: 'owner_comp', customerId: 'c', total: 0 })).toEqual({
      ok: false,
      status: 400,
      error:
        'comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)',
    });
  });

  it('requires a customer for KOL comps', () => {
    expect(guardCompRequest({ compType: 'kol_comp', customerId: undefined, total: 0 })).toEqual({
      ok: false,
      status: 400,
      error: 'Komplimen KOL membutuhkan customer',
    });
  });

  it('requires the KOL comp to make the order free (0.5 tolerance)', () => {
    expect(guardCompRequest({ compType: 'kol_comp', customerId: 'c', total: 0.51 })).toEqual({
      ok: false,
      status: 400,
      error: 'Komplimen KOL harus menggratiskan seluruh order (total 0)',
    });
    expect(guardCompRequest({ compType: 'kol_comp', customerId: 'c', total: 0.5 })).toEqual({
      ok: true,
      compType: 'kol_comp',
    });
  });
});
