"use client";

import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  formatServiceCatalogRate,
  normalizeServiceCatalogEntry,
  type ServiceCatalogEntry,
} from "./service-catalog-utils";

type ServiceCatalogListProps = {
  initialServices: ServiceCatalogEntry[];
  fetchError: string | null;
};

export default function ServiceCatalogList({
  initialServices,
  fetchError,
}: ServiceCatalogListProps) {
  const services = initialServices.map(normalizeServiceCatalogEntry);

  return (
    <div className="space-y-6">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Service name</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Default rate</th>
                <th className={scrollableTableThClassName}>Billing unit</th>
                <th className={scrollableTableThClassName}>Category</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {services.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No services in the catalog yet.
                  </td>
                </tr>
              ) : (
                services.map((service, index) => (
                  <tr
                    key={service.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      {service.service_name}
                    </td>
                    <td className="max-w-md px-4 py-3 text-sm text-slate-700">
                      {service.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatServiceCatalogRate(service.default_rate)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {service.billing_unit ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {service.category ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
