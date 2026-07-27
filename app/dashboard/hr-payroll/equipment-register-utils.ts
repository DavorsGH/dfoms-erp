export type EquipmentRegisterEntry = {
  equipment_id: string;
  equipment_name: string;
  category: string | null;
  serial_number: string | null;
  assigned_to: string | null;
  assigned_site: string | null;
  condition: string | null;
  purchase_date: string | null;
  last_maintenance: string | null;
  next_service_due: string | null;
  current_status: string | null;
  service_alert: boolean | null;
  notes: string | null;
};

export type EquipmentSiteOption = {
  site_code: string;
  site_name: string;
};

export const EQUIPMENT_REGISTER_SELECT =
  "equipment_id, equipment_name, category, serial_number, assigned_to, assigned_site, condition, purchase_date, last_maintenance, next_service_due, current_status, service_alert, notes";

export const EQUIPMENT_SITE_SELECT = "site_code, site_name";

export const EQUIPMENT_STATUS_OPTIONS_SELECT = "name";

export const DEFAULT_EQUIPMENT_STATUS = "Operational";
