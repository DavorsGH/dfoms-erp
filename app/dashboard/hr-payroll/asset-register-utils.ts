export type AssetRegisterEntry = {
  asset_id: string;
  employee_id: string | null;
  asset_name: string;
  date_issued: string | null;
  date_returned: string | null;
  condition: string | null;
};

/**
 * equipment_register.condition is free text with no shared lookup.
 * Fixed list for staff-kit issues so issue/return records stay consistent.
 */
export const ASSET_CONDITION_OPTIONS = [
  "New",
  "Good",
  "Fair",
  "Poor",
  "Damaged",
] as const;

export type AssetCondition = (typeof ASSET_CONDITION_OPTIONS)[number];

export const ASSET_REGISTER_SELECT =
  "asset_id, employee_id, asset_name, date_issued, date_returned, condition";
