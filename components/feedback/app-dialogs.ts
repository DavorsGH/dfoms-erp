import type {
  AlertOptions,
  ConfirmOptions,
  PromptOptions,
} from "./feedback-context";

export type DialogDetailRow = {
  label: string;
  value: string | number;
};

export type ConfirmDialogOptions = Omit<ConfirmOptions, "destructive"> & {
  tone?: "default" | "danger";
  /** @deprecated Use tone: "danger" */
  destructive?: boolean;
  details?: DialogDetailRow[];
};

export type AlertDialogOptions = AlertOptions;

export type PromptDialogOptions = PromptOptions;

type DialogBridge = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

let bridge: DialogBridge | null = null;

export function bindAppDialogBridge(next: DialogBridge | null) {
  bridge = next;
}

function requireBridge(): DialogBridge {
  if (!bridge) {
    throw new Error(
      "App dialogs are not available yet. Wrap the app in FeedbackProvider.",
    );
  }
  return bridge;
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const { tone, destructive, details, ...rest } = options;
  return requireBridge().confirm({
    ...rest,
    details,
    destructive: tone === "danger" || destructive === true,
  });
}

export function alertDialog(options: AlertDialogOptions): Promise<void> {
  return requireBridge().alert(options);
}

export function promptDialog(
  options: PromptDialogOptions,
): Promise<string | null> {
  return requireBridge().prompt(options);
}
