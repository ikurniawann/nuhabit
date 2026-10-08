import type { AreaSuggestion } from "./area-search";

/** Dropdown saran area di bawah input pencarian (parent harus `relative`). */
export function AreaSuggestions({
  areas,
  onSelect,
  id,
}: {
  areas: AreaSuggestion[];
  onSelect: (area: AreaSuggestion) => void;
  id?: string;
}) {
  if (areas.length === 0) return null;
  return (
    <div id={id} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-forest/15 bg-white p-1 shadow-xl">
      {areas.map((area) => (
        <button
          key={area.id}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onSelect(area)}
          className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-forest hover:bg-[#f5f7f3] focus:bg-[#f5f7f3] focus:outline-none"
        >
          {area.label}
          {area.postalCode ? ` (${area.postalCode})` : ""}
        </button>
      ))}
    </div>
  );
}
