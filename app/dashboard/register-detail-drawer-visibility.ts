"use client";

type RegisterDetailDrawerListener = (open: boolean) => void;

let openDrawerCount = 0;
const listeners = new Set<RegisterDetailDrawerListener>();

/** Register record detail drawers call this when opening/closing (supports nested). */
export function notifyRegisterDetailDrawerOpen(open: boolean): void {
  openDrawerCount = Math.max(0, openDrawerCount + (open ? 1 : -1));
  const isOpen = openDrawerCount > 0;
  for (const listener of listeners) {
    listener(isOpen);
  }
}

export function subscribeRegisterDetailDrawerOpen(
  listener: RegisterDetailDrawerListener,
): () => void {
  listeners.add(listener);
  listener(openDrawerCount > 0);
  return () => {
    listeners.delete(listener);
  };
}
