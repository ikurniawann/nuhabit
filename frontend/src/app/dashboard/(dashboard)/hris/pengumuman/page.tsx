import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { AnnouncementsPage } from "@/features/hris/announcements";

// HRIS → Kepegawaian → Pengumuman: CMS pengumuman perusahaan.
export default async function HrisPengumumanPage() {
  await requireIamPage(IAM.hrisKepegawaian);
  return <AnnouncementsPage />;
}
