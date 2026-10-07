"use client";

import type { ReactNode } from "react";
import { useLang } from "../lib/lang";

export function MemberLanguage({ children }: { children: ReactNode }) {
  const lang = useLang();
  return <div lang={lang}>{children}</div>;
}
