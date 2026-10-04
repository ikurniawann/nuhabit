export interface CsvColumn<T> {
  /** Nama kolom, atau path bertitik untuk nilai bersarang (mis. "raw_material.nama"). */
  key: keyof T | string;
  label: string;
  // Sintaks method: pemanggil boleh mengetik parameter lebih sempit (mis. `v: string`).
  format?(value: unknown, row: T): string;
}

function readValue<T extends object>(row: T, key: keyof T | string): unknown {
  if (typeof key === "string" && key.includes(".")) {
    return key
      .split(".")
      .reduce<unknown>((obj, part) => (obj as Record<string, unknown> | null | undefined)?.[part], row);
  }
  return row[key as keyof T];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return `"${value.toISOString().split("T")[0]}"`;
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Ubah array objek menjadi teks CSV (header = label kolom). */
export function convertToCSV<T extends object>(data: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((col) => `"${col.label}"`).join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const value = readValue(row, col.key);
        return col.format ? `"${col.format(value, row)}"` : csvCell(value);
      })
      .join(",")
  );
  return [header, ...rows].join("\n");
}

/** Unduh teks CSV sebagai berkas di browser. */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
