'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCurrentShift, openShift, closeShift, type PosShift } from '@/lib/pos-api';
import { POS_SHIFT_MANAGEMENT_ENABLED } from '@/lib/pos/feature-flags';

const SHIFT_CHANGED_EVENT = 'pos-shift-changed';

export function usePosShift(cashierId: string) {
  const [shift, setShift] = useState<PosShift | null>(null);
  const [loading, setLoading] = useState(POS_SHIFT_MANAGEMENT_ENABLED);
  const [error, setError] = useState<string | null>(null);

  const fetchCurrent = useCallback(async () => {
    if (!POS_SHIFT_MANAGEMENT_ENABLED) {
      setShift(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!cashierId) {
      setShift(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await getCurrentShift(cashierId);
    if (res.success && res.data) {
      setShift(res.data);
      setError(null);
    } else {
      setShift(null);
      if (res.error && !res.error.includes('active shift')) {
        setError(res.error);
      } else {
        setError(null);
      }
    }
    setLoading(false);
  }, [cashierId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCurrent();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchCurrent]);

  useEffect(() => {
    const handleShiftChanged = () => {
      void fetchCurrent();
    };

    window.addEventListener(SHIFT_CHANGED_EVENT, handleShiftChanged);
    return () => window.removeEventListener(SHIFT_CHANGED_EVENT, handleShiftChanged);
  }, [fetchCurrent]);

  const doOpen = useCallback(
    async (openingCash: number, notes?: string) => {
      if (!POS_SHIFT_MANAGEMENT_ENABLED) {
        return { success: false, error: 'Shift management is disabled' };
      }
      const res = await openShift({ cashier_id: cashierId, opening_cash: openingCash, notes });
      if (res.success && res.data) {
        setShift(res.data);
        setError(null);
        window.dispatchEvent(new CustomEvent(SHIFT_CHANGED_EVENT));
      }
      return res;
    },
    [cashierId]
  );

  const doClose = useCallback(
    async (closingCash: number, notes?: string) => {
      if (!POS_SHIFT_MANAGEMENT_ENABLED) {
        return { success: false, error: 'Shift management is disabled' };
      }
      if (!shift) return { success: false, error: 'No active shift' };
      const res = await closeShift(shift.id, { closing_cash: closingCash, notes });
      if (res.success) {
        setShift(null);
        setError(null);
        window.dispatchEvent(new CustomEvent(SHIFT_CHANGED_EVENT));
      }
      return res;
    },
    [shift]
  );

  return {
    shift: POS_SHIFT_MANAGEMENT_ENABLED ? shift : null,
    isActive: POS_SHIFT_MANAGEMENT_ENABLED ? !!shift : true,
    loading: POS_SHIFT_MANAGEMENT_ENABLED ? loading : false,
    error: POS_SHIFT_MANAGEMENT_ENABLED ? error : null,
    enabled: POS_SHIFT_MANAGEMENT_ENABLED,
    refresh: fetchCurrent,
    openShift: doOpen,
    closeShift: doClose,
  };
}
