import "server-only";

import type { Client } from "pg";
import {
  buildFinishedProductCommitInsert,
  buildServiceCatalogCommitInsert,
} from "@/lib/bulk-import/build-commit-payload";
import {
  resolveSupplierIdForCommit,
  type SupplierIdResolverCache,
} from "@/lib/bulk-import/resolve-supplier-for-commit";
import { FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE } from "@/lib/bulk-import/target-fields";
import type { BulkImportType } from "@/lib/bulk-import/types";

export type CommitImportRow = {
  id: string;
  mapped_data: Record<string, unknown>;
};

async function insertFinishedProduct(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  supplierCache: SupplierIdResolverCache,
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

  await client.query(
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

export async function commitImportJobInTransaction(input: {
  client: Client;
  jobId: string;
  tenantId: string;
  importType: BulkImportType;
  rows: CommitImportRow[];
}): Promise<number> {
  const { client, jobId, tenantId, importType, rows } = input;

  await client.query("BEGIN");

  try {
    const supplierCache: SupplierIdResolverCache = new Map();

    for (const row of rows) {
      if (importType === "product") {
        await insertFinishedProduct(client, tenantId, row.mapped_data, supplierCache);
      } else {
        await insertServiceCatalogRow(client, tenantId, row.mapped_data);
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
