import type { Metadata } from "next";
import { LeadFormPage } from "@/features/site/components/lead-form-page";
import { Tile } from "@/features/site/components/site-section";

export const metadata: Metadata = { title: "Buka Cabang" };

const STEPS = [
  { title: "Pengajuan", text: "Isi formulir ini. Tim pengembangan cabang membaca setiap pengajuan dalam dua hari kerja." },
  { title: "Perkenalan", text: "Panggilan video 30 menit soal kota, lokasi yang dilirik, dan model kemitraan." },
  { title: "Studi lokasi", text: "Kami cek ruang, akses, dan pasar sekitar bersama Anda sebelum ada komitmen." },
  { title: "Pembukaan", text: "Peralatan, program, pelatihan coach, dan peluncuran mengikuti standar NüHabit." },
];

export default function Page() {
  return (
    <LeadFormPage
      kicker="Kemitraan"
      title="Buka Cabang"
      intro="Bawa metode NüHabit ke kota Anda: program 8 minggu, kelas kecil, dan sistem operasional yang sudah berjalan di cabang kami. Ceritakan rencana Anda dan tim kami yang menghubungi."
      slug="franchise"
      aside={
        <Tile className="space-y-4">
          <h2 className="font-display text-lg font-semibold">Yang terjadi setelah Anda mengirim</h2>
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="font-display text-lg font-bold text-forest tabular-nums dark:text-accent">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-semibold text-foreground">{step.title}</p>
                  <p className="text-sm text-body">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Tile>
      }
    />
  );
}
