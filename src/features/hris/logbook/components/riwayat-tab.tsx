"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { useLogbookEntries } from "../queries";
import { useUpdateLogbookEntryStatus } from "../mutations";
import type { LogbookCurrentUser, LogbookEntry } from "../types";
import { LogbookEntryChecklist } from "./entry-checklist";
import { LogbookStatusBadge, LOGBOOK_STATUS_LABELS } from "./logbook-status";
import { LogbookQueryError } from "./query-error";

const PAGE_SIZE = 20;

/** Tab Riwayat — tabel berpagination + dialog detail + aksi review. */
export function LogbookRiwayatTab({
  me,
  departmentId,
}: {
  me: LogbookCurrentUser | null;
  departmentId: string;
}) {
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  const params = useMemo(
    () => ({
      department_id: departmentId || undefined,
      status: status === "all" ? undefined : status,
      from: from || undefined,
      to: to || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [departmentId, status, from, to, page]
  );
  const entriesQuery = useLogbookEntries(params);
  const entries = entriesQuery.data?.data ?? [];
  const count = entriesQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const detail = entries.find((entry) => entry.id === detailId) || null;

  const updateStatusMutation = useUpdateLogbookEntryStatus();

  async function review(entry: LogbookEntry, verdict: "reviewed" | "rejected") {
    try {
      await updateStatusMutation.mutateAsync({
        action: "review-entry",
        entry_id: entry.id,
        status: verdict,
        review_notes: reviewNotes || undefined,
      });
      setReviewNotes("");
      toast.success(verdict === "reviewed" ? "Logbook ditandai direview" : "Logbook ditolak");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan review");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter Riwayat</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[200px_180px_180px_auto]">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(LOGBOOK_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Dari</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label>Sampai</Label>
            <Input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => {
                setStatus("all");
                setFrom("");
                setTo("");
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {entriesQuery.isError ? (
            <LogbookQueryError error={entriesQuery.error} />
          ) : entriesQuery.isLoading ? (
            <SkeletonTable rows={5} columns={7} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Judul</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Selesai</TableHead>
                    <TableHead className="text-right">KPI</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Tidak ada logbook pada filter ini.
                      </TableCell>
                    </TableRow>
                  )}
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{entry.entry_date}</TableCell>
                      <TableCell className="font-medium">{entry.title}</TableCell>
                      <TableCell>{entry.department?.name ?? "-"}</TableCell>
                      <TableCell>
                        <LogbookStatusBadge status={entry.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.completion_percentage || 0}%
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.kpi_score || 0}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDetailId(entry.id)}
                        >
                          <Eye className="mr-1 h-3 w-3" /> Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {count} logbook · halaman {page} dari {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetailId("")}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detail Logbook</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <LogbookEntryChecklist entry={detail} canEdit={false} />
              {me?.can_review && detail.status === "submitted" && (
                <div className="space-y-2 border-t pt-4">
                  <Label>Catatan Review (opsional)</Label>
                  <Textarea
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                    placeholder="Catatan untuk kepala department..."
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => review(detail, "reviewed")}
                      disabled={updateStatusMutation.isPending}
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Tandai Direview
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => review(detail, "rejected")}
                      disabled={updateStatusMutation.isPending}
                    >
                      <XCircle className="mr-1 h-3 w-3" /> Tolak
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
