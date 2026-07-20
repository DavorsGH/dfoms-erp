import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  BILLING_SETTINGS_HEADER_SELECT,
  type BillingSettingsHeaderFields,
} from "@/utils/billing-settings-types";

export const getCurrentTenantBillingSettingsHeader = cache(
  async (): Promise<BillingSettingsHeaderFields | null> => {
    const tenantId = await getCurrentUserTenantId();
    if (!tenantId) {
      return null;
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await supabase
      .from("billing_settings")
      .select(BILLING_SETTINGS_HEADER_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as BillingSettingsHeaderFields;
  },
);
