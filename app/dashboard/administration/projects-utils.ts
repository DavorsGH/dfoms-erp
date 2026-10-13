import type { SiteEntry } from "../operations/sites-utils";
import type { ServiceContractListRow } from "@/utils/service-contracts-types";

export type ProjectSite = {
  site_code: string;
  site_name: string;
  client_id: string | null;
  required_staff?: number | null;
  project_id?: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
};

export type ProjectEntry = {
  id: string;
  project_code: string;
  project_name: string;
  service_contract_id: string | null;
  required_staff?: number | null;
  business_unit_id?: string | null;
  is_archived: boolean;
  sites?: ProjectSite[] | null;
};

export const PROJECT_SELECT =
  "id, project_code, project_name, service_contract_id, required_staff, business_unit_id, is_archived, sites:sites!sites_project_id_fkey(site_code, site_name, client_id, required_staff, project_id)";

export const CONTRACT_PROJECT_SELECT =
  "id, project_code, project_name, is_archived";

export type ContractProjectOption = {
  id: string;
  project_code: string;
  project_name: string;
  is_archived?: boolean;
};

export function resolveOptionalProjectId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeProjectEntry(raw: ProjectEntry): ProjectEntry {
  const sites = Array.isArray(raw.sites)
    ? raw.sites.map((site) => ({
        ...site,
        client: Array.isArray(site.client)
          ? site.client[0] ?? null
          : site.client ?? null,
      }))
    : raw.sites ?? null;

  return {
    ...raw,
    service_contract_id: raw.service_contract_id ?? null,
    is_archived: raw.is_archived ?? false,
    sites,
  };
}

export function getServiceContractClientName(
  contract: Pick<ServiceContractListRow, "client" | "client_id">,
): string {
  const client = contract.client;
  if (client && typeof client === "object" && "client_name" in client) {
    return client.client_name ?? "";
  }
  return "";
}

export function formatServiceContractOptionLabel(
  contract: Pick<ServiceContractListRow, "contract_number" | "client" | "client_id">,
): string {
  const clientName = getServiceContractClientName(contract);
  return clientName
    ? `${contract.contract_number} — ${clientName}`
    : contract.contract_number;
}

export function shouldShowServiceContractInProjectForm(
  contract: Pick<ServiceContractListRow, "id" | "status">,
  linkedContractId: string | null,
): boolean {
  if (contract.status === "terminated") {
    return contract.id === linkedContractId;
  }
  return true;
}

export function formatProjectClientContractLabel(
  serviceContractId: string | null,
  contractsById: ReadonlyMap<string, ServiceContractListRow>,
): string {
  if (!serviceContractId) {
    return "Overhead";
  }
  const contract = contractsById.get(serviceContractId);
  if (!contract) {
    return "Overhead";
  }
  return formatServiceContractOptionLabel(contract);
}

export function getProjectSiteCount(project: ProjectEntry): number {
  return project.sites?.length ?? 0;
}

export function getProjectSiteLabel(project: ProjectEntry): string {
  const count = getProjectSiteCount(project);
  if (count === 0) {
    return "—";
  }

  if (count === 1) {
    return project.sites?.[0]?.site_name ?? "—";
  }

  return `${count} sites`;
}

export function getProjectClientName(
  project: ProjectEntry,
  sites: SiteEntry[],
): string {
  const linkedSites =
    project.sites ??
    sites.filter((site) => site.project_id === project.id);

  const clientIds = new Set(
    linkedSites.map((site) => site.client_id).filter(Boolean) as string[],
  );

  if (clientIds.size === 1) {
    const clientId = [...clientIds][0];
    const site = linkedSites.find((entry) => entry.client_id === clientId);
    return site?.client?.client_name ?? clientId;
  }

  if (clientIds.size > 1) {
    return "Multiple clients";
  }

  return "Unassigned";
}
