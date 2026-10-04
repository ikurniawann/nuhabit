"use client";

import { Button } from "@/components/ui/button";
import type { paginate } from "../order-list-rules";

const PAGE_SIZES = [25, 50, 100];

export function OrdersPagination({
  total,
  paged,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  paged: Pick<ReturnType<typeof paginate>, "currentPage" | "pageCount" | "firstIndex" | "lastIndex">;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const { currentPage, pageCount } = paged;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/70 pt-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Baris per halaman</span>
        <select
          aria-label="Baris per halaman"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded-md border border-gray-200/80 bg-white px-2 text-sm"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span>
          {paged.firstIndex}–{paged.lastIndex} dari {total} tagihan
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Sebelumnya
        </Button>
        <span className="text-sm text-muted-foreground">
          Hal {currentPage} / {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
