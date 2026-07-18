export type CustomerEntry = {
  client_id: string;
  client_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gps_location: string | null;
  contract_number: string | null;
  contract_start: string | null;
  contract_end: string | null;
  service_frequency: string | null;
  services_provided: string | null;
  assigned_supervisor: string | null;
  contract_status: string | null;
  notes: string | null;
  customer_type: string | null;
  status: string | null;
};

export const CUSTOMER_SELECT = "*";

export const DEFAULT_CUSTOMER_STATUS = "Active";

export const DEFAULT_CUSTOMER_TYPE = "Business";

export const CUSTOMER_TYPE_OPTIONS = [
  "Individual",
  "Business",
  "Enterprise",
  "Contract",
] as const;

export const CUSTOMER_STATUS_OPTIONS = [
  "Active",
  "Inactive",
  "Pending",
  "Suspended",
] as const;

export function getCustomerDisplayName(
  customer: Pick<CustomerEntry, "client_name" | "client_id">,
): string {
  return customer.client_name?.trim() || customer.client_id;
}
