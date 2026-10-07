import type { AreaSuggestion } from "./area-search";

/** Dropdown saran area di bawah input pencarian (parent harus `relative`). */
export function AreaSuggestions({
  areas,
  onSelect,
}: {
  areas: AreaSuggestion[];
  onSelect: (area: AreaSuggestion) => void;
}) {
  if (areas.length === 0) return null;
  return (
    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      {areas.map((area) => (
        <button
          key={area.id}
          type="button"
          onClick={() => onSelect(area)}
          className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-pink-50"
        >
          {area.label}
          {area.postalCode ? ` (${area.postalCode})` : ""}
        </button>
      ))}
    </div>
  );
}
