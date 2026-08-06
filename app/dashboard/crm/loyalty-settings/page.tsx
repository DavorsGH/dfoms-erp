import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  LOYALTY_SETTINGS_SELECT,
  type LoyaltySettingsRow,
} from "@/utils/loyalty-types";
import CrmShell from "../crm-shell";
import LoyaltySettingsForm from "./loyalty-settings-form";

export default async function LoyaltySettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("loyalty_settings")
    .select(LOYALTY_SETTINGS_SELECT)
    .maybeSingle();

  return (
    <CrmShell sectionTitle="Loyalty Settings">
      <LoyaltySettingsForm
        initialSettings={(data as LoyaltySettingsRow | null) ?? null}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
