import { requireUser } from "@/lib/auth/require-user";
import { collectNavHrefs, getUserMenus } from "@/lib/iam/get-user-menus";
import { HowToUsePage } from "@/features/dashboard/how-to-use/how-to-use-page";
import { visibleTopics } from "@/features/dashboard/how-to-use/topics";

export const metadata = { title: "How to use" };

export default async function Page() {
  const user = await requireUser();
  const menus = await getUserMenus(user.id, user.role);
  return (
    <div className="p-6">
      <HowToUsePage topics={visibleTopics(collectNavHrefs(menus))} />
    </div>
  );
}
