export const LEAD_IMPORT_COLUMNS: Array<{
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number" | "date" | "email";
  description?: string;
}> = [
  { key: "nama_instansi", label: "Nama Instansi", required: true },
  {
    key: "jenis_instansi",
    label: "Jenis Instansi",
    description: "corporate | sekolah | komunitas | travel-agent | pemerintah | perorangan | lainnya",
  },
  { key: "nama_pic", label: "Nama PIC", required: true },
  { key: "jabatan_pic", label: "Jabatan PIC" },
  { key: "wa_pic", label: "No. WA PIC", required: true },
  { key: "email_pic", label: "Email PIC", type: "email" },
  { key: "kota", label: "Kota" },
  {
    key: "sumber",
    label: "Sumber",
    description: "wa | instagram | referral | google | pameran | canvassing | lainnya",
  },
  { key: "suhu", label: "Suhu", description: "panas | hangat | dingin" },
  { key: "catatan", label: "Catatan" },
];

export const LEAD_IMPORT_SAMPLE_ROWS: Array<Record<string, string>> = [
  {
    nama_instansi: "PT Maju Bersama",
    jenis_instansi: "corporate",
    nama_pic: "Budi Santoso",
    jabatan_pic: "HR Manager",
    wa_pic: "081234567890",
    email_pic: "budi@majubersama.co.id",
    kota: "Bandung",
    sumber: "referral",
    suhu: "panas",
    catatan: "Tertarik gathering akhir tahun 150 pax",
  },
  {
    nama_instansi: "SD Harapan Bangsa",
    jenis_instansi: "sekolah",
    nama_pic: "Ibu Sari",
    jabatan_pic: "Kepala Sekolah",
    wa_pic: "082198765432",
    email_pic: "",
    kota: "Bandung",
    sumber: "wa",
    suhu: "hangat",
    catatan: "Field trip semester ganjil",
  },
];
