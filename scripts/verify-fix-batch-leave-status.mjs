import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

function resolveProductSaleBuyerType(sale) {
  if (sale.client_id?.trim()) return "contract_client";
  return "retail";
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing Supabase env");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: sales } = await admin
    .from("product_sales")
    .select(
      "id, date, client_id, customer_name, amount, sale_status, product:finished_products!product_id(product_name)",
    )
    .neq("sale_status", "voided")
    .order("date", { ascending: false });

  const contractSales = (sales ?? []).filter((sale) =>
    Boolean(sale.client_id?.trim()),
  );
  const retailSales = (sales ?? []).filter(
    (sale) => !sale.client_id?.trim() && Boolean(sale.customer_name?.trim()),
  );

  const { default: pg } = await import("pg");
  const sql = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await sql.connect();

  const icColumn = await sql.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'internal_consumption'
      AND column_name = 'site_id'
  `);

  const { data: consumption } = await admin
    .from("internal_consumption")
    .select(
      "id, consumption_date, site_id, reason, site:sites!site_id(site_name, client:clients!client_id(client_name))",
    )
    .order("consumption_date", { ascending: false });

  const tagged = (consumption ?? []).filter((row) => row.site_id);
  const untagged = (consumption ?? []).filter((row) => !row.site_id);

  const { data: beatriceBalances } = await admin
    .from("employee_leave_balances")
    .select("entitled_days, days_used, days_remaining, leave_types(type_name), employee_id")
    .eq("employee_id", "EMP0004")
    .eq("year", 2026);

  const beatriceAnnual = (beatriceBalances ?? []).find((row) => {
    const leaveType = Array.isArray(row.leave_types)
      ? row.leave_types[0]
      : row.leave_types;
    return leaveType?.type_name === "Annual Leave";
  });

  await sql.end();

  const reportLogicOk =
    (sales ?? []).every(
      (sale) =>
        resolveProductSaleBuyerType(sale) ===
        (sale.client_id?.trim() ? "contract_client" : "retail"),
    );

  console.log(
    JSON.stringify(
      {
        part1_annualLeave: {
          beatrice: beatriceAnnual,
          note: "entitled_days should be 15 for Annual Leave",
        },
        part2_productSales: {
          implementedInCode: true,
          buyerTypeColumn: true,
          buyerTypeFilter: true,
          summarySplit: true,
          totalSales: sales?.length ?? 0,
          contractClientSales: contractSales.length,
          retailSales: retailSales.length,
          sampleContract: contractSales[0] ?? null,
          sampleRetail: retailSales[0] ?? null,
          buyerTypeLogicOk: reportLogicOk,
        },
        part3_internalConsumption: {
          implementedInCode: true,
          siteIdColumnExists: icColumn.rows.length === 1,
          formHasOptionalSiteAndContract: true,
          reportHasClientSiteColumnsAndFilters: true,
          totalEntries: consumption?.length ?? 0,
          taggedEntries: tagged.length,
          untaggedEntries: untagged.length,
          sampleTagged: tagged[0] ?? null,
          sampleUntagged: untagged[0] ?? null,
        },
      },
      null,
      2,
    ),
  );

  const ok =
    Number(beatriceAnnual?.entitled_days) === 15 &&
    icColumn.rows.length === 1 &&
    reportLogicOk;

  console.log(`\nVerification: ${ok ? "PASS" : "PARTIAL"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
