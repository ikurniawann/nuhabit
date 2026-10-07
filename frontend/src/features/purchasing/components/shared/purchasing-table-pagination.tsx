"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";

type VisiblePage = number | "ellipsis-left" | "ellipsis-right";

function getVisiblePages(page: number, totalPages: number): VisiblePage[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: VisiblePage[] = [1];

  if (page > 4) {
    pages.push("ellipsis-left");
  }

  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  for (let current = start; current <= end; current += 1) {
    pages.push(current);
  }

  if (page < totalPages - 3) {
    pages.push("ellipsis-right");
  }

  pages.push(totalPages);
  return pages;
}

type PurchasingTablePaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

export function PurchasingTablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PurchasingTablePaginationProps) {
  const normalizedTotalPages = Math.max(1, totalPages);
  const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalItems);

  return (
    <div className="border-t border-gray-100">
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
                className={page === normalizedTotalPages ? "pointer-events-none opacity-40" : "cursor-pointer"}
              >
                <ChevronRight className="h-4 w-4" />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
