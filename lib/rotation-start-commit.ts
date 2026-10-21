import "server-only";

import type { Client } from "pg";
import type { RotationStartPlan } from "@/app/dashboard/operations/rotation-plan";

export async function commitRotationStart(input: {
  client: Client;
  tenantId: string;
  clientId: string;
  configId: string;
  plan: RotationStartPlan;
  startedByName: string;
  startedByAuthUid: string;
  startedAt: string;
  businessUnitId: string;
}): Promise<void> {
  const { client } = input;
  await client.query("BEGIN");
  try {
    for (const update of input.plan.updates) {
      const values: unknown[] = [
        input.tenantId,
        update.employee_id,
        update.assigned_site_id,
      ];
      const contractSql =
        update.contract_project !== undefined
          ? ", contract_project = $4"
          : "";
      if (update.contract_project !== undefined) {
        values.push(update.contract_project);
      }
      const result = await client.query(
        `UPDATE public.employees
            SET assigned_site_id = $3${contractSql}
          WHERE tenant_id = $1
            AND employee_id = $2`,
        values,
      );
      if (result.rowCount !== 1) {
        throw new Error(
          `Employee ${update.employee_id} could not be updated for this tenant.`,
        );
      }
    }

    for (const row of input.plan.history) {
      await client.query(
        `INSERT INTO public.roster_history (
           tenant_id, roster_number, rotation_number, effective_date, end_date,
           employee_id, previous_location, new_location, position, shift,
           generated_by, date_generated
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )`,
        [
          input.tenantId,
          row.roster_number,
          row.rotation_number,
          row.effective_date,
          row.end_date,
          row.employee_id,
          row.previous_location,
          row.new_location,
          row.position,
          row.shift,
          row.generated_by,
          row.date_generated,
        ],
      );
    }

    const configResult = await client.query(
      `UPDATE public.roster_config
          SET cycle_start_date = $3
        WHERE tenant_id = $1
          AND id = $2`,
      [input.tenantId, input.configId, input.plan.nextCycleStartDate],
    );
    if (configResult.rowCount !== 1) {
      throw new Error("Roster configuration could not be updated for this tenant.");
    }

    await client.query(
      `INSERT INTO public.roster_rotation_metadata (
         tenant_id, client_id, rotation_number, started_by_name,
         started_by_auth_uid, started_at, business_unit_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, client_id, rotation_number)
       DO UPDATE SET
         started_by_name = EXCLUDED.started_by_name,
         started_by_auth_uid = EXCLUDED.started_by_auth_uid,
         started_at = EXCLUDED.started_at,
         business_unit_id = EXCLUDED.business_unit_id`,
      [
        input.tenantId,
        input.clientId,
        input.plan.nextRotationNumber,
        input.startedByName,
        input.startedByAuthUid,
        input.startedAt,
        input.businessUnitId,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function commitRosterSiteAssignment(input: {
  client: Client;
  tenantId: string;
  employeeId: string;
  siteCode: string;
  history: {
    roster_number: string;
    rotation_number: number;
    effective_date: string;
    end_date: string;
    previous_location: string;
    new_location: string;
    position: string | null;
    shift: string | null;
    generated_by: string;
    date_generated: string;
  };
}): Promise<void> {
  const { client } = input;
  await client.query("BEGIN");
  try {
    const result = await client.query(
      `UPDATE public.employees
          SET assigned_site_id = $3
        WHERE tenant_id = $1
          AND employee_id = $2
          AND assigned_site_id IS NULL`,
      [input.tenantId, input.employeeId, input.siteCode],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        "This employee is no longer unassigned, or is outside this workspace.",
      );
    }

    const row = input.history;
    await client.query(
      `INSERT INTO public.roster_history (
         tenant_id, roster_number, rotation_number, effective_date, end_date,
         employee_id, previous_location, new_location, position, shift,
         generated_by, date_generated
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )`,
      [
        input.tenantId,
        row.roster_number,
        row.rotation_number,
        row.effective_date,
        row.end_date,
        input.employeeId,
        row.previous_location,
        row.new_location,
        row.position,
        row.shift,
        row.generated_by,
        row.date_generated,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
