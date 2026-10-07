/**
 * Porsi sebuah potongan terhadap gaji bruto, untuk ditampilkan di slip gaji.
 *
 * Satu makna dipakai untuk SEMUA baris potongan — termasuk PPh 21, cicilan
 * pinjaman, dan keterlambatan yang tidak punya tarif resmi. Sengaja bukan
 * "tarif" BPJS: tarif dihitung dari dasar berplafon, sehingga 2% tarif JHT
 * tidak sama dengan porsinya terhadap bruto. Mencampur dua makna dalam satu
 * kolom akan membuat slip terbaca saling bertentangan.
 */

/**
 * @returns string persen siap tampil, atau null bila tidak bermakna
 *          (bruto nol/negatif, atau potongannya nol).
 */
export function formatShareOfGross(amount: number, gross: number): string | null {
  if (!Number.isFinite(amount) || !Number.isFinite(gross)) return null;
  if (gross <= 0) return null;
  if (!amount) return null;

  const percent = (Math.abs(amount) / gross) * 100;

  // Nilai sangat kecil akan dibulatkan jadi "0,0%" dan terbaca seolah nihil.
  if (percent > 0 && percent < 0.05) return "<0,1%";

  return (
    percent.toLocaleString("id-ID", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + "%"
  );
}
