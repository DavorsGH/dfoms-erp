import "server-only";

import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  DISCIPLINARY_SELECT,
  type DisciplinaryRecordEntry,
} from "@/app/dashboard/hr-payroll/disciplinary-register-utils";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  HR_ASSISTANT_LIST_LIMIT,
  canAccessDisciplinaryRecords,
  fetchAssistantDirectoryEmployees,
  loadStaffBusinessUnitScope,
  parseOptionalStringField,
  resolveEmployeeInScope,
} from "@/utils/assistant-staff-tools-hr-common";

export async function getDisciplinaryRecords(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessDisciplinaryRecords(sessionResult.session.role)) {
    return { error: "You do not have access to disciplinary records." };
  }

  const employeeId = parseOptionalStringField(toolInput, "employeeId");

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employeeIds, error: scopeError } = await fetchScopedEmployeeIds(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );

    if (scopeError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: scopeError };
    }

    let scopedEmployeeIds = employeeIds;
    if (employeeId) {
      const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
        supabase,
        buScope,
      );
      if (fetchError) {
        return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
      }

      const employee = resolveEmployeeInScope(employees, employeeId);
      if (!employee) {
        return {
          error:
            "No employee matched that identifier in your current business unit scope.",
        };
      }

      scopedEmployeeIds = [employee.employee_id];
    }

    const { data, error } = await applyEmployeeIdScope(
      supabase.from("disciplinary_records").select(DISCIPLINARY_SELECT),
      scopedEmployeeIds,
    )
      .order("incident_date", { ascending: false })
      .limit(HR_ASSISTANT_LIST_LIMIT);

    if (error) {
      console.error("[assistant] get_disciplinary_records failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const records = ((data as DisciplinaryRecordEntry[] | null) ?? []).map(
      (row) => ({
        id: row.id,
        employeeId: row.employee_id,
        incidentDate: row.incident_date,
        description: row.description,
        actionTaken: row.action_taken,
        warningLevel: row.warning_level,
      }),
    );

    return {
      totalCount: records.length,
      records,
      note:
        records.length >= HR_ASSISTANT_LIST_LIMIT
          ? `Showing the ${HR_ASSISTANT_LIST_LIMIT} most recent records. More may exist.`
          : undefined,
    };
  } catch (error) {
    console.error("[assistant] get_disciplinary_records threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
