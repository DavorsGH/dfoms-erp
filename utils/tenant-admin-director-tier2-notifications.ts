import "server-only";

import { formatGHS } from "@/app/dashboard/finance/accounts-payable-utils";
import { getCurrentUserNotificationLabel } from "@/utils/current-user";
import {
  maybeNotifyLargeProductSale,
  notifyTenantAdminsAndDirectors,
  notifyTenantAdminsAndDirectorsSms,
} from "@/utils/tenant-admin-director-notifications";
import { createAdminClient } from "@/utils/supabase/admin";

function formatLeaveDateRange(startDate: string, endDate: string): string {
  const format = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  if (startDate === endDate) {
    return format(startDate);
  }

  return `${format(startDate)} – ${format(endDate)}`;
}

export async function notifyAdminsDirectorsNewQuotation(
  tenantId: string,
  billToName: string | null | undefined,
  totalAmount: number,
): Promise<void> {
  const clientLabel = billToName?.trim() || "Customer";
  await notifyTenantAdminsAndDirectors(
    tenantId,
    "New quotation generated",
    `${clientLabel}, ${formatGHS(totalAmount)}`,
    "/dashboard/sales-crm/quotations",
  );
}

export async function notifyAdminsDirectorsNewInvoice(
  tenantId: string,
  billToName: string | null | undefined,
  totalAmount: number,
): Promise<void> {
  const clientLabel = billToName?.trim() || "Customer";
  await notifyTenantAdminsAndDirectors(
    tenantId,
    "New invoice generated",
    `${clientLabel}, ${formatGHS(totalAmount)}`,
    "/dashboard/finance/client-invoices",
  );
}

export async function notifyAdminsDirectorsQuotationSent(
  tenantId: string,
  quotationNumber: string,
  billToName: string | null | undefined,
  totalAmount: number,
): Promise<void> {
  const clientLabel = billToName?.trim() || "Customer";
  await notifyTenantAdminsAndDirectors(
    tenantId,
    "Quotation sent to customer",
    `${clientLabel}, ${quotationNumber}, ${formatGHS(totalAmount)}`,
    "/dashboard/sales-crm/quotations",
  );
}

export async function notifyAdminsDirectorsInvoiceSent(
  tenantId: string,
  invoiceNumber: string,
  billToName: string | null | undefined,
  totalAmount: number,
): Promise<void> {
  const clientLabel = billToName?.trim() || "Customer";
  await notifyTenantAdminsAndDirectors(
    tenantId,
    "Invoice sent to customer",
    `${clientLabel}, ${invoiceNumber}, ${formatGHS(totalAmount)}`,
    "/dashboard/finance/client-invoices",
  );
}

export async function notifyAdminsDirectorsContractRaised(
  tenantId: string,
  contractNumber: string,
  quotationNumber: string,
  customerName: string | null | undefined,
): Promise<void> {
  const clientLabel = customerName?.trim() || "Customer";
  await notifyTenantAdminsAndDirectors(
    tenantId,
    "Service contract raised",
    `${clientLabel} — contract ${contractNumber} from quotation ${quotationNumber}`,
    "/dashboard/finance/service-contracts",
  );
}

export async function notifyAdminsDirectorsDraftServiceContractInvoice(
  tenantId: string,
  contractNumber: string,
  invoiceNumber: string,
  customerName: string | null | undefined,
): Promise<void> {
  const clientLabel = customerName?.trim() || "Customer";
  const body = `${clientLabel} — ${invoiceNumber} from contract ${contractNumber}. Review and send.`;

  await notifyTenantAdminsAndDirectors(
    tenantId,
    "Draft service contract invoice",
    body,
    "/dashboard/finance/client-invoices",
  );

  await notifyTenantAdminsAndDirectorsSms(
    tenantId,
    `Draft invoice ${invoiceNumber} for ${clientLabel} (contract ${contractNumber}) is ready. Please review and send.`,
    `draft-service-contract-invoice/${invoiceNumber}`,
  );
}

export async function notifyAdminsDirectorsLargeProductSaleForSession(
  tenantId: string,
  saleAmount: number,
  actionUrl?: string | null,
): Promise<void> {
  const recordedBy = await getCurrentUserNotificationLabel();
  await maybeNotifyLargeProductSale(
    tenantId,
    saleAmount,
    recordedBy,
    actionUrl ?? "/dashboard/crm/product-sales",
  );
}

export async function notifyAdminsDirectorsLargeProductSaleWithLabel(
  tenantId: string,
  saleAmount: number,
  recordedBy: string,
  actionUrl?: string | null,
): Promise<void> {
  await maybeNotifyLargeProductSale(
    tenantId,
    saleAmount,
    recordedBy,
    actionUrl ?? "/dashboard/crm/product-sales",
  );
}

export async function notifyAdminsDirectorsLeaveRequestSubmitted(
  requestId: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: leaveRow, error: leaveError } = await admin
      .from("leave_requests")
      .select("start_date, end_date, employee_id, leave_type_id")
      .eq("id", requestId)
      .maybeSingle();

    if (leaveError || !leaveRow) {
      console.error(
        "[tenant-admin-director-tier2] leave request lookup failed:",
        leaveError?.message ?? "not found",
      );
      return;
    }

    const [{ data: employee, error: employeeError }, { data: leaveType, error: typeError }] =
      await Promise.all([
        admin
          .from("employees")
          .select("full_name, tenant_id")
          .eq("employee_id", leaveRow.employee_id)
          .maybeSingle(),
        admin
          .from("leave_types")
          .select("type_name")
          .eq("id", leaveRow.leave_type_id)
          .maybeSingle(),
      ]);

    if (employeeError || typeError || !employee?.tenant_id) {
      console.error(
        "[tenant-admin-director-tier2] leave context lookup failed:",
        employeeError?.message ?? typeError?.message ?? "missing tenant",
      );
      return;
    }

    const employeeName = employee.full_name?.trim() || leaveRow.employee_id;
    const leaveTypeName = leaveType?.type_name?.trim() || "Leave";
    const dates = formatLeaveDateRange(leaveRow.start_date, leaveRow.end_date);

    await notifyTenantAdminsAndDirectors(
      employee.tenant_id,
      "New leave request submitted",
      `${employeeName} — ${leaveTypeName}, ${dates}`,
      "/dashboard/leave-approvals",
    );
  } catch (error) {
    console.error(
      "[tenant-admin-director-tier2] leave notification failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
