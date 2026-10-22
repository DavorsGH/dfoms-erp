"use client";

import { useMemo, useState } from "react";
import {
  contractKeyForStoredRecord,
  listOperationsContractChoices,
  siteProjectCode,
  sitesForContract,
  type ContractSiteOption,
} from "@/lib/operations-contract-scope";
import type { RosterContractProject } from "@/lib/roster-contract-choices";

export function useOperationsContracts(
  projects: RosterContractProject[],
  sites: ContractSiteOption[],
) {
  const choices = useMemo(
    () =>
      listOperationsContractChoices({
        projects,
        sites: sites.map((site) => ({
          client_id: site.client_id,
          project_code: siteProjectCode(site) || null,
        })),
      }),
    [projects, sites],
  );
  const [filterContractKey, setFilterContractKey] = useState("");
  const [formContractKey, setFormContractKey] = useState("");
  const filterChoice =
    choices.find((choice) => choice.groupKey === filterContractKey) ?? null;
  const formChoice =
    choices.find((choice) => choice.groupKey === formContractKey) ?? null;

  const filterSites = useMemo(() => {
    if (!filterContractKey) {
      return sites;
    }
    return sitesForContract(sites, filterContractKey, projects);
  }, [filterContractKey, projects, sites]);

  const formSites = useMemo(() => {
    if (!formContractKey) {
      return [];
    }
    return sitesForContract(sites, formContractKey, projects);
  }, [formContractKey, projects, sites]);

  function keyFor(clientId: string | null | undefined, siteCode: string | null | undefined) {
    const site = sites.find((entry) => entry.site_code === siteCode);
    return contractKeyForStoredRecord({
      clientId,
      siteProjectCode: siteProjectCode(site),
      projects,
      choices,
    });
  }

  function labelFor(
    clientId: string | null | undefined,
    siteCode: string | null | undefined,
    fallback: string,
  ) {
    const key = keyFor(clientId, siteCode);
    return choices.find((choice) => choice.groupKey === key)?.label ?? fallback;
  }

  function matchesFilter(clientId: string | null | undefined) {
    if (!filterContractKey) {
      return true;
    }
    return (clientId ?? "") === (filterChoice?.clientId ?? "");
  }

  return {
    choices,
    filterContractKey,
    setFilterContractKey,
    formContractKey,
    setFormContractKey,
    formChoice,
    filterSites,
    formSites,
    keyFor,
    labelFor,
    matchesFilter,
  };
}
