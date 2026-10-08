import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white px-6 text-center text-forest">
      <div className="max-w-md">
        <p className="text-xs font-semibold uppercase tracking-[0.2em]">NüHabit</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">Halaman belum tersedia</h1>
        <p className="mt-3 text-sm text-gray-600">Alamat ini belum bisa diakses. Kembali ke halaman utama untuk melanjutkan.</p>
        <Link href="/" className="mt-6 inline-flex rounded-full bg-lime px-6 py-3 text-sm font-semibold text-forest hover:bg-lemon">Kembali ke Home</Link>
      </div>
    </main>
  );
}
