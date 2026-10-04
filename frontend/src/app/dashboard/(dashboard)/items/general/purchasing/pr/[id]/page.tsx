import { GeneralPRDetailPage } from "@/features/purchasing/general-pr";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function Page({ params }: PageProps) {
  return <GeneralPRDetailPage params={params} />;
}
