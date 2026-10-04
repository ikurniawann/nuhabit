/** Label + kelas warna badge untuk status PR, PO, dan prioritas. */
export function getPRStatusLabel(status: string): { label: string; color: string } {
  const labels: Record<string, { label: string; color: string }> = {
    draft: { label: "Draf", color: "bg-gray-100 text-gray-700" },
    pending_head: { label: "Menunggu Kepala Departemen", color: "bg-yellow-100 text-yellow-700" },
    pending_finance: { label: "Menunggu Finance", color: "bg-orange-100 text-orange-700" },
    pending_direksi: { label: "Menunggu Direktur", color: "bg-orange-100 text-orange-700" },
    approved: { label: "Disetujui", color: "bg-green-100 text-green-700" },
    rejected: { label: "Ditolak", color: "bg-red-100 text-red-700" },
    converted: { label: "Purchase Order Dibuat", color: "bg-blue-100 text-blue-700" },
  };
  
  return labels[status] || { label: status, color: "bg-gray-100 text-gray-700" };
}

export function getPOStatusLabel(status: string): { label: string; color: string } {
  const normalized = status.toLowerCase();
  const labels: Record<string, { label: string; color: string }> = {
    draft: { label: "Draf", color: "bg-gray-100 text-gray-700" },
    approved: { label: "Disetujui", color: "bg-green-100 text-green-700" },
    sent: { label: "Terkirim", color: "bg-blue-100 text-blue-700" },
    partial: { label: "Diterima Sebagian", color: "bg-yellow-100 text-yellow-700" },
    partially_received: { label: "Diterima Sebagian", color: "bg-yellow-100 text-yellow-700" },
    received: { label: "Diterima", color: "bg-green-100 text-green-700" },
    closed: { label: "Ditutup", color: "bg-slate-100 text-slate-800" },
    cancelled: { label: "Dibatalkan", color: "bg-red-100 text-red-700" },
  };
  
  return labels[normalized] || { label: status, color: "bg-gray-100 text-gray-700" };
}

/**
 * Priority badge mapper
 */
export function getPriorityBadge(priority: string): { label: string; color: string } {
  const badges: Record<string, { label: string; color: string }> = {
    low: { label: "Rendah", color: "bg-gray-100 text-gray-700" },
    medium: { label: "Sedang", color: "bg-blue-100 text-blue-700" },
    high: { label: "Tinggi", color: "bg-orange-100 text-orange-700" },
    urgent: { label: "Mendesak", color: "bg-red-100 text-red-700" },
  };
  
  return badges[priority] || { label: priority, color: "bg-gray-100 text-gray-700" };
}
