export type ClientEntry = {
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
};

export const CLIENT_SELECT = "*";

export const DEFAULT_CONTRACT_STATUS = "Active";
