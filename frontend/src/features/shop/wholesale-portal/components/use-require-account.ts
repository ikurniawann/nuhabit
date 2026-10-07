"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWholesaleMe, type WholesaleAccount } from "../queries";

/** Portal pages that need a session: without an account, back to /wholesale. */
export function useRequireAccount(): { account: WholesaleAccount | null; loading: boolean } {
  const router = useRouter();
  const me = useWholesaleMe();
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut || me.isError) router.replace("/wholesale");
  }, [signedOut, me.isError, router]);
  return { account: me.data ?? null, loading: me.isPending };
}
