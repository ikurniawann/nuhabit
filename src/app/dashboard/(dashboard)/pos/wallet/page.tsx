import { Suspense } from "react";
import { WalletPage } from "@/features/wallet/components/wallet-page";

export default function Page() {
  return (
    <Suspense>
      <WalletPage />
    </Suspense>
  );
}
