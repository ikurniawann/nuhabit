import type { Metadata } from "next";
import { LeadFormPage } from "@/features/site/components/lead-form-page";
import { Tile } from "@/features/site/components/site-section";

export const metadata: Metadata = { title: "Peralatan" };

const ITEMS = ["Sled push dan sled pull", "SkiErg dan rowing", "Wall ball, sandbag, dan farmer's carry", "Rak, barbel, dan lantai latihan"];

export default function Page() {
  return (
    <LeadFormPage
      kicker="Peralatan"
      title="Peralatan standar HYROX untuk gym Anda"
      intro="Peralatan yang kami pakai di setiap cabang, dari satu stasiun sampai paket lengkap. Ceritakan kebutuhan dan ukuran ruang Anda; tim kami membalas pada jam kerja dengan rekomendasi dan harga."
      slug="equipment"
      aside={
        <Tile className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Yang bisa kami bantu</h2>
          <ul className="space-y-2 text-sm text-body">
            {ITEMS.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-forest dark:bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </Tile>
      }
    />
  );
}
