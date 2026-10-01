import Link from "next/link";
import type { ReactNode } from "react";
import type { ContractProjectOption } from "../administration/projects-utils";
import type { BusinessUnitSwitcherOption } from "../business-unit-switcher";
import type { NamedLookup } from "../lookup-types";
import type { RegisterDetailSection } from "../register-record-detail-drawer";
import {
  resolveNamedLookupLabel,
  resolveProjectOptionLabel,
  resolveRegisterPaymentMethodLabel,
} from "./register-detail-labels";
import {
  formatDate,
  formatGHS,
  getExpenseGrossBeforeWht,
  normalizeExpenseRegisterEntry,
  type ExpenseRegisterEntry,
} from "./expense-register-utils";
import {
  formatDate as formatAssetDate,
  formatGHS as formatAssetGHS,
  formatUsefulLifeYears,
  getLiveAssetValuesFromEntry,
  type FixedAssetEntry,
} from "./fixed-assets-utils";
import { parseAccountsPayableIdFromAccrualReceiptNo } from "./accounts-payable-accrual-utils";
import {
  isAutoPostedExpenseRegisterEntry,
} from "./register-auto-posted-utils";

function formatDetailText(value: unknown): string {
  if (value == null) return "—";
  const trimmed = String(value).trim();
  return trimmed ? trimmed : "—";
}

function formatOptionalDate(value: string | null | undefined, format: (v: string) => string): string {
  if (!value?.trim()) return "—";
  return format(value);
}

function formatRatePercent(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(Number(rate))) return "—";
  const numeric = Number(rate);
  if (numeric <= 0) return "—";
  return `${numeric.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function resolveBusinessUnitLabel(
  businessUnitId: string | null | undefined,
  units: BusinessUnitSwitcherOption[],
): string {
  if (!businessUnitId) return "—";
  return units.find((unit) => unit.id === businessUnitId)?.name ?? businessUnitId;
}

type ExpenseRegisterDetailRow = ExpenseRegisterEntry & {
  business_unit_id?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  tenant_id?: string | null;
};

export type RegisterDetailLabelContext = {
  paymentMethods: NamedLookup[];
  depreciationMethods?: NamedLookup[];
  projects?: ContractProjectOption[];
};

function resolveExpenseRegisterSourceLabel(
  entry: ExpenseRegisterDetailRow,
): ReactNode {
  const apId = parseAccountsPayableIdFromAccrualReceiptNo(entry.receipt_no);
  if (apId) {
    return (
      <>
        Auto-posted from Accounts Payable (
        <Link
          href={`/dashboard/finance/accounts-payable?apId=${encodeURIComponent(apId)}`}
          className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
        >
          open payable
        </Link>
        )
      </>
    );
  }
  if (isAutoPostedExpenseRegisterEntry(entry)) {
    return "System auto-posted";
  }
  return "Manual entry";
}

export function buildExpenseRegisterDetailSections(
  entry: ExpenseRegisterDetailRow,
  units: BusinessUnitSwitcherOption[],
  labels: RegisterDetailLabelContext,
): RegisterDetailSection[] {
  const normalized = normalizeExpenseRegisterEntry(entry);
  const gross = getExpenseGrossBeforeWht(normalized);

  return [
    {
      title: "Overview",
      fields: [
        { label: "Date", value: formatOptionalDate(normalized.date, formatDate) },
        {
          label: "Expense name",
          value: formatDetailText(normalized.description),
        },
        { label: "Category", value: formatDetailText(normalized.expense_category) },
        { label: "Sub-category", value: formatDetailText(normalized.sub_category) },
        { label: "Supplier", value: formatDetailText(normalized.vendor) },
        {
          label: "Source",
          value: resolveExpenseRegisterSourceLabel(entry),
        },
      ],
    },
    {
      title: "Amounts",
      fields: [
        { label: "Unit price", value: formatGHS(normalized.price) },
        { label: "Quantity", value: formatDetailText(normalized.quantity) },
        { label: "Gross (before WHT)", value: formatGHS(gross) },
        { label: "WHT rate", value: formatRatePercent(normalized.wht_rate) },
        { label: "WHT amount", value: formatGHS(normalized.wht_amount ?? 0) },
        {
          label: "Input VAT",
          value: formatGHS(normalized.input_vat_amount ?? 0),
        },
        { label: "Net paid", value: formatGHS(normalized.amount) },
        {
          label: "Net of tax (P&L base)",
          value:
            normalized.net_of_tax_amount != null
              ? formatGHS(normalized.net_of_tax_amount)
              : "—",
        },
      ],
    },
    {
      title: "Payment & receipt",
      fields: [
        {
          label: "Payment method",
          value: resolveRegisterPaymentMethodLabel(
            normalized.payment_method,
            labels.paymentMethods,
          ),
        },
        { label: "Payment status", value: formatDetailText(normalized.payment_status) },
        { label: "Receipt / reference", value: formatDetailText(normalized.receipt_no) },
        { label: "Approved by", value: formatDetailText(normalized.approved_by) },
      ],
    },
    {
      title: "Notes & audit",
      fields: [
        { label: "Notes", value: formatDetailText(normalized.notes) },
        {
          label: "Project",
          value: resolveProjectOptionLabel(
            normalized.project_id,
            labels.projects ?? [],
          ),
        },
        {
          label: "Business unit",
          value: resolveBusinessUnitLabel(entry.business_unit_id, units),
        },
        {
          label: "Created",
          value: entry.created_at
            ? formatOptionalDate(entry.created_at, formatDate)
            : "—",
        },
        { label: "Created by", value: formatDetailText(entry.created_by) },
      ],
    },
  ];
}

export function buildFixedAssetDetailSections(
  asset: FixedAssetEntry,
  units: BusinessUnitSwitcherOption[],
  labels: RegisterDetailLabelContext,
): RegisterDetailSection[] {
  const live = getLiveAssetValuesFromEntry(asset);

  return [
    {
      title: "Asset",
      fields: [
        { label: "Asset ID", value: formatDetailText(asset.asset_id) },
        { label: "Asset name", value: formatDetailText(asset.asset_name) },
        { label: "Category", value: formatDetailText(asset.asset_category) },
        {
          label: "Purchase date",
          value: formatOptionalDate(asset.purchase_date, formatAssetDate),
        },
        { label: "Location", value: formatDetailText(asset.location) },
        { label: "Notes", value: formatDetailText(asset.notes) },
      ],
    },
    {
      title: "Cost & depreciation",
      fields: [
        { label: "Original cost (unit)", value: formatAssetGHS(asset.original_cost) },
        { label: "Quantity", value: formatDetailText(asset.quantity) },
        { label: "Total cost", value: formatAssetGHS(live.totalCost) },
        {
          label: "Useful life (years)",
          value: formatUsefulLifeYears(asset.useful_life_years),
        },
        {
          label: "Depreciation method",
          value: resolveNamedLookupLabel(
            asset.depreciation_method,
            labels.depreciationMethods ?? [],
          ),
        },
        {
          label: "Annual depreciation",
          value: formatAssetGHS(live.annualDepreciation),
        },
        {
          label: "Accumulated depreciation",
          value: formatAssetGHS(live.accumulatedDepreciation),
        },
        { label: "Net book value", value: formatAssetGHS(live.netBookValue) },
      ],
    },
    {
      title: "Purchase & tax",
      fields: [
        {
          label: "Payment method",
          value: resolveRegisterPaymentMethodLabel(
            asset.payment_method,
            labels.paymentMethods,
          ),
        },
        { label: "Supplier", value: formatDetailText(asset.vendor_name) },
        { label: "Approved by", value: formatDetailText(asset.approved_by) },
        {
          label: "Gross (before WHT)",
          value:
            asset.gross_before_wht != null
              ? formatAssetGHS(asset.gross_before_wht)
              : "—",
        },
        {
          label: "WHT rate",
          value: formatRatePercent(asset.wht_rate),
        },
        {
          label: "WHT amount",
          value: formatAssetGHS(asset.wht_amount ?? 0),
        },
        {
          label: "Input VAT",
          value: formatAssetGHS(asset.input_vat_amount ?? 0),
        },
        {
          label: "Net of tax",
          value:
            asset.net_of_tax_amount != null
              ? formatAssetGHS(asset.net_of_tax_amount)
              : "—",
        },
      ],
    },
    {
      title: "Organisation",
      fields: [
        {
          label: "Business unit",
          value: resolveBusinessUnitLabel(asset.business_unit_id, units),
        },
        {
          label: "Accounts payable link",
          value: asset.accounts_payable_id
            ? formatDetailText(asset.accounts_payable_id)
            : "—",
        },
      ],
    },
  ];
}
