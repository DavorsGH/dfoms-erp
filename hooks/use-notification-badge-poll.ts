"use client";

import { useEffect, useState } from "react";

const BADGE_POLL_MS = 60_000;
/** Collapse remount/HMR bursts into at most one fetch per window. */
const BADGE_DEDUPE_MS = 55_000;

type EndpointPollState = {
  lastFetchAt: number;
  lastUnreadCount: number;
  inFlight: Promise<number> | null;
  listeners: Set<(count: number) => void>;
  subscriberCount: number;
};

let pollTimer: number | null = null;
const endpointStates = new Map<string, EndpointPollState>();

function getEndpointState(endpoint: string): EndpointPollState {
  let state = endpointStates.get(endpoint);
  if (!state) {
    state = {
      lastFetchAt: 0,
      lastUnreadCount: 0,
      inFlight: null,
      listeners: new Set(),
      subscriberCount: 0,
    };
    endpointStates.set(endpoint, state);
  }
  return state;
}

function hasActiveSubscribers(): boolean {
  for (const state of endpointStates.values()) {
    if (state.subscriberCount > 0) {
      return true;
    }
  }
  return false;
}

async function fetchUnreadCount(endpoint: string): Promise<number> {
  const state = getEndpointState(endpoint);
  const now = Date.now();

  if (state.inFlight) {
    return state.inFlight;
  }
  if (now - state.lastFetchAt < BADGE_DEDUPE_MS) {
    return state.lastUnreadCount;
  }

  state.lastFetchAt = now;
  state.inFlight = (async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        return state.lastUnreadCount;
      }
      const payload = (await response.json()) as { unreadCount?: number };
      state.lastUnreadCount = payload.unreadCount ?? 0;
      for (const listener of state.listeners) {
        listener(state.lastUnreadCount);
      }
      return state.lastUnreadCount;
    } catch {
      return state.lastUnreadCount;
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
}

function ensurePolling() {
  if (pollTimer) {
    return;
  }

  pollTimer = window.setInterval(() => {
    for (const [endpoint, state] of endpointStates) {
      if (state.subscriberCount > 0) {
        void fetchUnreadCount(endpoint);
      }
    }
  }, BADGE_POLL_MS);
}

function stopPollingIfIdle() {
  if (hasActiveSubscribers()) {
    return;
  }

  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Shared 60s badge poll — survives bell remounts and dedupes rapid re-subscribes. */
export function useNotificationBadgePoll(endpoint: string): number {
  const [unreadCount, setUnreadCount] = useState(
    () => getEndpointState(endpoint).lastUnreadCount,
  );

  useEffect(() => {
    const state = getEndpointState(endpoint);
    state.subscriberCount += 1;

    const onCount = (count: number) => setUnreadCount(count);
    state.listeners.add(onCount);
    ensurePolling();
    void fetchUnreadCount(endpoint).then(onCount);

    return () => {
      state.listeners.delete(onCount);
      state.subscriberCount = Math.max(0, state.subscriberCount - 1);
      stopPollingIfIdle();
    };
  }, [endpoint]);

  return unreadCount;
}

/** Reset cached badge after local inbox mutations (mark read, delete, etc.). */
export function setNotificationBadgeCount(
  endpoint: string,
  count: number,
): void {
  const state = getEndpointState(endpoint);
  state.lastUnreadCount = Math.max(0, count);
  for (const listener of state.listeners) {
    listener(state.lastUnreadCount);
  }
}
