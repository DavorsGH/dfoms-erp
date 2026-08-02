import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchDavorsManagedRentalApplications } from "@/utils/rental-application-management";
import {
  formatApplicationDate,
  formatApplicationMoney,
  formatRentalApplicationStatus,
} from "../applications-utils";
import RealEstateShell from "../real-estate-shell";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";

type PageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function StaffApplicationsPage({ searchParams }: PageProps) {
  const { landlord: landlordParam } = await searchParams;
  const landlordFilter = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows, error } = await fetchDavorsManagedRentalApplications(admin);
  const filtered = landlordFilter
    ? rows.filter((row) => row.tenantId === landlordFilter)
    : rows;

  return (
    <RealEstateShell sectionTitle="Applications">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Read-only view of rental applications for{" "}
          <span className="font-medium">davors_managed</span> landlords.
          Approve / reject happens in the Landlord Portal. Use an approved
          packet to create a lease.
        </p>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-sm text-slate-600">
            No applications for davors_managed landlords.
          </div>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Landlord</th>
                  <th className={scrollableTableThClassName}>Applicant</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Income</th>
                  <th className={scrollableTableThClassName}>Submitted</th>
                  <th className={scrollableTableThClassName} />
                </tr>
              </thead>
              <tbody className={scrollableTableBodyClassName}>
                {filtered.map((row) => (
                  <tr key={row.applicationId} className="bg-white">
                    <td className="px-4 py-3 text-slate-900">
                      {row.landlordName}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{row.fullName}</div>
                      <div className="text-xs text-slate-500">{row.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.propertyName} / {row.unitNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatRentalApplicationStatus(row.status)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatApplicationMoney(row.monthlyIncomeGhs)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatApplicationDate(row.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/real-estate/applications/${row.tenantId}/${row.applicationId}`}
                        className="text-sm font-medium text-[#0f2744] underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </div>
    </RealEstateShell>
  );
}
