export type JobOpeningContext = {
  title: string;
  description: string | null;
  requirements: string | null;
};

export type PositionContext = {
  title: string;
  department: string | null;
  level: string | null;
};

/**
 * Konteks pekerjaan untuk analisis CV: lowongan (paling lengkap) dulu,
 * fallback ke master posisi; null bila keduanya tidak ada.
 */
export function formatJobContext(job: JobOpeningContext | null, position: PositionContext | null): string | null {
  if (job) {
    return [
      `Posisi: ${job.title}`,
      job.description ? `Deskripsi: ${job.description}` : null,
      job.requirements ? `Persyaratan: ${job.requirements}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (position) {
    const dept = position.department ? ` — Departemen ${position.department}` : "";
    const level = position.level ? ` (level ${position.level})` : "";
    return `Posisi: ${position.title}${dept}${level}`;
  }
  return null;
}
