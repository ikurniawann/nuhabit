export default function Loading() {
  return (
    <div className="space-y-6 motion-safe:animate-pulse">
      {/* Header skeleton */}
      <div className="h-8 w-64 bg-muted rounded-lg" />

      {/* Stats skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 bg-muted rounded-xl" />
        ))}
      </div>

      {/* Card skeleton */}
      <div className="bg-card rounded-xl shadow-sm border border-border p-6">
        <div className="h-5 w-40 bg-muted rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
