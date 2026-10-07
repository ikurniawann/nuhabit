import { useCallback, useEffect, useState } from "react";

import { fetchMe, fetchTransactions, type MemberProfileResponse } from "@/lib/api";
import {
  mapOrderRow,
  mapWalletRow,
  type OrderTxnView,
  type WalletTxnView,
} from "@/lib/loyalty";

/**
 * Data beranda mobile (EPIC-044 Fase B) — paritas perilaku adapter Nox
 * dashboard (`use-nox-member.ts`):
 * - /me dan /transactions diambil paralel;
 * - riwayat GAGAL ≠ portal mati — profil tetap tampil, daftar kosong,
 *   ditandai `historyError`;
 * - saldo disimpan Rupiah, dikonversi ARK display satu kali di sini.
 */
export type MemberDataState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | {
      status: "ready";
      member: MemberProfileResponse;
      wallet: WalletTxnView[];
      orders: OrderTxnView[];
      historyError: boolean;
    };

export function useMemberData(): {
  state: MemberDataState;
  reload: () => void;
} {
  const [state, setState] = useState<MemberDataState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [meRes, txnRes] = await Promise.all([
        fetchMe(),
        fetchTransactions(),
      ]);

      if (meRes.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      if (!meRes.ok || !meRes.data) {
        setState({ status: "error" });
        return;
      }

      const member = meRes.data;
      const arkRate = Number(member.ark_rate) || undefined;

      let wallet: WalletTxnView[] = [];
      let orders: OrderTxnView[] = [];
      let historyError = false;
      if (txnRes.ok && txnRes.data) {
        // Rate undefined → fallback default 1000 di dalam idrToArk.
        const rate = arkRate ?? 1000;
        wallet = txnRes.data.wallet.map((row) => mapWalletRow(row, rate));
        orders = txnRes.data.orders.map((row) => mapOrderRow(row, rate));
      } else {
        historyError = true;
      }

      setState({ status: "ready", member, wallet, orders, historyError });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
