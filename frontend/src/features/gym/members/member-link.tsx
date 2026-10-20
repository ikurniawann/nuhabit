import Link from "next/link";
import { cn } from "@/lib/utils";

/** Halaman profil 360 member di dashboard gym. */
export const memberHref = (customerId: string) => `/dashboard/gym/members/${customerId}`;

/** Nama member yang membuka profil 360-nya. */
export function MemberLink({ id, name, className }: { id: string; name: string | null; className?: string }) {
  return (
    <Link href={memberHref(id)} className={cn("font-medium text-forest hover:underline", className)}>
      {name ?? "Member"}
    </Link>
  );
}
