import { redirect } from "next/navigation";
import {
  fetchLandlordPortalExpenses,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  formatExpenseCategory,
  formatExpenseDate,
  formatExpenseMoney,
} from "@/app/dashboard/real-estate/expenses-utils";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalExpenseForm from "./expense-form";
import { TenantLogosMediaLink } from "@/components/tenant-logos-media";

export default async function LandlordPortalExpensesPage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  if (session.landlordType !== "platform_only") {
    redirect("/landlord-portal/finance/rent-ledger");
  }

  const { rows, properties, error } =
    await fetchLandlordPortalExpenses(session);

  return (
    <div className="space-y-6">
      <div>
        <h1 className={portalSectionTitleClassName}>Property expenses</h1>
        <p className="mt-1 text-sm text-slate-600">
          Log and review expenses for your own properties. Receipt photos use
          the same storage pattern as staff.
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Log expense</h2>
        <LandlordPortalExpenseForm properties={properties} />
      </section>

      <div className="space-y-2">
        <h2 className={portalSectionTitleClassName}>Expense history</h2>
        {rows.length === 0 ? (
          <section className={portalSectionClassName}>
            <p className="text-sm text-slate-600">No expenses logged yet.</p>
          </section>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Date</th>
                  <th className={scrollableTableThClassName}>Property</th>
                  <th className={scrollableTableThClassName}>Category</th>
                  <th className={scrollableTableThClassName}>Amount</th>
                  <th className={scrollableTableThClassName}>Description</th>
                  <th className={scrollableTableThClassName}>Receipt</th>
                </tr>
              </thead>
              <tbody className={scrollableTableBodyClassName}>
                {rows.map((row) => (
                  <tr key={row.expenseId} className="bg-white">
                    <td className="px-4 py-3 text-slate-700">
                      {formatExpenseDate(row.expenseDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.propertyName}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatExpenseCategory(row.category)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatExpenseMoney(row.amountGhs)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.receiptUrl ? (
                        <TenantLogosMediaLink
                          reference={row.receiptUrl}
                          tenantId={session.tenantId}
                          className="font-medium text-[#0f2744] hover:underline"
                        >
                          View
                        </TenantLogosMediaLink>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </div>
    </div>
  );
}
