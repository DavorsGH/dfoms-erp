import type { ClientEntry } from "./clients-utils";

export type RosterConfigRecord = {
  id: string;
  client_id: string;
  cycle_start_date: string;
  cycle_length_days: number;
  morning_time: string | null;
  afternoon_time: string | null;
  supervisor_time: string | null;
};

export const ROSTER_CONFIG_SELECT =
  "id, client_id, cycle_start_date, cycle_length_days, morning_time, afternoon_time, supervisor_time";

export function getRosterConfigForClient(
  configs: RosterConfigRecord[],
  clientId: string,
): RosterConfigRecord | null {
  return configs.find((config) => config.client_id === clientId) ?? null;
}

export function resolveCentralUniversityClientId(
  clients: ClientEntry[],
): string | null {
  const match = clients.find((client) => {
    const id = client.client_id.trim().toUpperCase();
    const name = client.client_name.trim().toLowerCase();
    return (
      id === "CL-001" ||
      id === "CLI001" ||
      id === "CL001" ||
      name.includes("central university")
    );
  });

  return match?.client_id ?? null;
}
