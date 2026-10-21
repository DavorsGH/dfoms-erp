"use client";

import { useEffect, useRef, useState } from "react";
import {
  defaultRosterContractKey,
  ROSTER_CONTRACT_STORAGE_KEY,
  type RosterContractChoice,
} from "@/lib/roster-contract-choices";

export function rememberRosterContract(groupKey: string) {
  try {
    if (groupKey) {
      sessionStorage.setItem(ROSTER_CONTRACT_STORAGE_KEY, groupKey);
    } else {
      sessionStorage.removeItem(ROSTER_CONTRACT_STORAGE_KEY);
    }
  } catch {
    // Private browsing can block sessionStorage.
  }
}

export function useRosterContractSelection(choices: RosterContractChoice[]) {
  const [groupKey, setGroupKey] = useState("");
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current || choices.length === 0) {
      return;
    }
    didInit.current = true;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(ROSTER_CONTRACT_STORAGE_KEY);
    } catch {
      stored = null;
    }
    setGroupKey(defaultRosterContractKey(choices, stored));
  }, [choices]);

  function selectContract(next: string) {
    setGroupKey(next);
    rememberRosterContract(next);
  }

  const selected = choices.find((choice) => choice.groupKey === groupKey) ?? null;
  return { groupKey, selected, selectContract };
}
