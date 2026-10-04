import { describe, expect, it } from 'vitest';
import {
  clampOrderListLimit,
  parseOrderListFilters,
  parsePaymentMethodFilter,
  sanitizeOrderSearch,
} from './list-orders';

describe('clampOrderListLimit', () => {
  it("maps 'all' to the 10,000 safety cap", () => {
    expect(clampOrderListLimit('all')).toBe(10_000);
  });

  it('defaults to 50 when missing or not a number', () => {
    expect(clampOrderListLimit(null)).toBe(50);
    expect(clampOrderListLimit('')).toBe(50);
    expect(clampOrderListLimit('abc')).toBe(50);
  });

  it('clamps to 1..10,000', () => {
    expect(clampOrderListLimit('0')).toBe(1);
    expect(clampOrderListLimit('-5')).toBe(1);
    expect(clampOrderListLimit('250')).toBe(250);
    expect(clampOrderListLimit('99999')).toBe(10_000);
  });
});

describe('parsePaymentMethodFilter', () => {
  it('maps credit_card to the stored credit value', () => {
    expect(parsePaymentMethodFilter('credit_card')).toBe('credit');
  });

  it('keeps known methods and drops unknown ones', () => {
    expect(parsePaymentMethodFilter('qris')).toBe('qris');
    expect(parsePaymentMethodFilter('gift_card')).toBe('gift_card');
    expect(parsePaymentMethodFilter('bitcoin')).toBeNull();
    expect(parsePaymentMethodFilter(null)).toBeNull();
  });
});

describe('sanitizeOrderSearch', () => {
  it('trims and strips ilike/PostgREST wildcards', () => {
    expect(sanitizeOrderSearch('  ORD%_*12  ')).toBe('ORD12');
  });

  it('caps the term at 64 characters', () => {
    expect(sanitizeOrderSearch('a'.repeat(100))).toHaveLength(64);
  });

  it('returns empty for missing or wildcard-only input', () => {
    expect(sanitizeOrderSearch(null)).toBe('');
    expect(sanitizeOrderSearch('%%*')).toBe('');
  });
});

describe('parseOrderListFilters', () => {
  it('ignores values outside the allowed sets', () => {
    const parsed = parseOrderListFilters(
      new URLSearchParams({
        status: 'deleted',
        payment_status: 'void',
        order_type: 'drive_thru',
        payment_method: 'bitcoin',
      })
    );
    expect(parsed).toMatchObject({
      ok: true,
      filters: { status: null, paymentStatus: null, orderType: null, paymentMethod: null },
    });
  });

  it('keeps allowed filters and parses flags', () => {
    const parsed = parseOrderListFilters(
      new URLSearchParams({
        status: 'ready',
        customer_id: 'cust-1',
        payment_status: 'paid',
        order_type: 'takeaway',
        payment_method: 'credit_card',
        q: ' A-01 ',
        active_only: 'true',
        limit: 'all',
      })
    );
    expect(parsed).toEqual({
      ok: true,
      filters: {
        status: 'ready',
        customerId: 'cust-1',
        paymentStatus: 'paid',
        orderType: 'takeaway',
        paymentMethod: 'credit',
        dateRange: null,
        search: 'A-01',
        activeOnly: true,
        limit: 10_000,
      },
    });
  });

  it('parses a date range when either bound is given', () => {
    const parsed = parseOrderListFilters(
      new URLSearchParams({ date_from: '2026-09-01', date_to: '2026-09-30' })
    );
    expect(parsed.ok && parsed.filters.dateRange).toMatchObject({
      startIso: expect.any(String),
      endIso: expect.any(String),
    });
  });

  it('returns the range error when from is after to', () => {
    const parsed = parseOrderListFilters(
      new URLSearchParams({ date_from: '2026-09-30', date_to: '2026-09-01' })
    );
    expect(parsed).toEqual({
      ok: false,
      error: 'Tanggal dari tidak boleh melebihi tanggal sampai',
    });
  });
});
