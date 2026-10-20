"use client";

import { Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/format";
import {
  discountLabel,
  lookupReferral,
  rememberReferralCode,
  storedReferralCode,
  type ReferralInvite,
} from "@/lib/member-portal/referral";
import { Container } from "./site-section";

/**
 * /join?ref=CODE: remembers the code for the sign-up step and says who
 * invited. Renders nothing for an unknown code or a paused program.
 */
export function ReferralBanner({ code }: { code?: string }) {
  const [invite, setInvite] = useState<ReferralInvite | null>(null);

  useEffect(() => {
    const active = rememberReferralCode(code) || storedReferralCode();
    if (!active) return;
    let live = true;
    void lookupReferral(active).then((found) => {
      if (live) setInvite(found);
    });
    return () => {
      live = false;
    };
  }, [code]);

  if (!invite) return null;
  const perks = [
    invite.referee_discount ? `${discountLabel(invite.referee_discount, formatRupiah)} off your first plan` : "",
    invite.referee_credits > 0 ? `${invite.referee_credits} bonus class credits` : "",
  ].filter(Boolean);

  return (
    <Container className="max-w-3xl pt-6">
      <p className="flex items-start gap-2 rounded-2xl bg-lime px-4 py-3 text-sm font-semibold text-forest">
        <Gift className="mt-0.5 size-4 shrink-0" />
        <span>
          {invite.referrer_name} invited you to NüHabit.
          {perks.length > 0 ? ` Sign up to get ${perks.join(" and ")}.` : " Sign up with their code to join."}
        </span>
      </p>
    </Container>
  );
}
