import { MobilePortal } from "@/features/member-portal/mobile/mobile-portal";

/**
 * /member/v1: portal member versi tab (ARK Coin, reward, badge). Aplikasi utama
 * (port 1:1 aplikasi NüHabit) di /member; Nox di /member/nox, klasik di /member/classic.
 */
export default function Page() {
  return <MobilePortal />;
}
