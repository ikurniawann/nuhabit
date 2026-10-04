import { describe, expect, it } from 'vitest';
import {
  buildLineInputs,
  buildOrderInsertRows,
  buildOrderItemRows,
  computeChangeAmount,
  computeItemsSubtotal,
  itemLineSubtotal,
  itemQuantity,
  itemUnitPrice,
  parseDiscountType,
  parseNullableNumber,
  resolveTrustedTotal,
  stripLegacyItemColumns,
  type OrderInsertInput,
} from './order-pricing';

describe('item price math', () => {
  it('adds variant and modifier adjustments to the unit price', () => {
    const item = {
      unit_price: '20000',
      variant_price_adjustment: 5000,
      modifier_price_adjustment: '2500',
      quantity: 2,
    };
    expect(itemUnitPrice(item)).toBe(27500);
    expect(itemLineSubtotal(item)).toBe(55000);
  });

  it('defaults quantity to 1 when missing, zero or invalid', () => {
    expect(itemQuantity({})).toBe(1);
    expect(itemQuantity({ quantity: 0 })).toBe(1);
    expect(itemQuantity({ quantity: 'abc' })).toBe(1);
    expect(itemQuantity({ quantity: '3' })).toBe(3);
  });

  it('treats missing or invalid prices as 0', () => {
    expect(itemUnitPrice({ unit_price: 'x', variant_price_adjustment: undefined })).toBe(0);
  });

  it('sums line subtotals for the server subtotal', () => {
    expect(
      computeItemsSubtotal([
        { unit_price: 10000, quantity: 2 },
        { unit_price: 15000, modifier_price_adjustment: 3000 },
      ])
    ).toBe(38000);
    expect(computeItemsSubtotal([])).toBe(0);
  });
});

describe('discount parsing', () => {
  it('accepts only percent and fixed discount types', () => {
    expect(parseDiscountType('percent')).toBe('percent');
    expect(parseDiscountType('fixed')).toBe('fixed');
    expect(parseDiscountType('PERCENT')).toBeNull();
    expect(parseDiscountType(null)).toBeNull();
  });

  it('maps null/undefined/empty string to null, everything else to Number', () => {
    expect(parseNullableNumber(null)).toBeNull();
    expect(parseNullableNumber(undefined)).toBeNull();
    expect(parseNullableNumber('')).toBeNull();
    expect(parseNullableNumber('10')).toBe(10);
    expect(parseNullableNumber(0)).toBe(0);
  });

  it('builds line inputs for the discount stack', () => {
    expect(
      buildLineInputs([
        { unit_price: 10000, quantity: 2, discount_type: 'percent', discount_value: '10' },
        { unit_price: 5000, discount_type: 'bogus', discount_value: '' },
      ])
    ).toEqual([
      { line_subtotal: 20000, discount_type: 'percent', discount_value: 10 },
      { line_subtotal: 5000, discount_type: null, discount_value: null },
    ]);
  });
});

describe('resolveTrustedTotal', () => {
  const base = {
    paymentMethod: 'cash',
    hasPromoHold: false,
    clientTotal: 99999 as number | string | undefined,
    subtotal: 100000,
    discount: 10000,
    tax: 9000,
    serviceCharge: 5000,
    otherCharges: 1000,
  };
  const derived = 100000 - 10000 + 9000 + 5000 + 1000;

  it('trusts the client total for ordinary payments', () => {
    expect(resolveTrustedTotal(base)).toBe(99999);
  });

  it('falls back to the server total when the client total is empty or 0', () => {
    expect(resolveTrustedTotal({ ...base, clientTotal: undefined })).toBe(derived);
    expect(resolveTrustedTotal({ ...base, clientTotal: 0 })).toBe(derived);
  });

  it.each(['nfc_tab', 'gift_card'])('always derives the total for %s', (paymentMethod) => {
    expect(resolveTrustedTotal({ ...base, paymentMethod })).toBe(derived);
  });

  it('always derives the total when a promo code is held', () => {
    expect(resolveTrustedTotal({ ...base, hasPromoHold: true })).toBe(derived);
  });
});

describe('computeChangeAmount', () => {
  it('returns overpayment including ARK, never negative', () => {
    expect(computeChangeAmount(100000, 0, 85000)).toBe(15000);
    expect(computeChangeAmount(50000, 40000, 85000)).toBe(5000);
    expect(computeChangeAmount(10000, 0, 85000)).toBe(0);
  });
});

describe('buildOrderInsertRows', () => {
  const input: OrderInsertInput = {
    presetOrderId: 'preset-id',
    promoOrderId: null,
    orderNumber: 'ORD-1',
    queueNumber: 'A001',
    orderType: 'dine_in',
    deferPaid: false,
    companyId: 'c1',
    branchId: 'b1',
    warehouseId: 'w1',
    customerId: 'cust-1',
    cashierId: 'cashier-1',
    serverId: null,
    tableId: null,
    guestCount: 2,
    shiftId: null,
    subtotal: 100000,
    discount: 10000,
    discountReason: 'Member 10%',
    manualDiscountType: null,
    manualDiscountValue: null,
    tax: 9000,
    serviceCharge: 0,
    otherCharges: 0,
    chargesBreakdown: [],
    total: 99000,
    paidAmount: 100000,
    arkUsed: 0,
    paymentMethod: 'cash',
    notes: null,
    specialRequests: null,
    orderedAt: '2026-10-04T00:00:00.000Z',
    soldFrom: 'stall',
    xenditQrId: undefined,
    xenditExternalId: undefined,
    paymentMethodCode: undefined,
    paymentMethodName: undefined,
    compType: null,
    focApprover: null,
  };

  it('uses the preset id, marks paid and computes change', () => {
    const { row } = buildOrderInsertRows(input);
    expect(row).toMatchObject({
      id: 'preset-id',
      payment_status: 'paid',
      status: 'pending',
      change_amount: 1000,
      total_amount: 99000,
      sold_from: 'stall',
    });
    expect(row).not.toHaveProperty('comp_type');
  });

  it('defers payment status to unpaid for balance payments', () => {
    expect(buildOrderInsertRows({ ...input, deferPaid: true }).row.payment_status).toBe('unpaid');
  });

  it('zeroes revenue and records the approver for FOC', () => {
    const { row } = buildOrderInsertRows({
      ...input,
      compType: 'kol_comp',
      focApprover: { id: 'sup-1', name: 'Supervisor' },
    });
    expect(row).toMatchObject({
      discount_amount: 100000,
      discount_reason: 'FOC',
      tax_amount: 0,
      service_charge_amount: 0,
      other_charges_amount: 0,
      total_amount: 0,
      amount_paid: 0,
      change_amount: 0,
      comp_type: 'foc_comp',
      comp_approved_by: 'sup-1',
      comp_approved_name: 'Supervisor',
    });
  });

  it('stamps comp_type for KOL comps', () => {
    expect(buildOrderInsertRows({ ...input, compType: 'kol_comp' }).row.comp_type).toBe('kol_comp');
  });

  it('legacy payload drops new columns and uses the promo id, not the offer preset id', () => {
    const { legacy } = buildOrderInsertRows({ ...input, focApprover: { id: 's', name: 'S' } });
    expect(legacy).not.toHaveProperty('id');
    for (const column of [
      'manual_discount_type',
      'manual_discount_value',
      'sold_from',
      'xendit_qr_id',
      'xendit_external_id',
      'payment_method_code',
      'payment_method_name',
      'comp_type',
    ]) {
      expect(legacy).not.toHaveProperty(column);
    }
    expect(legacy.total_amount).toBe(99000);
    expect(buildOrderInsertRows({ ...input, promoOrderId: 'promo-id' }).legacy.id).toBe('promo-id');
  });
});

describe('buildOrderItemRows', () => {
  const costMap = new Map([
    ['p1', { id: 'p1', cost_price: 4000 }],
  ]) as unknown as Parameters<typeof buildOrderItemRows>[0]['costMap'];

  const rows = buildOrderItemRows({
    orderId: 'o1',
    items: [
      {
        product_id: 'p1',
        product_name: 'Kopi Susu',
        unit_price: 20000,
        variant_price_adjustment: 2000,
        quantity: 2,
        discount_type: 'fixed',
        discount_value: '4000',
      },
      { product_id: 'p2', product_sku: 'SKU-RAW' },
    ],
    lineResults: [{ discount_amount: 4000, total_amount: 40000 }],
    costMap,
    skuByProduct: new Map([['p1', 'KOPI-01']]),
    merchClaimedIds: new Set(['p2']),
  });

  it('uses the effective unit price and the stack line result', () => {
    expect(rows[0]).toMatchObject({
      order_id: 'o1',
      product_sku: 'KOPI-01',
      quantity: 2,
      unit_price: 22000,
      subtotal: 44000,
      discount_type: 'fixed',
      discount_value: 4000,
      discount_amount: 4000,
      total_amount: 40000,
      xp_earned: 0,
      kitchen_status: 'pending',
      inventory_deducted: false,
      cost_price: 4000,
      cost_total: 8000,
      gross_profit: 32000,
    });
  });

  it('falls back to the subtotal, the client SKU and Unknown name', () => {
    expect(rows[1]).toMatchObject({
      product_name: 'Unknown',
      product_sku: 'SKU-RAW',
      quantity: 1,
      discount_amount: 0,
      total_amount: 0,
      sku_id: null,
      inventory_deducted: true,
    });
  });

  it('strips columns old databases do not have', () => {
    const [legacy] = stripLegacyItemColumns(rows);
    for (const column of [
      'station',
      'kitchen_status',
      'sku_id',
      'cost_price',
      'cost_total',
      'gross_profit',
      'gross_margin_pct',
      'discount_type',
      'discount_value',
    ]) {
      expect(legacy).not.toHaveProperty(column);
    }
    expect(legacy).toMatchObject({ product_sku: 'KOPI-01', total_amount: 40000 });
  });
});
