import { requireUser } from "@/lib/auth/require-user";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { QueueBoardPage } from "@/features/pos/queue-board";

// TV antrian customer: di LUAR /dashboard/pos supaya tanpa sidebar/navbar.
export default async function Page() {
  await requireUser();
  const settings = await getSettings([SETTING_KEYS.COMPANY_LEGAL_NAME]);
  return (
    <>
      <QueueBoardPage venueName={settings[SETTING_KEYS.COMPANY_LEGAL_NAME]} />
    </>
  );
}
