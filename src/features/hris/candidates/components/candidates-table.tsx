"use client";

import Link from "next/link";
import { Trash2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { CANDIDATE_STATUS_BADGES, CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";
import { CANDIDATE_SOURCE_LABELS, pageWindow } from "@/lib/recruitment/candidate-query";
import type { CandidateRow } from "../types";

const sourceLabel = (source: string) =>
  CANDIDATE_SOURCE_LABELS[source as keyof typeof CANDIDATE_SOURCE_LABELS] ?? source;

interface CandidatesTableProps {
  candidates: CandidateRow[];
  loading: boolean;
  /** Nomor urut baris pertama (halaman × per halaman). */
  offset: number;
  onDelete: (candidate: CandidateRow) => void;
}

function StatusBadge({ status, className = "" }: { status: CandidateRow["status"]; className?: string }) {
  return <Badge className={`${CANDIDATE_STATUS_BADGES[status]} ${className}`}>{CANDIDATE_STATUS_LABELS[status]}</Badge>;
}

/** Tabel (desktop) dan kartu (mobile) daftar kandidat. */
export function CandidatesTable({ candidates, loading, offset, onDelete }: CandidatesTableProps) {
  const emptyText = loading ? "Memuat..." : candidates.length === 0 ? "Tidak ada kandidat ditemukan" : null;

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">No</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Posisi</TableHead>
              <TableHead>Outlet</TableHead>
              <TableHead>Sumber</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead className="w-20">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emptyText ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              candidates.map((c, index) => (
                <TableRow key={c.id} className="hover:bg-gray-50">
                  <TableCell className="text-center text-gray-500 text-sm">{offset + index + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-gray-500 text-xs">{c.email}</p>
                  </TableCell>
                  <TableCell className="text-gray-700">{c.positions?.title ?? "-"}</TableCell>
                  <TableCell className="text-gray-700">{c.brands?.name ?? "-"}</TableCell>
                  <TableCell className="text-gray-700">{sourceLabel(c.source)}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-gray-500 text-xs">{formatDate(c.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Link href={`/dashboard/hris/candidates/${c.id}`}>
                        <Button variant="ghost" size="sm" title="Detail">
                          <User className="w-4 h-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => onDelete(c)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden divide-y divide-gray-100">
        {emptyText ? (
          <div className="p-6 text-center text-gray-500">{emptyText}</div>
        ) : (
          candidates.map((c) => (
            <div key={c.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{c.full_name}</p>
                  <p className="text-gray-500 text-xs truncate">{c.email}</p>
                </div>
                <StatusBadge status={c.status} className="flex-shrink-0" />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{c.positions?.title ?? "-"}</span>
                <span>{c.brands?.name ?? "-"}</span>
                <span>{sourceLabel(c.source)}</span>
                <span>{formatDate(c.created_at)}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <Link href={`/dashboard/hris/candidates/${c.id}`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full text-xs h-8">
                    <User className="w-3.5 h-3.5 mr-1" />
                    Detail
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                  onClick={() => onDelete(c)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

interface CandidatesPaginationProps {
  page: number;
  perPage: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

export function CandidatesPagination({ page, perPage, totalCount, onPageChange }: CandidatesPaginationProps) {
  const totalPages = Math.ceil(totalCount / perPage);
  if (totalPages <= 1) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="text-sm text-gray-500">
        Menampilkan {(page - 1) * perPage + 1} - {Math.min(page * perPage, totalCount)} dari {totalCount} kandidat
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="h-8 w-8 p-0"
        >
          ←
        </Button>
        {pageWindow(page, totalPages).map((pageNum) => (
          <Button
            key={pageNum}
            variant={pageNum === page ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(pageNum)}
            className={`h-8 w-8 p-0 text-xs ${pageNum === page ? "bg-pink-600 hover:bg-pink-700" : ""}`}
          >
            {pageNum}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="h-8 w-8 p-0"
        >
          →
        </Button>
      </div>
    </div>
  );
}
