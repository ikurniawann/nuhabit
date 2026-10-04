"use client";

import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Send,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ORG_TYPE_LABELS } from "../../leads/types";
import { QuotationSection } from "../../quotations";
import { DealTeamSection } from "./deal-team-section";
import { InvoiceSection } from "./invoice-section";
import { PaymentSection } from "./payment-section";
import {
  useActivities,
  useCreateActivity,
  useDeleteActivity,
  useSendDealWa,
  useUpdateActivity,
  useWaTemplates,
} from "../../activities/queries";
import {
  ACTIVITY_TYPE_LABELS,
  EMPTY_ACTIVITY_FORM,
  isOverdue,
  type ActivityFormValues,
  type ActivityType,
  type SalesActivity,
} from "../../activities/types";
import { EVENT_TYPE_LABELS, formatEventDate, formatRupiahOrDash, type SalesDeal } from "../types";

const TYPE_ICON: Record<ActivityType, typeof Phone> = {
  telepon: Phone,
  wa: MessageCircle,
  meeting: Users,
  catatan: StickyNote,
};

interface DealDetailDialogProps {
  deal: SalesDeal | null;
  onClose: () => void;
  onEdit: (deal: SalesDeal) => void;
}

export function DealDetailDialog({ deal, onClose, onEdit }: DealDetailDialogProps) {
  const open = deal !== null;
  const dealId = deal?.id ?? "";

  const [form, setForm] = useState<ActivityFormValues>(EMPTY_ACTIVITY_FORM);
  const [templateId, setTemplateId] = useState("");
  const [waMessage, setWaMessage] = useState("");

  const activitiesQuery = useActivities({ deal_id: dealId }, open);
  const templatesQuery = useWaTemplates(open);
  const createMutation = useCreateActivity(() => setForm(EMPTY_ACTIVITY_FORM));
  const updateMutation = useUpdateActivity();
  const deleteMutation = useDeleteActivity();
  const sendWaMutation = useSendDealWa(() => {
    setTemplateId("");
    setWaMessage("");
  });

  const activities = activitiesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const selectedTemplate = templates.find((t) => t.id === templateId);

  const setField = <K extends keyof ActivityFormValues>(
    key: K,
    value: ActivityFormValues[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleAddActivity = () => {
    if (!deal || createMutation.isPending) return;
    if (!form.notes.trim() && !form.due_at) return;
    createMutation.mutate({ parent: { deal_id: deal.id }, values: form });
  };

  const handleSendWa = () => {
    if (!deal || sendWaMutation.isPending) return;
    if (!templateId && !waMessage.trim()) return;
    sendWaMutation.mutate({
      dealId: deal.id,
      payload: templateId
        ? { template_id: templateId }
        : { message: waMessage.trim() },
    });
  };

  const toggleDone = (activity: SalesActivity) => {
    updateMutation.mutate({
      id: activity.id,
      values: { is_done: !activity.done_at },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPanel size="2xl" className="h-[min(88vh,900px)]">
        {deal ? (
          <>
            <DialogPanelHeader className="flex-row items-start justify-between gap-3">
              <div>
                <DialogPanelTitle className="text-lg">{deal.title}</DialogPanelTitle>
                <p className="mt-0.5 text-sm text-gray-500">
                  <Link
                    href={`/dashboard/sales-funnel/leads/${deal.lead_id}`}
                    className="hover:text-pink-600 hover:underline"
                  >
                    {deal.org_name}
                  </Link>{" "}
                  · {ORG_TYPE_LABELS[deal.org_type]}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onEdit(deal)}
                className="h-8 shrink-0 gap-1.5 rounded-lg"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </DialogPanelHeader>

            <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-2 lg:divide-x lg:divide-gray-100 lg:overflow-hidden">
              {/* ── Kolom kiri: ringkasan, quotation, pembayaran ── */}
              <div className="lg:h-full lg:overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-b border-gray-100 px-6 py-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-400">Jenis Acara</p>
                    <p className="text-gray-900">{EVENT_TYPE_LABELS[deal.event_type]}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Tanggal Acara</p>
                    <p className="inline-flex items-center gap-1 text-gray-900">
                      <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                      {formatEventDate(deal) ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Nilai</p>
                    <p className="font-semibold text-gray-900">
                      {formatRupiahOrDash(deal.value_final ?? deal.value_estimate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Estimasi Pax</p>
                    <p className="text-gray-900">{deal.pax_estimate ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">PIC</p>
                    <p className="inline-flex items-center gap-1.5 text-gray-900">
                      {deal.pic_name}
                      <a
                        href={`https://wa.me/${deal.pic_phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Chat WA"
                        className="text-emerald-600 hover:text-emerald-700"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Penanggung Jawab</p>
                    <p className="text-gray-900">{deal.owner_name ?? "—"}</p>
                  </div>
                </div>

                {/* ── Quotation (Fase F1) ── */}
                <DealTeamSection dealId={deal.id} enabled={open} ownerUserId={deal.owner_user_id} />
                <QuotationSection dealId={deal.id} enabled={open} />

                {/* ── Invoice dari kesepakatan termin ── */}
                <InvoiceSection dealId={deal.id} enabled={open} />

                {/* ── Pembayaran per invoice + progress pelunasan (Fase G) ── */}
                <PaymentSection dealId={deal.id} enabled={open} />
              </div>

              {/* ── Kolom kanan: WA, aktivitas, timeline ── */}
              <div className="lg:h-full lg:overflow-y-auto">
                <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
                  <p className="text-sm font-semibold text-gray-900">
                    Kirim WA ke {deal.pic_name}
                  </p>
                  <Select
                    value={templateId || "custom"}
                    onValueChange={(v) => setTemplateId(v === "custom" ? "" : v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Pilih template..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Tulis pesan sendiri</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate ? (
                    <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      {selectedTemplate.body}
                    </p>
                  ) : (
                    <Textarea
                      value={waMessage}
                      onChange={(e) => setWaMessage(e.target.value)}
                      placeholder="Tulis pesan untuk PIC..."
                      rows={2}
                      className="text-sm"
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSendWa}
                    disabled={
                      sendWaMutation.isPending || (!templateId && !waMessage.trim())
                    }
                    className="h-9 gap-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {sendWaMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Kirim via Gateway
                  </Button>
                </div>

                {/* ── Tambah aktivitas ── */}
                <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
                  <p className="text-sm font-semibold text-gray-900">Catat Aktivitas</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={form.activity_type}
                      onValueChange={(v) => setField("activity_type", v as ActivityType)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ACTIVITY_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="datetime-local"
                      value={form.due_at}
                      onChange={(e) => setField("due_at", e.target.value)}
                      className="h-9 text-sm"
                      title="Jatuh tempo follow-up (kosongkan bila hanya catatan)"
                    />
                  </div>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    placeholder="Hasil telepon, rencana follow-up, dsb."
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <Checkbox
                        checked={form.is_done}
                        onCheckedChange={(checked) =>
                          setField("is_done", checked === true)
                        }
                      />
                      Sudah selesai (tanpa pengingat)
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddActivity}
                      disabled={
                        createMutation.isPending ||
                        (!form.notes.trim() && !form.due_at)
                      }
                      className="h-9 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
                    >
                      {createMutation.isPending ? "Menyimpan…" : "Simpan"}
                    </Button>
                  </div>
                </div>

                {/* ── Timeline ── */}
                <div className="px-6 py-4">
                  <p className="mb-3 text-sm font-semibold text-gray-900">
                    Timeline Aktivitas
                  </p>
                  {activitiesQuery.isLoading ? (
                    <div className="py-8 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
                    </div>
                  ) : activities.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">
                      Belum ada aktivitas — catat kontak pertama di atas.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {activities.map((activity) => {
                        const Icon = TYPE_ICON[activity.activity_type];
                        const overdue = isOverdue(activity);
                        return (
                          <li
                            key={activity.id}
                            className={`rounded-xl border p-3 ${
                              overdue
                                ? "border-red-200 bg-red-50/60"
                                : "border-gray-200/80 bg-white"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => toggleDone(activity)}
                                title={
                                  activity.done_at ? "Tandai belum selesai" : "Tandai selesai"
                                }
                                className="mt-0.5 shrink-0"
                              >
                                {activity.done_at ? (
                                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                ) : (
                                  <Circle className="h-5 w-5 text-gray-300 hover:text-pink-500" />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                                    <Icon className="mr-1 h-3 w-3" />
                                    {ACTIVITY_TYPE_LABELS[activity.activity_type]}
                                  </Badge>
                                  {activity.due_at ? (
                                    <span
                                      className={`text-xs ${
                                        overdue ? "font-semibold text-red-600" : "text-gray-500"
                                      }`}
                                    >
                                      {overdue ? "Terlambat · " : "Jatuh tempo · "}
                                      {formatDateTime(activity.due_at)}
                                    </span>
                                  ) : null}
                                  {activity.reminder_sent_at ? (
                                    <span className="text-xs text-emerald-600">
                                      ✓ diingatkan
                                    </span>
                                  ) : null}
                                </div>
                                {activity.notes ? (
                                  <p
                                    className={`mt-1 whitespace-pre-wrap text-sm ${
                                      activity.done_at
                                        ? "text-gray-400 line-through"
                                        : "text-gray-700"
                                    }`}
                                  >
                                    {activity.notes}
                                  </p>
                                ) : null}
                                <p className="mt-1 text-xs text-gray-400">
                                  {activity.owner_name ?? "Tanpa PJ"} ·{" "}
                                  {formatDateTime(activity.created_at)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteMutation.mutate(activity.id)}
                                title="Hapus aktivitas"
                                className="shrink-0 text-gray-300 hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
