export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  pkwtt: "PKWTT — Karyawan Tetap",
  pkwt: "PKWT — Kontrak Waktu Tertentu",
};

export const CONTRACT_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  active: { label: "Aktif", className: "bg-green-100 text-green-700" },
  ended: { label: "Berakhir", className: "bg-blue-100 text-blue-700" },
  terminated: { label: "Diputus", className: "bg-red-100 text-red-700" },
  converted: {
    label: "Konversi ke Tetap",
    className: "bg-purple-100 text-purple-700",
  },
};

export const contractDocumentUrl = (contractId: string) =>
  `/api/hris/contracts/${contractId}/document`;

export const contractSignedDocumentUrl = (contractId: string) =>
  `/api/hris/contracts/${contractId}/signed-document`;

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
