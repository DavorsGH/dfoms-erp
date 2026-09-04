import "server-only";

import type { Client } from "pg";
import {
  buildCustomerCommitInsert,
  buildEmployeeCommitInsert,
  buildExpenseCommitInsert,
  buildFixedAssetCommitInsert,
  buildFinishedProductCommitInsert,
  buildServiceCatalogCommitInsert,
} from "@/lib/bulk-import/build-commit-payload";
import {
  allocateCustomerIdsForCommit,
  resolveCustomerSupervisorIdForCommit,
  type CustomerSupervisorResolverCache,
} from "@/lib/bulk-import/resolve-customer-for-commit";
import {
  allocateEmployeeIdsForCommit,
  resolveAssignedSiteCodeForCommit,
  resolveDepartmentCodeForCommit,
  resolvePositionTitleForCommit,
  resolveProjectCodeForCommit,
  resolveSupervisorIdForCommit,
  type DepartmentCodeResolverCache,
  type PositionTitleResolverCache,
  type ProjectCodeResolverCache,
  type SiteCodeResolverCache,
  type SupervisorIdResolverCache,
} from "@/lib/bulk-import/resolve-employee-for-commit";
import {
  resolveExpenseApproverNameForCommit,
  resolveExpenseCategoryForCommit,
  resolveExpensePaymentMethodForCommit,
  resolveExpenseReceiptNoForCommit,
  resolveExpenseSubcategoryForCommit,
  type ExpenseApproverNameResolverCache,
  type ExpenseNameResolverCache,
  type ExpensePaymentMethodResolverCache,
} from "@/lib/bulk-import/resolve-expense-for-commit";
import {
  allocateFixedAssetIdForCommit,
  resolveAssetCategoryForCommit,
  resolveDepreciationMethodForCommit,
  resolveFixedAssetPaymentMethodForCommit,
  syncFixedAssetPayableForCommit,
  type FixedAssetNameResolverCache,
  type FixedAssetPaymentMethodResolverCache,
} from "@/lib/bulk-import/resolve-fixed-asset-for-commit";
import {
  resolveSupplierIdForCommit,
  type SupplierIdResolverCache,
} from "@/lib/bulk-import/resolve-supplier-for-commit";
import { FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE } from "@/lib/bulk-import/target-fields";
import type { BulkImportType } from "@/lib/bulk-import/types";
import {
  buildEmploymentHistoryInsert,
  snapshotFromPayload,
} from "@/app/dashboard/employees/employment-history-utils";
import {
  buildPurchaseTaxLedgerRows,
  type TaxLedgerEntryInsert,
} from "@/app/dashboard/finance/tax-ledger-sync";

export type CommitImportRow = {
  id: string;
  mapped_data: Record<string, unknown>;
};

async function insertFinishedProduct(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  supplierCache: SupplierIdResolverCache,
  businessUnitId: string | null = null,
) {
  const sourcingRaw = String(mappedData.sourcing_type ?? "").trim().toLowerCase();
  const isPurchased = sourcingRaw === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE;
  const supplierName = String(mappedData.supplier_name ?? "").trim();

  const resolvedSupplierId = isPurchased && supplierName
    ? await resolveSupplierIdForCommit({
        client,
        tenantId,
        supplierName,
        cache: supplierCache,
      })
    : null;

  const payload = buildFinishedProductCommitInsert(
    mappedData,
    tenantId,
    resolvedSupplierId,
  );

  // finished_products is tenant catalog (no business_unit_id column). BU scope for
  // opening stock is seeded on finished_product_balances below.
  const insertResult = await client.query(
    `
      INSERT INTO public.finished_products (
        tenant_id,
        product_code,
        product_name,
        unit_of_measure,
        current_stock,
        standard_selling_price,
        sourcing_type,
        supplier_id,
        manufacturing_date,
        expiration_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `,
    [
      payload.tenant_id,
      payload.product_code,
      payload.product_name,
      payload.unit_of_measure,
      payload.current_stock,
      payload.standard_selling_price,
      payload.sourcing_type,
      payload.supplier_id,
      payload.manufacturing_date,
      payload.expiration_date,
    ],
  );

  const productId = String(insertResult.rows[0]?.id ?? "").trim();
  if (!productId) {
    throw new Error(
      `Finished product insert did not return an id for ${payload.product_code}.`,
    );
  }

  if (payload.current_stock > 0) {
    await client.query(
      `SELECT public.ensure_finished_product_balance($1::uuid, $2::uuid, $3::uuid)`,
      [tenantId, productId, businessUnitId],
    );
    await client.query(
      `
        UPDATE public.finished_product_balances
        SET current_stock = $1,
            average_cost_per_unit = 0,
            updated_at = now()
        WHERE tenant_id = $2::uuid
          AND product_id = $3::uuid
          AND business_unit_id IS NOT DISTINCT FROM $4::uuid
      `,
      [payload.current_stock, tenantId, productId, businessUnitId],
    );
  }
}

async function insertServiceCatalogRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
) {
  const payload = buildServiceCatalogCommitInsert(mappedData, tenantId);

  await client.query(
    `
      INSERT INTO public.service_catalog (
        tenant_id,
        service_name,
        description,
        default_rate,
        billing_unit,
        category
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      payload.tenant_id,
      payload.service_name,
      payload.description,
      payload.default_rate,
      payload.billing_unit,
      payload.category,
    ],
  );
}

async function insertEmployeeRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  changedBy: string,
  caches: {
    departmentCache: DepartmentCodeResolverCache;
    positionCache: PositionTitleResolverCache;
    projectCache: ProjectCodeResolverCache;
    supervisorCache: SupervisorIdResolverCache;
    siteCache: SiteCodeResolverCache;
  },
  businessUnitId: string | null = null,
) {
  const departmentCode = await resolveDepartmentCodeForCommit({
    client,
    tenantId,
    departmentName: String(mappedData.department_name ?? ""),
    cache: caches.departmentCache,
  });
  const positionTitle = await resolvePositionTitleForCommit({
    client,
    tenantId,
    positionTitle: String(mappedData.position_title ?? ""),
    cache: caches.positionCache,
  });
  const projectCode = await resolveProjectCodeForCommit({
    client,
    tenantId,
    projectName: String(mappedData.contract_project_name ?? ""),
    cache: caches.projectCache,
  });
  const supervisorId = await resolveSupervisorIdForCommit({
    client,
    tenantId,
    supervisorName: String(mappedData.supervisor_name ?? ""),
    cache: caches.supervisorCache,
  });
  const assignedSiteCode = await resolveAssignedSiteCodeForCommit({
    client,
    tenantId,
    siteName: String(mappedData.assigned_site_name ?? ""),
    cache: caches.siteCache,
  });

  const { employeeId, staffId } = await allocateEmployeeIdsForCommit({
    client,
    tenantId,
  });

  const payload = buildEmployeeCommitInsert({
    mappedData,
    tenantId,
    employeeId,
    staffId,
    departmentCode,
    positionTitle,
    projectCode,
    supervisorId,
    assignedSiteCode,
  });

  await client.query(
    `
      INSERT INTO public.employees (
        tenant_id,
        employee_id,
        staff_id,
        full_name,
        gender,
        nationality,
        marital_status,
        phone,
        email,
        department,
        position,
        supervisor,
        employment_type,
        date_hired,
        appointment_end_date,
        employment_status,
        contract_project,
        shift,
        assigned_site_id,
        data_notes,
        basic_salary,
        housing_allowance,
        transport_allowance,
        other_allowances,
        business_unit_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        0, 0, 0, 0, $21
      )
    `,
    [
      payload.tenant_id,
      payload.employee_id,
      payload.staff_id,
      payload.full_name,
      payload.gender,
      payload.nationality,
      payload.marital_status,
      payload.phone,
      payload.email,
      payload.department,
      payload.position,
      payload.supervisor,
      payload.employment_type,
      payload.date_hired,
      payload.appointment_end_date,
      payload.employment_status,
      payload.contract_project,
      payload.shift,
      payload.assigned_site_id,
      payload.data_notes,
      businessUnitId,
    ],
  );

  const leaveYear = new Date().getFullYear();
  await client.query(
    `
      INSERT INTO public.employee_leave_balances (
        tenant_id,
        employee_id,
        leave_type_id,
        year,
        entitled_days,
        days_used
      )
      SELECT
        $1,
        $2,
        lt.id,
        $3,
        public.resolve_leave_entitlement($1, $4, $5, lt.type_name),
        0
      FROM public.leave_types lt
      WHERE lt.type_name = ANY (
        ARRAY['Annual Leave'::text, 'Sick Leave'::text, 'Unpaid Leave'::text]
      )
      ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING
    `,
    [
      payload.tenant_id,
      payload.employee_id,
      leaveYear,
      payload.position,
      payload.employment_type,
    ],
  );

  const historyInsert = buildEmploymentHistoryInsert({
    employeeId: payload.employee_id,
    snapshot: snapshotFromPayload({
      position: payload.position,
      department: payload.department,
      shift: payload.shift,
      employment_status: payload.employment_status,
      employment_type: payload.employment_type,
      basic_salary: 0,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
    }),
    changeReason: "Employee created",
    changedBy,
  });

  await client.query(
    `
      INSERT INTO public.employee_employment_history (
        tenant_id,
        employee_id,
        effective_date,
        employment_type,
        position,
        shift,
        department,
        rate_id,
        basic_salary,
        housing_allowance,
        transport_allowance,
        other_allowances,
        employee_status,
        change_reason,
        changed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `,
    [
      payload.tenant_id,
      historyInsert.employee_id,
      historyInsert.effective_date,
      historyInsert.employment_type,
      historyInsert.position,
      historyInsert.shift,
      historyInsert.department,
      historyInsert.rate_id,
      historyInsert.basic_salary,
      historyInsert.housing_allowance,
      historyInsert.transport_allowance,
      historyInsert.other_allowances,
      historyInsert.employee_status,
      historyInsert.change_reason,
      historyInsert.changed_by,
    ],
  );
}

async function insertCustomerRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  supervisorCache: CustomerSupervisorResolverCache,
) {
  const supervisorId = await resolveCustomerSupervisorIdForCommit({
    client,
    tenantId,
    supervisorName: String(mappedData.supervisor_name ?? ""),
    cache: supervisorCache,
  });

  const { clientId, contractNumber } = await allocateCustomerIdsForCommit({
    client,
    tenantId,
  });

  const payload = buildCustomerCommitInsert({
    mappedData,
    tenantId,
    clientId,
    contractNumber,
    supervisorId,
  });

  await client.query(
    `
      INSERT INTO public.customers (
        tenant_id,
        client_id,
        client_name,
        contact_person,
        phone,
        email,
        address,
        gps_location,
        contract_number,
        contract_start,
        contract_end,
        service_frequency,
        services_provided,
        assigned_supervisor,
        contract_status,
        notes,
        customer_type,
        status,
        source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
    `,
    [
      payload.tenant_id,
      payload.client_id,
      payload.client_name,
      payload.contact_person,
      payload.phone,
      payload.email,
      payload.address,
      payload.gps_location,
      payload.contract_number,
      payload.contract_start,
      payload.contract_end,
      payload.service_frequency,
      payload.services_provided,
      payload.assigned_supervisor,
      payload.contract_status,
      payload.notes,
      payload.customer_type,
      payload.status,
      payload.source,
    ],
  );
}

async function insertPurchaseTaxLedgerRowsForCommit(
  client: Client,
  rows: TaxLedgerEntryInsert[],
): Promise<void> {
  for (const row of rows) {
    if (!row.tenant_id) {
      throw new Error("tenant_id is required for tax ledger inserts during bulk import.");
    }

    await client.query(
      `
        INSERT INTO public.tax_ledger_entries (
          tenant_id,
          entry_date,
          period_month,
          direction,
          tax_component,
          rate_pct,
          taxable_base,
          tax_amount,
          status,
          source_type,
          source_id,
          counterparty_name,
          notes,
          business_unit_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        row.tenant_id,
        row.entry_date,
        row.period_month,
        row.direction,
        row.tax_component,
        row.rate_pct,
        row.taxable_base,
        row.tax_amount,
        row.status,
        row.source_type,
        row.source_id,
        row.counterparty_name,
        row.notes,
        row.business_unit_id ?? null,
      ],
    );
  }
}

async function syncPurchaseTaxLedgerForCommit(input: {
  client: Client;
  tenantId: string;
  sourceId: string;
  entryDate: string;
  grossBeforeWht: number;
  whtRatePct: number | null;
  whtAmount: number;
  inputTaxComponent: "vat_bundle" | "vfrs" | null;
  inputVatAmount: number;
  counterpartyName: string | null;
  notes: string | null;
  businessUnitId?: string | null;
}): Promise<void> {
  await input.client.query(
    `
      DELETE FROM public.tax_ledger_entries
      WHERE source_type = $1
        AND source_id = $2::uuid
        AND tenant_id = $3
    `,
    ["expense_register", input.sourceId, input.tenantId],
  );

  const rows = buildPurchaseTaxLedgerRows({
    sourceType: "expense_register",
    sourceId: input.sourceId,
    entryDate: input.entryDate,
    grossBeforeWht: input.grossBeforeWht,
    whtRatePct: input.whtRatePct,
    whtAmount: input.whtAmount,
    inputTaxComponent: input.inputTaxComponent,
    inputTaxRatePct: null,
    inputVatAmount: input.inputVatAmount,
    counterpartyName: input.counterpartyName,
    notes: input.notes,
    tenantId: input.tenantId,
    businessUnitId: input.businessUnitId ?? null,
  });

  if (rows.length === 0) {
    return;
  }

  await insertPurchaseTaxLedgerRowsForCommit(input.client, rows);
}

async function insertExpenseRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  caches: {
    expenseCategoryCache: ExpenseNameResolverCache;
    expenseSubcategoryCache: ExpenseNameResolverCache;
    paymentMethodCache: ExpensePaymentMethodResolverCache;
    approverNameCache: ExpenseApproverNameResolverCache;
  },
  businessUnitId: string | null = null,
) {
  const expenseCategory = await resolveExpenseCategoryForCommit({
    client,
    tenantId,
    categoryName: String(mappedData.expense_category ?? ""),
    cache: caches.expenseCategoryCache,
  });
  const subCategory = await resolveExpenseSubcategoryForCommit({
    client,
    tenantId,
    subcategoryName: String(mappedData.sub_category ?? ""),
    cache: caches.expenseSubcategoryCache,
  });
  const paymentMethod = await resolveExpensePaymentMethodForCommit({
    client,
    tenantId,
    paymentMethodName: String(mappedData.payment_method ?? ""),
    cache: caches.paymentMethodCache,
  });
  const approvedBy = await resolveExpenseApproverNameForCommit({
    client,
    tenantId,
    approverName: String(mappedData.approved_by ?? ""),
    cache: caches.approverNameCache,
  });
  const receiptNo = await resolveExpenseReceiptNoForCommit({
    client,
    tenantId,
    suppliedReceiptNo: String(mappedData.receipt_no ?? ""),
  });

  const payload = buildExpenseCommitInsert({
    mappedData,
    tenantId,
    expenseCategory,
    subCategory,
    paymentMethod,
    approvedBy,
    receiptNo,
  });

  const insertResult = await client.query(
    `
      INSERT INTO public.expense_register (
        tenant_id,
        date,
        expense_category,
        sub_category,
        description,
        vendor,
        price,
        quantity,
        amount,
        payment_method,
        approved_by,
        receipt_no,
        payment_status,
        gross_before_wht,
        wht_rate,
        wht_amount,
        input_vat_amount,
        net_of_tax_amount,
        notes,
        business_unit_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING id
    `,
    [
      payload.tenant_id,
      payload.date,
      payload.expense_category,
      payload.sub_category,
      payload.description,
      payload.vendor,
      payload.price,
      payload.quantity,
      payload.amount,
      payload.payment_method,
      payload.approved_by,
      payload.receipt_no,
      payload.payment_status,
      payload.gross_before_wht,
      payload.wht_rate,
      payload.wht_amount,
      payload.input_vat_amount,
      payload.net_of_tax_amount,
      payload.notes,
      businessUnitId,
    ],
  );

  const expenseId = String(insertResult.rows[0]?.id ?? "").trim();
  if (!expenseId) {
    throw new Error("expense_register insert did not return an id.");
  }

  if (payload.purchaseTax.whtAmount > 0 || payload.purchaseTax.inputVatAmount > 0) {
    await syncPurchaseTaxLedgerForCommit({
      client,
      tenantId,
      sourceId: expenseId,
      entryDate: payload.date,
      grossBeforeWht: payload.purchaseTax.grossBeforeWht,
      whtRatePct: payload.wht_rate,
      whtAmount: payload.purchaseTax.whtAmount,
      inputTaxComponent: payload.purchaseTax.inputTaxComponent,
      inputVatAmount: payload.purchaseTax.inputVatAmount,
      counterpartyName: payload.vendor.trim() || null,
      notes: payload.receipt_no ? `Receipt ${payload.receipt_no}` : null,
      businessUnitId,
    });
  }
}

async function insertFixedAssetRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  caches: {
    assetCategoryCache: FixedAssetNameResolverCache;
    depreciationMethodCache: FixedAssetNameResolverCache;
    paymentMethodCache: FixedAssetPaymentMethodResolverCache;
  },
  businessUnitId: string | null = null,
) {
  const assetId = await allocateFixedAssetIdForCommit({ client, tenantId });
  const assetCategory = await resolveAssetCategoryForCommit({
    client,
    tenantId,
    categoryName: String(mappedData.asset_category ?? ""),
    cache: caches.assetCategoryCache,
  });
  const depreciationMethod = await resolveDepreciationMethodForCommit({
    client,
    tenantId,
    methodName: String(mappedData.depreciation_method ?? ""),
    cache: caches.depreciationMethodCache,
  });
  const paymentMethod = await resolveFixedAssetPaymentMethodForCommit({
    client,
    tenantId,
    paymentMethodName: String(mappedData.payment_method ?? ""),
    cache: caches.paymentMethodCache,
  });

  const payload = buildFixedAssetCommitInsert({
    mappedData,
    tenantId,
    assetId,
    assetCategory,
    depreciationMethod,
    paymentMethod,
  });

  await client.query(
    `
      INSERT INTO public.fixed_assets (
        tenant_id,
        asset_id,
        asset_name,
        asset_category,
        purchase_date,
        original_cost,
        quantity,
        total_cost,
        useful_life_years,
        depreciation_method,
        annual_depreciation,
        accumulated_depreciation,
        net_book_value,
        location,
        notes,
        payment_method,
        vendor_name,
        business_unit_id
      )
      VALUES (
        $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18
      )
    `,
    [
      payload.tenant_id,
      payload.asset_id,
      payload.asset_name,
      payload.asset_category,
      payload.purchase_date,
      payload.original_cost,
      payload.quantity,
      payload.total_cost,
      payload.useful_life_years,
      payload.depreciation_method,
      payload.annual_depreciation,
      payload.accumulated_depreciation,
      payload.net_book_value,
      payload.location,
      payload.notes,
      payload.payment_method,
      payload.vendor_name,
      businessUnitId,
    ],
  );

  const payableId = await syncFixedAssetPayableForCommit({
    client,
    tenantId,
    assetId: payload.asset_id,
    vendorName: payload.vendor_name,
    purchaseDate: payload.purchase_date,
    paymentMethod: payload.payment_method,
    totalCost: payload.total_cost,
    assetName: payload.asset_name,
  });

  await client.query(
    `
      UPDATE public.fixed_assets
      SET accounts_payable_id = $1::uuid
      WHERE asset_id = $2
        AND tenant_id = $3
    `,
    [payableId, payload.asset_id, tenantId],
  );
}

export async function commitImportJobInTransaction(input: {
  client: Client;
  jobId: string;
  tenantId: string;
  importType: BulkImportType;
  rows: CommitImportRow[];
  changedBy?: string;
  /** Create stamp for product/employee/expense/fixed_asset; null = workspace default BU. */
  activeBusinessUnitId?: string | null;
}): Promise<number> {
  const {
    client,
    jobId,
    tenantId,
    importType,
    rows,
    changedBy,
    activeBusinessUnitId = null,
  } = input;

  await client.query("BEGIN");

  try {
    const supplierCache: SupplierIdResolverCache = new Map();
    const departmentCache: DepartmentCodeResolverCache = new Map();
    const positionCache: PositionTitleResolverCache = new Map();
    const projectCache: ProjectCodeResolverCache = new Map();
    const supervisorCache: SupervisorIdResolverCache = new Map();
    const siteCache: SiteCodeResolverCache = new Map();
    const customerSupervisorCache: CustomerSupervisorResolverCache = new Map();
    const expenseCategoryCache: ExpenseNameResolverCache = new Map();
    const expenseSubcategoryCache: ExpenseNameResolverCache = new Map();
    const expensePaymentMethodCache: ExpensePaymentMethodResolverCache = new Map();
    const expenseApproverNameCache: ExpenseApproverNameResolverCache = new Map();
    const fixedAssetCategoryCache: FixedAssetNameResolverCache = new Map();
    const fixedAssetDepreciationMethodCache: FixedAssetNameResolverCache = new Map();
    const fixedAssetPaymentMethodCache: FixedAssetPaymentMethodResolverCache =
      new Map();

    for (const row of rows) {
      if (importType === "product") {
        await insertFinishedProduct(
          client,
          tenantId,
          row.mapped_data,
          supplierCache,
          activeBusinessUnitId,
        );
      } else if (importType === "service") {
        await insertServiceCatalogRow(client, tenantId, row.mapped_data);
      } else if (importType === "employee") {
        await insertEmployeeRow(
          client,
          tenantId,
          row.mapped_data,
          changedBy ?? "Bulk import",
          {
            departmentCache,
            positionCache,
            projectCache,
            supervisorCache,
            siteCache,
          },
          activeBusinessUnitId,
        );
      } else if (importType === "customer") {
        await insertCustomerRow(
          client,
          tenantId,
          row.mapped_data,
          customerSupervisorCache,
        );
      } else if (importType === "expense") {
        await insertExpenseRow(client, tenantId, row.mapped_data, {
          expenseCategoryCache,
          expenseSubcategoryCache,
          paymentMethodCache: expensePaymentMethodCache,
          approverNameCache: expenseApproverNameCache,
        }, activeBusinessUnitId);
      } else if (importType === "fixed_asset") {
        await insertFixedAssetRow(client, tenantId, row.mapped_data, {
          assetCategoryCache: fixedAssetCategoryCache,
          depreciationMethodCache: fixedAssetDepreciationMethodCache,
          paymentMethodCache: fixedAssetPaymentMethodCache,
        }, activeBusinessUnitId);
      } else {
        throw new Error(`Unsupported import type: ${importType}`);
      }

      await client.query(
        `
          UPDATE public.bulk_import_rows AS r
          SET status = 'committed', error_message = NULL
          FROM public.bulk_import_jobs AS j
          WHERE r.id = $1
            AND r.job_id = $2
            AND j.id = r.job_id
            AND j.tenant_id = $3
        `,
        [row.id, jobId, tenantId],
      );
    }

    await client.query(
      `
        UPDATE public.bulk_import_jobs
        SET status = 'committed', committed_at = now()
        WHERE id = $1 AND tenant_id = $2
      `,
      [jobId, tenantId],
    );

    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
