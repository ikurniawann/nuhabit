import { cn } from "@/lib/utils";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/** Foto coach, atau inisialnya bila belum ada foto. */
export function CoachAvatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto unggahan lokal /api/files atau URL lama
      <img src={url} alt={name} className={cn("size-10 shrink-0 rounded-full bg-surface object-cover", className)} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-on-ink",
        className
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}
