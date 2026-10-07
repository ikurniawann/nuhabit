import { parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import { LEAD_IMPORT_COLUMNS } from "./lead-import-config";

export const LEAD_SPREADSHEET_HEADERS = LEAD_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  org_name: "nama_instansi",
  instansi: "nama_instansi",
  company: "nama_instansi",
  org_type: "jenis_instansi",
  jenis: "jenis_instansi",
  pic_name: "nama_pic",
  pic: "nama_pic",
  contact_person: "nama_pic",
  pic_title: "jabatan_pic",
  jabatan: "jabatan_pic",
  pic_phone: "wa_pic",
  phone: "wa_pic",
  no_wa: "wa_pic",
  telepon: "wa_pic",
  pic_email: "email_pic",
  email: "email_pic",
  city: "kota",
  source: "sumber",
  temperature: "suhu",
  notes: "catatan",
  keterangan: "catatan",
};

export function normalizeLeadSpreadsheetHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

function parseCsvMatrix(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) {
          cells.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    });
}

/** Parse file CSV/XLSX menjadi matriks string (baris pertama = header). */
export async function parseLeadSpreadsheetFile(
  buffer: Buffer,
  fileName: string
): Promise<string[][]> {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvMatrix(buffer.toString("utf-8"));
  }
  return parseXlsxToMatrix(buffer);
}
