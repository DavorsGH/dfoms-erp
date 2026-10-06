import "server-only";

import type { Client } from "pg";

export async function generateNextCodeInTransaction(
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
