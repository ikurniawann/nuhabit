"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWholesaleMe, type WholesaleAccount } from "../queries";

/** Halaman portal yang butuh sesi: tanpa akun kembali ke /wholesale. */
export function useRequireAccount(): { account: WholesaleAccount | null; loading: boolean } {
  const router = useRouter();
  const me = useWholesaleMe();
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut || me.isError) router.replace("/wholesale");
  }, [signedOut, me.isError, router]);
  return { account: me.data ?? null, loading: me.isPending };
}
