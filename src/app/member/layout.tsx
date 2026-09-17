import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal Member — BCD Coffee",
  description: "Cek saldo ARK Coin, XP, tier, reward, dan riwayat transaksi Anda.",
};

/**
 * Layout portal member — berdiri sendiri, tanpa chrome dashboard internal.
 *
 * Kelas `member-portal` membawa token warna yang diturunkan dari brand
 * (--brand-primary), jadi portal tetap satu tema dengan dashboard dan ikut
 * berubah bila brand diganti dari ThemeProvider.
 */
export default function MemberPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="member-portal member-portal-bg min-h-screen">
      {/*
        max-w-lg (512px) supaya HP lebar (Pro Max / Ultra ~430-480px) tetap
        terisi penuh; batas ini hanya bekerja di layar besar agar portal tidak
        melebar tak wajar di desktop. Padding dikecilkan di layar sempit.
      */}
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-3 pb-8 pt-5 sm:px-4">
        {children}
      </div>
    </div>
  );
}
