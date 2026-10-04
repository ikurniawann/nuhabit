import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonTableProps {
  columns: number;
  rows?: number;
  showHeader?: boolean;
}

export function SkeletonTable({ 
  columns, 
  rows = 5, 
  showHeader = true 
}: SkeletonTableProps) {
  return (
    <div className="space-y-3">
      {/* Header skeleton */}
      {showHeader && (
        <div className="flex gap-3 px-4 py-3 bg-muted/50 rounded-t-lg">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton 
              key={`header-${i}`} 
              className={`h-5 ${i === 0 ? 'flex-[2]' : 'flex-1'}`} 
            />
          ))}
        </div>
      )}
      
      {/* Row skeletons */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div 
            key={`row-${rowIndex}`}
            className="flex gap-3 px-4 py-4 items-center"
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton 
                key={`cell-${rowIndex}-${colIndex}`}
                className={`h-4 ${colIndex === 0 ? 'flex-[2]' : 'flex-1'}`}
              />
            ))}
          </div>
        ))}
      </div>
      
      {/* Pagination skeleton */}
      <div className="flex justify-between items-center px-4 py-3 border-t">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
    </div>
  );
}

// Skeleton untuk card/stat
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`space-y-3 p-6 border rounded-lg ${className}`}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

// Skeleton untuk form
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32 mt-4" />
    </div>
  );
}
