import type { PosCartLine } from "@/app/dashboard/pos/pos-utils";

export const POS_CUSTOMER_DISPLAY_SESSION_STORAGE_KEY =
  "dfoms-pos-customer-display-session-id";

export type PosCustomerDisplayLine = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unitOfMeasure: string;
};

export type PosCustomerDisplayPayload = {
  cartLines: PosCustomerDisplayLine[];
  subtotal: number;
  promoDiscount: number;
  promoCode: string | null;
  loyaltyDiscount: number;
  taxAmount: number | null;
  amountDue: number;
  customerLabel: string;
  servedByLabel?: string | null;
  paymentMethod?: string | null;
  amountTendered?: number | null;
  changeDue?: number | null;
  updatedAt: string;
};

export function getOrCreatePosCustomerDisplaySessionId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const existing = sessionStorage.getItem(POS_CUSTOMER_DISPLAY_SESSION_STORAGE_KEY);
  if (existing?.trim()) {
    return existing.trim();
  }

  const sessionId = crypto.randomUUID();
  sessionStorage.setItem(POS_CUSTOMER_DISPLAY_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

export function buildPosCustomerDisplayChannelName(
  tenantId: string,
  businessUnitId: string | null | undefined,
  sessionId: string,
): string {
  const tenant = tenantId.trim();
  const bu = businessUnitId?.trim() || "all";
  const session = sessionId.trim();
  return `dfoms-pos-display:${tenant}:${bu}:${session}`;
}

export function posCartLinesToDisplayLines(
  cartLines: PosCartLine[],
): PosCustomerDisplayLine[] {
  return cartLines.map((line) => ({
    id: line.id,
    productName: line.productName,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: Math.round(line.quantity * line.unitPrice * 100) / 100,
    unitOfMeasure: line.unitOfMeasure,
  }));
}

export function openPosCustomerDisplayWindow(sessionId: string): Window | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = `/pos-customer-display?session=${encodeURIComponent(sessionId)}`;
  return window.open(
    url,
    "dfoms-pos-customer-display",
    "popup=yes,width=960,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes",
  );
}

type PosCustomerDisplayChannel = {
  post: (payload: PosCustomerDisplayPayload) => void;
  close: () => void;
};

export function createPosCustomerDisplayBroadcaster(
  tenantId: string,
  businessUnitId: string | null | undefined,
  sessionId: string,
): PosCustomerDisplayChannel | null {
  if (typeof window === "undefined" || !tenantId.trim() || !sessionId.trim()) {
    return null;
  }

  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  const channelName = buildPosCustomerDisplayChannelName(
    tenantId,
    businessUnitId,
    sessionId,
  );
  const channel = new BroadcastChannel(channelName);

  return {
    post(payload: PosCustomerDisplayPayload) {
      channel.postMessage(payload);
    },
    close() {
      channel.close();
    },
  };
}

export function subscribePosCustomerDisplay(
  channelName: string,
  onPayload: (payload: PosCustomerDisplayPayload) => void,
): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  const channel = new BroadcastChannel(channelName);
  const handler = (event: MessageEvent<PosCustomerDisplayPayload>) => {
    if (!event.data || typeof event.data !== "object") {
      return;
    }
    onPayload(event.data);
  };

  channel.addEventListener("message", handler);

  return () => {
    channel.removeEventListener("message", handler);
    channel.close();
  };
}
