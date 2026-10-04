"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { needsCrossPosLayoutHardNav } from "@/features/pos/tablet-mode";

/**
 * /pos/* and POS ↔ back-office use different layouts; a client <Link> across
 * that boundary fails with an RSC network error, so those hops load the page.
 */
export function NavLink({ href, ...props }: React.ComponentProps<"a"> & { href: string }) {
  const pathname = usePathname();
  if (needsCrossPosLayoutHardNav(pathname, href)) return <a href={href} {...props} />;
  return <Link href={href} {...props} />;
}

/** Imperative twin of NavLink for menus and search results. */
export function useNavigate(): (href: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return (href) => {
    if (needsCrossPosLayoutHardNav(pathname, href)) window.location.assign(href);
    else router.push(href);
  };
}
