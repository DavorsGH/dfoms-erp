import "server-only";

import { logSystemEvent } from "@/lib/system-event-log";
import { createAdminClient } from "@/utils/supabase/admin";
import { notifyTenantAdminsAndDirectors } from "@/utils/tenant-admin-director-notifications";
import {
  generateSupplierContractAccountsPayableCore,
  type GenerateSupplierContractApResult,
} from "@/utils/supplier-contract-ap-generation-core";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GenerateSupplierContractApOptions = {
  asOf?: Date | string;
  admin?: SupabaseClient;
  tenantId?: string;
};

export type { GenerateSupplierContractApResult };

export async function generateSupplierContractAccountsPayable(
  options: GenerateSupplierContractApOptions = {},
): Promise<GenerateSupplierContractApResult> {
  const admin = options.admin ?? createAdminClient();
  const result = await generateSupplierContractAccountsPayableCore({
    admin,
    asOf: options.asOf,
    tenantId: options.tenantId,
    onApCreated: async (contract, billingMonthStart) => {
      await notifyTenantAdminsAndDirectors(
        contract.tenant_id,
        "Supplier contract AP generated",
        `Accounts payable created for ${contract.supplier_name} (${contract.contract_number}) — ${billingMonthStart.slice(0, 7)}.`,
        "/dashboard/finance/accounts-payable",
      );
    },
    onMidMonthReminder: async (contract) => {
      await notifyTenantAdminsAndDirectors(
        contract.tenant_id,
        "Mid-month payment decision",
        `Mid-month payment decision for ${contract.supplier_name}, ${contract.contract_number}.`,
        `/dashboard/finance/supplier-contracts/${contract.id}`,
      );
    },
  });

  await logSystemEvent({
    eventType: "cron",
    eventName: "generate-supplier-contract-ap",
    status: result.errors > 0 ? "warning" : "success",
    message: `created ${result.created}, skipped ${result.skipped}, errors ${result.errors}, reminders ${result.reminders}`,
    metadata: {
      asOfDate: result.asOfDate,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      reminders: result.reminders,
    },
  });

  return result;
}
