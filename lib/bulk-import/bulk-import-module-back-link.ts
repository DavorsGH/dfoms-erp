import type { BulkImportType } from "@/lib/bulk-import/types";

export type BulkImportModuleBackLink = {
  href: string;
  label: string;
};

export const BULK_IMPORT_MODULE_BACK_LINK: Record<
  BulkImportType,
  BulkImportModuleBackLink
> = {
  product: {
    href: "/dashboard/inventory/finished-products",
    label: "Finished Products",
  },
  service: {
    href: "/dashboard/crm/services",
    label: "Services",
  },
  employee: {
    href: "/dashboard/employees",
    label: "Employee Directory",
  },
  customer: {
    href: "/dashboard/crm/customers",
    label: "Customers",
  },
  expense: {
    href: "/dashboard/finance/expenses",
    label: "Expense Register",
  },
  fixed_asset: {
    href: "/dashboard/finance/fixed-assets",
    label: "Fixed Assets",
  },
};
