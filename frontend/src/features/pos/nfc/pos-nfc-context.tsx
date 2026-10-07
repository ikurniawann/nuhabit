"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PosNfcContextValue = {
  paymentNfcActive: boolean;
  setPaymentNfcActive: (active: boolean) => void;
};

const PosNfcContext = createContext<PosNfcContextValue | null>(null);

export function PosNfcProvider({ children }: { children: ReactNode }) {
  const [paymentNfcActive, setPaymentNfcActiveState] = useState(false);

  const setPaymentNfcActive = useCallback((active: boolean) => {
    setPaymentNfcActiveState(active);
  }, []);

  const value = useMemo(
    () => ({ paymentNfcActive, setPaymentNfcActive }),
    [paymentNfcActive, setPaymentNfcActive]
  );

  return <PosNfcContext.Provider value={value}>{children}</PosNfcContext.Provider>;
}

export function usePosNfc() {
  const ctx = useContext(PosNfcContext);
  if (!ctx) {
    throw new Error("usePosNfc must be used within PosNfcProvider");
  }
  return ctx;
}

/** Safe when listener mounts outside provider (no-op claim). */
export function usePosNfcOptional() {
  return useContext(PosNfcContext);
}
