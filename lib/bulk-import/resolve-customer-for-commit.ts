import "server-only";

import type { Client } from "pg";
import {
  CLIENT_ID_ENTITY_TYPE,
  CONTRACT_NUMBER_ENTITY_TYPE,
} from "@/app/dashboard/crm/customers/customer-contract-api";
import { resolveSupervisorIdForCommit } from "@/lib/bulk-import/resolve-employee-for-commit";

export type CustomerSupervisorResolverCache = Map<string, string>;

async function generateNextCodeInTransaction(
  client: Client,
  tenantId: string,
  entityType: string,
): Promise<string> {
  const result = await client.query(
    `SELECT public.generate_next_code($1, $2, 4) AS code`,
    [tenantId, entityType],
  );

  const code = String(result.rows[0]?.code ?? "").trim();
  if (!code) {
    throw new Error(`generate_next_code returned an empty ${entityType} code.`);
  }

  return code;
}

export async function allocateCustomerIdsForCommit(input: {
  client: Client;
  tenantId: string;
}): Promise<{ clientId: string; contractNumber: string }> {
  const { client, tenantId } = input;

  const clientId = await generateNextCodeInTransaction(
    client,
    tenantId,
    CLIENT_ID_ENTITY_TYPE,
  );
  const contractNumber = await generateNextCodeInTransaction(
    client,
    tenantId,
    CONTRACT_NUMBER_ENTITY_TYPE,
  );

  return { clientId, contractNumber };
}

export async function resolveCustomerSupervisorIdForCommit(input: {
  client: Client;
  tenantId: string;
  supervisorName: string | null;
  cache: CustomerSupervisorResolverCache;
}): Promise<string | null> {
  return resolveSupervisorIdForCommit({
    client: input.client,
    tenantId: input.tenantId,
    supervisorName: input.supervisorName,
    cache: input.cache,
  });
}
