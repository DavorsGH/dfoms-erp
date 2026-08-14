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

/** Matches DB check: customers_status_check */
export const DEFAULT_CUSTOMER_STATUS = "active";

/** Matches DB check: customers_customer_type_check */
export const DEFAULT_CUSTOMER_TYPE = "service_client";

/** Persisted on customers.customer_type — must match DB check constraint. */
export const CUSTOMER_RECORD_TYPE_VALUES = [
  "service_client",
  "digital_subscriber",
  "product_client",
] as const;

export type CustomerRecordType = (typeof CUSTOMER_RECORD_TYPE_VALUES)[number];

export const CUSTOMER_RECORD_TYPE_OPTIONS = [
  { value: "service_client", label: "Service Customer" },
  { value: "digital_subscriber", label: "Digital Subscriber" },
  { value: "product_client", label: "Product Customer" },
] as const;

/** Filter/audience-only — includes "all"; never save on a customer row. */
export const CUSTOMER_TYPE_FILTER_OPTIONS = [
  ...CUSTOMER_RECORD_TYPE_OPTIONS,
  { value: "all", label: "All" },
] as const;

export function isValidCustomerRecordType(
  value: string | null | undefined,
): value is CustomerRecordType {
  return (
    typeof value === "string" &&
    (CUSTOMER_RECORD_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeCustomerRecordType(
  value: string | null | undefined,
): CustomerRecordType {
  if (isValidCustomerRecordType(value)) {
    return value;
  }
  return DEFAULT_CUSTOMER_TYPE;
}

export const CUSTOMER_STATUS_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export function getCustomerTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "both") return "All";
  const match = CUSTOMER_TYPE_FILTER_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value;
}

export function getCustomerStatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const match = CUSTOMER_STATUS_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value;
}

export function getCustomerDisplayName(
  customer: Pick<CustomerEntry, "client_name" | "client_id">,
): string {
  return customer.client_name?.trim() || customer.client_id;
}
