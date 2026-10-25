import { redirect } from "next/navigation";

/** /coach (alamat yang dipakai klien) → Kelas Saya, membawa ?tab bila ada. */
export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  const query = typeof tab === "string" && tab ? `?tab=${encodeURIComponent(tab)}` : "";
  redirect(`/dashboard/gym/my-classes${query}`);
}
