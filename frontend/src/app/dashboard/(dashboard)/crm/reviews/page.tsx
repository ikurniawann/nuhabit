import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { CrmReviewsPage } from "@/features/crm/reviews";

export default async function ReviewsPage() {
  await requireIamPage(IAM.crmReviews);
  return <CrmReviewsPage />;
}
