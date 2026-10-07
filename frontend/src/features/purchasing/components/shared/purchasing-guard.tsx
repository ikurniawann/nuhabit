"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import { IAM } from "@/lib/iam/prefixes";

interface PurchasingGuardProps {
  /** @deprecated Akses memakai grant IAM `items.*`, bukan role. */
  minRole?: "purchasing_staff" | "purchasing_manager" | "purchasing_admin" | "super_admin";
  /** @deprecated Akses memakai grant IAM `items.*`, bukan role. */
  allowedRoles?: string[];
  children: React.ReactNode;
  fallbackHref?: string;
}

/**
 * Guard halaman purchasing: lolos bila user punya menu IAM di bawah `items`.
 */
export default function PurchasingGuard({
  children,
  fallbackHref = "/dashboard",
}: PurchasingGuardProps) {
  const { user, loading } = useAuth();
  const { grantedCodes, hasPrefix } = useIamAccess();
  const router = useRouter();
  const iamReady = grantedCodes.length > 0 || !loading;
  const allowed = hasPrefix(IAM.items);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(fallbackHref);
      return;
    }
    if (iamReady && grantedCodes.length > 0 && !allowed) {
      router.replace(fallbackHref);
    }
  }, [user, loading, iamReady, grantedCodes.length, allowed, fallbackHref, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm">Memeriksa akses...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function usePurchasingAccess() {
  const { user, loading } = useAuth();
  const { hasPrefix } = useIamAccess();

  if (loading || !user) {
    return { allowed: false, loading: true };
  }

  return { allowed: hasPrefix(IAM.items), loading: false };
}
