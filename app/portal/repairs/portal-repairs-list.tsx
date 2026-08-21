import Link from "next/link";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableHeadingClassName,
} from "@/app/dashboard/scrollable-table";

export type PortalRepairListItem = {
  requestId: string;
  description: string;
  dateLabel: string;
  statusLabel: string;
  landlordApprovalLabel: string;
  costSelfFixLabel: string | null;
  hasPhotos: boolean;
};

type PortalRepairsListProps = {
  rows: PortalRepairListItem[];
};

const actionLinkClassName =
  "text-sm font-medium text-[#0f2744] hover:underline";

function RepairActionLink({ row }: { row: PortalRepairListItem }) {
  const label = row.hasPhotos ? "View photos" : "View details";

  return (
    <Link href={`/portal/repairs/${row.requestId}`} className={actionLinkClassName}>
      {label}
    </Link>
  );
}

export default function PortalRepairsList({ rows }: PortalRepairsListProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 min-w-0">
      <div className="hidden md:block">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableHeadingClassName("Description")}>
                  Description
                </th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Cost / self-fix</th>
                <th className={scrollableTableThClassName}>Action</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row, index) => (
                <tr key={row.requestId} className={getStripedRowClassName(index)}>
                  <td className={scrollableTableWrapTdClassName}>
                    <p className="min-w-[12rem] max-w-xl font-medium text-[#0f2744]">
                      {row.description}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {row.dateLabel}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <p className="text-slate-900">{row.statusLabel}</p>
                      <p className="text-xs text-slate-600">
                        Landlord: {row.landlordApprovalLabel}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">
                    {row.costSelfFixLabel ?? "—"}
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <RepairActionLink row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm md:hidden">
        {rows.map((row) => (
          <li key={row.requestId} className="px-4 py-3">
            <p className="text-xs text-slate-500">{row.dateLabel}</p>
            <p className="mt-1 text-sm font-medium text-[#0f2744]">
              {row.description}
            </p>
            <div className="mt-2 space-y-1">
              <p className="text-sm text-slate-900">{row.statusLabel}</p>
              <p className="text-xs text-slate-600">
                Landlord: {row.landlordApprovalLabel}
              </p>
              {row.costSelfFixLabel ? (
                <p className="text-xs text-slate-600">{row.costSelfFixLabel}</p>
              ) : null}
            </div>
            <div className="mt-2">
              <RepairActionLink row={row} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
