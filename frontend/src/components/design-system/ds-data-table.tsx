"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import {
  DsCard,
  DsCardContent,
  DsCardDescription,
  DsCardFooter,
  DsCardHeader,
  DsCardTitle,
} from "./ds-card";
import { dsDivider, dsTableHead, dsTableRowHover } from "./tokens";

export type DsColumnAlign = "left" | "center" | "right";

export interface DsDataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  align?: DsColumnAlign;
  className?: string;
  headerClassName?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

const alignClass: Record<DsColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

type VisiblePage = number | "ellipsis-left" | "ellipsis-right";

function getVisiblePages(page: number, totalPages: number): VisiblePage[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: VisiblePage[] = [1];
  if (page > 4) pages.push("ellipsis-left");
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let current = start; current <= end; current += 1) pages.push(current);
  if (page < totalPages - 3) pages.push("ellipsis-right");
  pages.push(totalPages);
  return pages;
}

export interface DsDataTablePaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function DsDataTablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: DsDataTablePaginationProps) {
  const normalizedTotalPages = Math.max(1, totalPages);
  const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-gray-500">
        Menampilkan {rangeStart}-{rangeEnd} dari {totalItems} item
      </p>
      <Pagination currentPage={page} totalPages={normalizedTotalPages} className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationLink
              aria-label="Halaman sebelumnya"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              className={page === 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
            >
              <ChevronLeft className="h-4 w-4" />
            </PaginationLink>
          </PaginationItem>
          {getVisiblePages(page, normalizedTotalPages).map((visiblePage) =>
            typeof visiblePage === "number" ? (
              <PaginationItem key={visiblePage}>
                <PaginationLink
                  isActive={visiblePage === page}
                  onClick={() => onPageChange(visiblePage)}
                  className="cursor-pointer"
                >
                  {visiblePage}
                </PaginationLink>
              </PaginationItem>
            ) : (
              <PaginationItem key={visiblePage}>
                <PaginationEllipsis />
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationLink
              aria-label="Halaman berikutnya"
              onClick={() => onPageChange(Math.min(normalizedTotalPages, page + 1))}
              className={
                page === normalizedTotalPages ? "pointer-events-none opacity-40" : "cursor-pointer"
              }
            >
              <ChevronRight className="h-4 w-4" />
            </PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

export interface DsDataTableProps<T> {
  columns: DsDataTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  title?: string;
  description?: string;
  toolbar?: React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  loadingRows?: number;
  onRowClick?: (row: T) => void;
  pagination?: DsDataTablePaginationProps;
  className?: string;
  tableClassName?: string;
  stickyHeader?: boolean;
}

export function DsDataTable<T>({
  columns,
  data,
  rowKey,
  title,
  description,
  toolbar,
  loading = false,
  emptyMessage = "Tidak ada data.",
  loadingRows = 5,
  onRowClick,
  pagination,
  className,
  tableClassName,
  stickyHeader = false,
}: DsDataTableProps<T>) {
  const showHeader = Boolean(title || description || toolbar);

  return (
    <DsCard className={cn("gap-0 py-0", className)} flush>
      {showHeader ? (
        <DsCardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title ? <DsCardTitle>{title}</DsCardTitle> : null}
            {description ? <DsCardDescription>{description}</DsCardDescription> : null}
          </div>
          {toolbar}
        </DsCardHeader>
      ) : null}

      <DsCardContent className="px-0 py-0">
        <div className="overflow-x-auto px-4">
          <table className={cn("w-full min-w-full text-sm", tableClassName)}>
            <thead className={cn(dsTableHead, stickyHeader && "sticky top-0 z-10")}>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      "px-4 py-3 font-semibold whitespace-nowrap",
                      alignClass[col.align ?? "left"],
                      col.headerClassName
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y", dsDivider)}>
              {loading
                ? Array.from({ length: loadingRows }).map((_, rowIndex) => (
                    <tr key={`loading-${rowIndex}`}>
                      {columns.map((col) => (
                        <td key={col.id} className="px-4 py-3">
                          <Skeleton className="h-4 w-full max-w-[12rem]" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data.length === 0
                  ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="px-4 py-10 text-center text-sm text-gray-500"
                      >
                        {emptyMessage}
                      </td>
                    </tr>
                  )
                  : data.map((row, index) => (
                    <tr
                      key={rowKey(row, index)}
                      className={cn(dsTableRowHover, onRowClick && "cursor-pointer")}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(
                            "px-4 py-3 align-middle whitespace-nowrap",
                            alignClass[col.align ?? "left"],
                            col.className
                          )}
                        >
                          {col.cell(row, index)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </DsCardContent>

      {pagination ? (
        <DsCardFooter className="px-0 py-0">
          <DsDataTablePagination {...pagination} />
        </DsCardFooter>
      ) : null}
    </DsCard>
  );
}
