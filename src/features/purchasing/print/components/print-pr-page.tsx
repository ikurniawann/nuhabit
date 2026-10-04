import { createServerPgClient } from "@/lib/pg/create-client";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import { getPRStatusLabel } from "@/lib/purchasing/status-labels";
import { PRItem } from "@/types/purchasing";
import { PrintFloatingButton } from "@/features/purchasing/print/components/print-floating-button";
import { PrintDocumentTitle } from "@/features/purchasing/print/components/print-document-title";
import { PrintDocumentStyles } from "@/features/purchasing/print/components/print-document-styles";

type UserRow = {
  id: string;
  full_name: string;
};

type DepartmentRow = {
  name: string;
  code?: string | null;
};

interface PrintPRPageProps {
  params: Promise<{ id: string }>;
}

export async function PrintPRPage({ params }: PrintPRPageProps) {
  const { id } = await params;
  const db = await createServerPgClient();

  const { data: pr } = await db
    .from("purchase_requests")
    .select(`
      *,
      items:pr_items(
        *,
        raw_material:raw_materials!raw_material_id(id, kode, nama),
        satuan:units!satuan_id(id, nama)
      )
    `)
    .eq("id", id)
    .single();

  if (!pr) {
    notFound();
  }

  const statusBadge = getPRStatusLabel(pr.status);
  const relatedUserIds = [
    pr.requester_id,
    pr.approved_by_head,
    pr.rejected_by,
  ].filter(Boolean);
  const { data: relatedUsers } = relatedUserIds.length
    ? await db.from("users").select("id, full_name").in("id", relatedUserIds)
    : { data: [] };
  const userNameById = new Map(
    ((relatedUsers || []) as UserRow[]).map((user) => [user.id, user.full_name])
  );
  const { data: department } = pr.department_id
    ? await db
        .from("departments")
        .select("name, code")
        .eq("id", pr.department_id)
        .single()
    : { data: null };
  const departmentData = department as DepartmentRow | null;
  const requesterName = userNameById.get(pr.requester_id) || "-";
  const approverName = pr.approved_by_head ? userNameById.get(pr.approved_by_head) || "-" : "-";
  const printTitle = `Purchase Request - ${pr.pr_number}`;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 print:min-h-0 print:bg-white print:p-0">
      <PrintDocumentTitle title={printTitle} />
      <PrintDocumentStyles />

      <main className="print-root print-sheet mx-auto max-w-4xl rounded-2xl border border-gray-200/70 bg-white p-8 shadow-sm">
        {/* Header */}
        <div className="print-keep mb-6 flex items-start justify-between gap-6 border-b border-gray-200/70 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-600">
              Purchase Request
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
              Permintaan Pembelian
            </h1>
            <p className="mt-1 text-sm text-gray-500">Dokumen kebutuhan pembelian internal</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">No. PR</p>
            <p className="text-xl font-bold text-gray-900">{pr.pr_number}</p>
            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge.color}`}>
              {statusBadge.label}
            </span>
          </div>
        </div>

        {/* Document Info */}
        <section className="print-keep mb-6 grid grid-cols-1 gap-4 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500">Tanggal PR</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(pr.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Departemen</p>
              <p className="text-sm font-medium text-gray-900">{departmentData?.name || "-"}</p>
              {departmentData?.code && <p className="text-xs text-gray-500">{departmentData.code}</p>}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500">Requester</p>
              <p className="text-sm font-medium text-gray-900">{requesterName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tanggal Dibutuhkan</p>
              <p className="text-sm font-medium text-gray-900">
                {formatDate(pr.required_date)}
              </p>
            </div>
          </div>
        </section>

        {/* Items Table */}
        <section className="print-table-wrap mb-6 overflow-hidden rounded-xl border border-gray-200/70">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200/70">
                <th className="w-12 px-3 py-3 text-left text-xs font-semibold text-gray-700">No</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">Deskripsi</th>
                <th className="w-20 px-3 py-3 text-center text-xs font-semibold text-gray-700">Qty</th>
                <th className="w-24 px-3 py-3 text-center text-xs font-semibold text-gray-700">Satuan</th>
                <th className="w-32 px-3 py-3 text-right text-xs font-semibold text-gray-700">Est. Harga</th>
                <th className="w-32 px-3 py-3 text-right text-xs font-semibold text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody>
              {pr.items?.map((item: PRItem, index: number) => (
                <tr key={item.id} className="border-b border-gray-200/60 last:border-0">
                  <td className="px-3 py-3 text-sm">{index + 1}</td>
                  <td className="px-3 py-3 text-sm">
                    <p className="font-medium text-gray-900">{item.raw_material?.nama || item.description}</p>
                    {item.raw_material?.kode && <p className="text-xs text-gray-500">{item.raw_material.kode}</p>}
                    {item.description && item.raw_material?.nama && (
                      <p className="text-xs text-gray-500">{item.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-sm">{item.qty}</td>
                  <td className="px-3 py-3 text-center text-sm">{item.satuan?.nama || item.unit}</td>
                  <td className="px-3 py-3 text-right text-sm">{formatRupiah(item.estimated_price)}</td>
                  <td className="px-3 py-3 text-right text-sm font-semibold">{formatRupiah(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200/70 bg-gray-50">
                <td colSpan={5} className="px-3 py-3 text-right text-sm font-semibold text-gray-700">
                  Total Estimasi
                </td>
                <td className="px-3 py-3 text-right text-base font-bold text-gray-900">
                  {formatRupiah(pr.total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Notes */}
        {pr.notes && (
          <section className="print-keep mb-6 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <h2 className="text-sm font-semibold text-gray-900">Catatan</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{pr.notes}</p>
          </section>
        )}

        <div className="print-keep">
          <section className="mt-8">
            <div className="print-break-after-avoid mb-4 border-b border-gray-200/70 pb-2">
              <h2 className="text-sm font-semibold text-gray-900">Persetujuan</h2>
              <p className="text-xs text-gray-500">Approval kebutuhan barang dan kuantitas</p>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div className="text-center">
                <p className="mb-12 text-xs text-gray-500">Diajukan oleh,</p>
                <div className="mx-4 border-t border-gray-300 pt-2">
                  <p className="text-sm font-semibold text-gray-900">{requesterName}</p>
                  <p className="text-xs text-gray-500">Requester</p>
                </div>
              </div>
              <div className="text-center">
                <p className="mb-12 text-xs text-gray-500">Disetujui oleh,</p>
                <div className="mx-4 border-t border-gray-300 pt-2">
                  <p className="text-sm font-semibold text-gray-900">{approverName}</p>
                  <p className="text-xs text-gray-500">
                    Head Department{pr.approved_at_head ? ` (${formatDate(pr.approved_at_head)})` : ""}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <footer className="mt-10 border-t border-gray-200/70 pt-4 text-center text-xs text-gray-400">
            <p>Generated by Aapex Purchasing System</p>
            <p className="mt-1">Printed: {formatDateTime(new Date())}</p>
          </footer>
        </div>
      </main>

      <PrintFloatingButton />
    </div>
  );
}
