import { ImagePlus, X } from "lucide-react";
import { useT } from "../../lib/i18n";

/** Up to two activity photos: thumbnails with a remove button, then an add tile. */
export function PhotoField({
  photos,
  onAdd,
  onRemove,
}: {
  photos: string[];
  onAdd: (file: File | undefined) => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  return (
    <div>
      <label className="nh-label">
        {t("Photos")} ({photos.length}/2)
      </label>
      <div className="flex gap-2">
        {photos.map((p, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p}
              alt=""
              className="h-20 w-20 rounded-xl object-cover"
            />
            <button
              onClick={() => onRemove(i)}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-nh-ink p-1 text-white"
              aria-label={t("Remove photo")}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < 2 ? (
          <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-nh-line text-nh-muted">
            <ImagePlus size={22} />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onAdd(e.target.files?.[0])}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
