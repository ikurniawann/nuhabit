import { redirect } from "next/navigation";

// Menu induk Toko Online tidak punya halaman sendiri; buka daftar pesanan.
export default function Page() {
  redirect("/dashboard/shop/orders");
}
