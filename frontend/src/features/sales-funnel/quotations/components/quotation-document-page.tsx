"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, FileDown, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DocumentFilterStrip,
  DocumentFooterBar,
  DocumentInfoGrid,
  DocumentInfoRow,
  DocumentLetterhead,
  DocumentLineInput,
  DocumentLineText,
  DocumentSheet,
  DocumentSummary,
  DocumentSummaryRow,
  DocumentTitleBand,
  RequiredMark,
  documentLineClass,
  useLetterhead,
} from "@/features/documents";
import { useDeal, useDeals } from "@/features/sales-funnel/pipeline/queries";
import { EVENT_TYPE_LABELS, type SalesDealDocument } from "@/features/sales-funnel/pipeline/types";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import {
  useCatalogProducts,
  useCreateQuotation,
  useQuotation,
  useReviseQuotation,
  useUpdateQuotation,
} from "../queries";
import {
  APPROVAL_STATUS_BADGES,
  APPROVAL_STATUS_LABELS,
  DEFAULT_TERMS_PRESET,
  EMPTY_ITEM_FORM,
  EMPTY_QUOTATION_FORM,
  EMPTY_TERM_FORM,
  QUOTATION_STATUS_BADGES,
  QUOTATION_STATUS_LABELS,
  formTotals,
  termPercentSum,
  type Quotation,
  type QuotationFormValues,
  type QuotationItemForm,
  type QuotationTermForm,
} from "../types";
import { PIPELINE_PATH, dealPath, quotationPath } from "../paths";
import { QuotationItemsTable } from "./quotation-items-table";
import { QuotationTermsEditor } from "./quotation-terms-editor";

function quotationToForm(quotation: Quotation): QuotationFormValues {
  return {
    use_ppn: quotation.use_ppn,
    ppn_persen: String(Number(quotation.ppn_persen)),
    discount_percent: String(Number(quotation.discount_percent ?? 0)),
    notes: quotation.notes ?? "",
    valid_until: quotation.valid_until?.slice(0, 10) ?? "",
    items: quotation.items.map((item) => ({
      item_type: item.item_type,
      product_id: item.product_id ?? "",
      description: item.description,
      qty: String(Number(item.qty)),
      unit_price: String(Number(item.unit_price)),
    })),
    terms: (quotation.terms ?? []).map((term) => ({
      label: term.label,
      percent: String(Number(term.percent)),
      due_date: term.due_date?.slice(0, 10) ?? "",
    })),
  };
}

/** Diskon di atas ambang butuh approval (Pengaturan CRM, Approval Rules). */
function discountHint(percent: number): string | null {
  if (percent > 20) return "Diskon di atas 20% butuh persetujuan owner.";
  if (percent > 10) return "Diskon di atas 10% butuh persetujuan admin.";
  return null;
}

/**
 * Editor quotation sebagai pratinjau dokumen: /quotations/new?deal= membuat
 * draft, /quotations/[id] mengedit draft dan menampilkan status lain
 * hanya-baca dengan tata letak yang sama.
 */
export function QuotationDocumentPage({
  quotationId = "",
  dealId: initialDealId = "",
}: {
  quotationId?: string;
  dealId?: string;
}) {
  const quotationQuery = useQuotation(quotationId);
  const quotation = quotationQuery.data ?? null;
  const [pickedDealId, setPickedDealId] = useState(initialDealId);
  const dealId = quotation?.deal_id ?? pickedDealId;
  const dealQuery = useDeal(dealId);

  if (quotationId && !quotation) {
    return (
      <div className="py-16 text-center">
        {quotationQuery.isError ? (
          <>
            <p className="text-sm text-muted-foreground">{quotationQuery.error.message}</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href={PIPELINE_PATH}>Kembali ke pipeline</Link>
            </Button>
          </>
        ) : (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label="Memuat quotation" />
        )}
      </div>
    );
  }

  return (
    <QuotationEditor
      key={quotation?.id ?? "new"}
      quotation={quotation}
      dealId={dealId}
      deal={dealQuery.data}
      onPickDeal={setPickedDealId}
    />
  );
}

function QuotationEditor({
  quotation,
  dealId,
  deal,
  onPickDeal,
}: {
  quotation: Quotation | null;
  dealId: string;
  deal: SalesDealDocument | undefined;
  onPickDeal: (dealId: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<QuotationFormValues>(() =>
    quotation ? quotationToForm(quotation) : { ...EMPTY_QUOTATION_FORM, items: [{ ...EMPTY_ITEM_FORM }] }
  );
  const readOnly = quotation !== null && (quotation.status !== "draft" || quotation.stock_deducted_at !== null);

  const companyId = quotation?.company_id ?? deal?.company_id;
  const letterheadQuery = useLetterhead(companyId, Boolean(companyId) || !dealId);
  const productsQuery = useCatalogProducts(!readOnly);
  const products = productsQuery.data ?? [];
  const dealsQuery = useDeals({ q: "", event_type: "" }, quotation === null);
  const createMutation = useCreateQuotation(dealId);
  const updateMutation = useUpdateQuotation();
  const reviseMutation = useReviseQuotation(dealId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const setItem = (index: number, patch: Partial<QuotationItemForm>) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  const addRow = (item_type: QuotationItemForm["item_type"]) =>
    setForm((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM_FORM, item_type }] }));
  const removeRow = (index: number) =>
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  const pickProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    setItem(index, {
      product_id: productId,
      description: product?.name ?? "",
      unit_price:
        product && Number(product.base_price) > 0 ? String(Number(product.base_price)) : form.items[index].unit_price,
    });
  };
  const setTerm = (index: number, patch: Partial<QuotationTermForm>) =>
    setForm((prev) => ({
      ...prev,
      terms: prev.terms.map((term, i) => (i === index ? { ...term, ...patch } : term)),
    }));

  const totals = formTotals(form);
  const discountPercent = Number(form.discount_percent) || 0;
  const incompleteCount = form.items.filter(
    (item) =>
      item.description.trim() === "" || !(Number(item.qty) > 0) || (item.item_type === "produk" && item.product_id === "")
  ).length;
  // Termin opsional; bila diisi: baris lengkap dan total persen tepat 100
  // (validasi yang sama dengan server).
  const termsValid =
    form.terms.length === 0 ||
    (form.terms.every((term) => term.label.trim() !== "" && Number(term.percent) > 0) &&
      Math.abs(termPercentSum(form.terms) - 100) <= 0.01);
  // Baris setengah jadi tidak boleh hilang diam-diam saat disimpan.
  const canSubmit = dealId !== "" && form.items.length > 0 && incompleteCount === 0 && termsValid;
  const hint = !dealId
    ? "Pilih deal dulu."
    : incompleteCount > 0
      ? `${incompleteCount} baris belum lengkap, isi atau hapus dulu.`
      : !termsValid
        ? "Termin belum sah: lengkapi label/persen dan pastikan total 100%."
        : null;

  // "Simpan draft" tetap di dokumen (dokumen baru pindah ke URL-nya sendiri);
  // "Simpan & lanjut" kembali ke deal.
  const save = (andLeave: boolean) => {
    if (!canSubmit || isPending) return;
    const afterSave = (id: string) => {
      if (andLeave) router.push(dealPath(dealId));
      else if (!quotation) router.push(quotationPath(id));
    };
    if (quotation) {
      updateMutation.mutate({ id: quotation.id, values: { form } }, { onSuccess: () => afterSave(quotation.id) });
    } else {
      createMutation.mutate(form, { onSuccess: (body) => afterSave(body.data.id) });
    }
  };

  const dealOptions = (dealsQuery.data ?? []).map((d) => ({
    value: d.id,
    label: d.title,
    description: d.org_name,
  }));
  const eventLabel = deal ? EVENT_TYPE_LABELS[deal.event_type] ?? deal.event_type : "";
  const pic = deal ? [deal.pic_name, deal.pic_title].filter(Boolean).join(", ") : "";

  return (
    <div>
      <PageHeader
        title={quotation ? `Quotation ${quotation.quote_number}` : "Buat Quotation"}
        description={deal ? `${deal.title} · ${deal.org_name}` : "Susun penawaran langsung di atas dokumen."}
        actions={
          <>
            {quotation ? (
              <>
                <Badge className={QUOTATION_STATUS_BADGES[quotation.status]}>
                  {QUOTATION_STATUS_LABELS[quotation.status]}
                </Badge>
                {quotation.version && quotation.version > 1 ? <Badge variant="info">v{quotation.version}</Badge> : null}
                {quotation.approval_status && quotation.approval_status !== "none" ? (
                  <Badge className={APPROVAL_STATUS_BADGES[quotation.approval_status]}>
                    {APPROVAL_STATUS_LABELS[quotation.approval_status]}
                  </Badge>
                ) : null}
              </>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={dealPath(dealId)}>
                <ArrowLeft /> Kembali ke deal
              </Link>
            </Button>
          </>
        }
      />

      {quotation ? null : (
        <DocumentFilterStrip>
          <div className="space-y-1">
            <label htmlFor="q-deal" className="text-xs font-medium text-muted-foreground">
              Deal<RequiredMark />
            </label>
            <Combobox
              id="q-deal"
              options={dealOptions}
              value={dealId}
              onChange={onPickDeal}
              placeholder={dealsQuery.isLoading ? "Memuat deal..." : "Pilih deal..."}
              searchPlaceholder="Cari deal atau instansi..."
              className="h-10 rounded-full bg-card"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Perusahaan</p>
            <p className="flex h-10 items-center rounded-full bg-card px-4 text-sm">{deal?.company_name ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Cabang</p>
            <p className="flex h-10 items-center rounded-full bg-card px-4 text-sm">{deal?.branch_name ?? "—"}</p>
          </div>
        </DocumentFilterStrip>
      )}

      <DocumentSheet aria-label="Dokumen quotation">
        <DocumentLetterhead letterhead={letterheadQuery.data} branchName={deal?.branch_name} />
        <DocumentTitleBand
          title="QUOTATION"
          number={quotation?.quote_number}
          placeholder={dealId ? "Otomatis setelah disimpan" : "Pilih deal dulu"}
        />
        <DocumentInfoGrid
          left={
            <>
              <DocumentInfoRow label="Kepada">
                <DocumentLineText>{deal?.org_name}</DocumentLineText>
              </DocumentInfoRow>
              <DocumentInfoRow label="PIC">
                <DocumentLineText>{pic}</DocumentLineText>
              </DocumentInfoRow>
              <DocumentInfoRow label="Telepon">
                <DocumentLineText>{deal?.pic_phone}</DocumentLineText>
              </DocumentInfoRow>
              <DocumentInfoRow label="Acara">
                <DocumentLineText>{deal ? `${deal.title} (${eventLabel})` : ""}</DocumentLineText>
              </DocumentInfoRow>
            </>
          }
          right={
            <>
              <DocumentInfoRow label="Tanggal acara">
                <DocumentLineText>{formatDate(deal?.event_date, "")}</DocumentLineText>
              </DocumentInfoRow>
              <DocumentInfoRow label="Tanggal penawaran">
                <DocumentLineText>{formatDate(quotation?.created_at ?? new Date())}</DocumentLineText>
              </DocumentInfoRow>
              <DocumentInfoRow label="Berlaku s.d." htmlFor={readOnly ? undefined : "q-valid-until"}>
                {readOnly ? (
                  <DocumentLineText>{formatDate(form.valid_until, "")}</DocumentLineText>
                ) : (
                  <DocumentLineInput
                    id="q-valid-until"
                    type="date"
                    value={form.valid_until}
                    onChange={(e) => setForm((prev) => ({ ...prev, valid_until: e.target.value }))}
                  />
                )}
              </DocumentInfoRow>
            </>
          }
        />

        {readOnly ? null : (
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 sm:px-8">
            <p className="text-xs text-muted-foreground">
              Produk katalog dihitung per pax; item bebas untuk jasa atau biaya lain.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => addRow("produk")}>
                <Plus /> Tambah produk
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => addRow("bebas")}>
                <Plus /> Item bebas
              </Button>
            </div>
          </div>
        )}

        <QuotationItemsTable
          items={form.items}
          products={products}
          readOnly={readOnly}
          onChange={setItem}
          onPickProduct={pickProduct}
          onRemove={removeRow}
        />

        <div className="grid grid-cols-1 gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="space-y-5">
            <div className="space-y-1.5">
              {readOnly ? (
                <>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Catatan</h3>
                  <p className="whitespace-pre-wrap text-sm">{form.notes || "—"}</p>
                </>
              ) : (
                <>
                  <label
                    htmlFor="q-notes"
                    className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Catatan
                  </label>
                  <Textarea
                    id="q-notes"
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    placeholder="Syarat pembayaran, DP, dan lainnya"
                  />
                </>
              )}
            </div>
            <QuotationTermsEditor
              terms={form.terms}
              total={totals.total}
              readOnly={readOnly}
              onUsePreset={() => setForm((prev) => ({ ...prev, terms: DEFAULT_TERMS_PRESET.map((t) => ({ ...t })) }))}
              onAdd={() => setForm((prev) => ({ ...prev, terms: [...prev.terms, { ...EMPTY_TERM_FORM }] }))}
              onChange={setTerm}
              onRemove={(index) => setForm((prev) => ({ ...prev, terms: prev.terms.filter((_, i) => i !== index) }))}
            />
          </div>

          <div className="space-y-2">
            <DocumentSummary label="Ringkasan harga">
              <DocumentSummaryRow label="Subtotal" value={formatRupiah(totals.subtotal)} />
              {readOnly && totals.discount === 0 ? null : (
                <DocumentSummaryRow
                  tone="discount"
                  label={readOnly ? `Diskon ${formatNumber(discountPercent, 2)}%` : "Diskon"}
                  value={`- ${formatRupiah(totals.discount)}`}
                >
                  {readOnly ? null : (
                    <span className="inline-flex items-center gap-1">
                      <NumericInput
                        aria-label="Diskon (%)"
                        value={form.discount_percent === "" ? null : Number(form.discount_percent)}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, discount_percent: String(value) }))}
                        decimalScale={2}
                        max={100}
                        className={`${documentLineClass} h-7 w-16 border-current text-right`}
                      />
                      %
                    </span>
                  )}
                </DocumentSummaryRow>
              )}
              {readOnly && !form.use_ppn ? null : (
                <DocumentSummaryRow
                  tone="tax"
                  label={readOnly ? `PPN ${formatNumber(form.ppn_persen, 2)}%` : "PPN"}
                  value={form.use_ppn ? formatRupiah(totals.ppn) : "—"}
                >
                  {readOnly ? null : (
                    <span className="inline-flex items-center gap-1.5">
                      <Switch
                        aria-label="Pakai PPN"
                        checked={form.use_ppn}
                        onCheckedChange={(checked) => setForm((prev) => ({ ...prev, use_ppn: checked }))}
                      />
                      <NumericInput
                        aria-label="Persentase PPN"
                        value={form.ppn_persen === "" ? null : Number(form.ppn_persen)}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, ppn_persen: String(value) }))}
                        decimalScale={2}
                        max={100}
                        disabled={!form.use_ppn}
                        className={`${documentLineClass} h-7 w-14 border-current text-right`}
                      />
                      %
                    </span>
                  )}
                </DocumentSummaryRow>
              )}
              <DocumentSummaryRow tone="total" label="Total" value={formatRupiah(totals.total)} />
            </DocumentSummary>
            {readOnly ? null : (
              <p className="text-xs text-warning" role="status">
                {discountHint(discountPercent)}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 pb-8 text-sm sm:px-8">
          <p>Hormat kami,</p>
          <p className="mt-10 font-semibold">{deal?.owner_name ?? "Tim Sales"}</p>
        </div>
      </DocumentSheet>

      <DocumentFooterBar hint={readOnly ? null : hint}>
        {quotation ? (
          <Button asChild variant="outline">
            <a href={`/api/sales-funnel/quotations/${quotation.id}/pdf`} target="_blank" rel="noopener noreferrer">
              <FileDown /> Lihat PDF
            </a>
          </Button>
        ) : null}
        {readOnly ? (
          <>
            {quotation && quotation.status !== "superseded" ? (
              <Button
                type="button"
                variant="outline"
                disabled={reviseMutation.isPending}
                onClick={() =>
                  reviseMutation.mutate(quotation.id, {
                    onSuccess: (body) => router.push(quotationPath(body.data.id)),
                  })
                }
              >
                <Copy /> Buat revisi
              </Button>
            ) : null}
            <Button asChild variant="ink">
              <Link href={dealPath(dealId)}>Kembali ke deal</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild variant="ghost">
              <Link href={dealPath(dealId)}>Batal</Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => save(false)} disabled={!canSubmit || isPending}>
              {isPending ? "Menyimpan…" : "Simpan draft"}
            </Button>
            <Button type="button" onClick={() => save(true)} disabled={!canSubmit || isPending}>
              Simpan &amp; lanjut
            </Button>
          </>
        )}
      </DocumentFooterBar>
    </div>
  );
}
