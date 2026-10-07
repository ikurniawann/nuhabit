import { UserDetailPage } from "@/features/users";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <UserDetailPage params={params} />;
}
