import type { RosterHistoryRecord } from "./duty-roster-utils";

export const ROSTER_ROTATION_METADATA_SELECT =
  "id, tenant_id, client_id, rotation_number, started_by_name, started_by_auth_uid, started_at, approved_by_name, approved_by_title, approved_by_auth_uid, approved_at" as const;

export type RosterRotationMetadataRecord = {
  id: string;
  tenant_id: string;
  client_id: string;
  rotation_number: number;
  started_by_name: string | null;
  started_by_auth_uid: string | null;
  started_at: string | null;
  approved_by_name: string | null;
  approved_by_title: string | null;
  approved_by_auth_uid: string | null;
  approved_at: string | null;
};

export type RosterRotationStartAudit = {
  startedByName: string;
  startedAt: string;
};

export function normalizeRosterRotationMetadataRecord(
  row: Partial<RosterRotationMetadataRecord> | null | undefined,
): RosterRotationMetadataRecord | null {
  if (!row?.id || !row.tenant_id || !row.client_id) {
    return null;
  }

  const rotationNumber = Number(row.rotation_number) || 0;
  if (rotationNumber <= 0) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    client_id: row.client_id,
    rotation_number: rotationNumber,
    started_by_name: row.started_by_name?.trim() || null,
    started_by_auth_uid: row.started_by_auth_uid ?? null,
    started_at: row.started_at ?? null,
    approved_by_name: row.approved_by_name?.trim() || null,
    approved_by_title: row.approved_by_title?.trim() || null,
    approved_by_auth_uid: row.approved_by_auth_uid ?? null,
    approved_at: row.approved_at ?? null,
  };
}

export function getRotationMetadataForClient(
  metadataRows: RosterRotationMetadataRecord[],
  clientId: string,
  rotationNumber: number,
): RosterRotationMetadataRecord | null {
  return (
    metadataRows.find(
      (row) =>
        row.client_id === clientId && row.rotation_number === rotationNumber,
    ) ?? null
  );
}

export function inferRotationStartAuditFromHistory(
  history: RosterHistoryRecord[],
  rotationNumber: number,
): RosterRotationStartAudit | null {
  const rows = history.filter(
    (row) => Number(row.rotation_number) === rotationNumber,
  );

  if (rows.length === 0) {
    return null;
  }

  const withAudit = rows.find(
    (row) => row.generated_by?.trim() && row.date_generated,
  );

  if (!withAudit?.generated_by?.trim() || !withAudit.date_generated) {
    return null;
  }

  return {
    startedByName: withAudit.generated_by.trim(),
    startedAt: withAudit.date_generated,
  };
}

export function resolveRotationStartAudit(
  metadata: RosterRotationMetadataRecord | null,
  history: RosterHistoryRecord[],
  rotationNumber: number,
): RosterRotationStartAudit | null {
  if (metadata?.started_by_name?.trim()) {
    return {
      startedByName: metadata.started_by_name.trim(),
      startedAt:
        metadata.started_at?.trim() ||
        inferRotationStartAuditFromHistory(history, rotationNumber)?.startedAt ||
        "",
    };
  }

  return inferRotationStartAuditFromHistory(history, rotationNumber);
}

export function formatRotationAuditTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isRotationApproved(
  metadata: RosterRotationMetadataRecord | null,
): boolean {
  return Boolean(metadata?.approved_at && metadata.approved_by_name?.trim());
}
