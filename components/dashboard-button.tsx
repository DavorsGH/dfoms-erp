"use client";

import Tooltip, { type TooltipVariant } from "@/components/ui/tooltip";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type DashboardButtonVariant =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "secondary"
  | "paymentLink";

const variantClassName: Record<DashboardButtonVariant, string> = {
  primary:
    "border border-transparent bg-[#0f2744] text-white hover:bg-[#1a3a5c]",
  success:
    "border border-transparent bg-emerald-700 text-white hover:bg-emerald-800",
  warning:
    "border border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100",
  danger:
    "border border-red-300 bg-white text-red-800 hover:bg-red-50",
  secondary:
    "border border-slate-300 bg-white text-[#0f2744] hover:bg-slate-50",
  paymentLink:
    "border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
};

type DashboardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: DashboardButtonVariant;
  icon?: ReactNode;
  tooltip?: string;
  tooltipVariant?: TooltipVariant;
};

export default function DashboardButton({
  variant = "primary",
  icon,
  tooltip,
  tooltipVariant,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: DashboardButtonProps) {
  const button = (
    <button
      type={type}
      disabled={disabled}
      aria-label={tooltip && !children ? tooltip : undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClassName[variant]} ${className}`}
      {...rest}
    >
      {icon ? <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );

  if (tooltip?.trim()) {
    const variant =
      tooltipVariant ?? (disabled ? "blocked" : "info");
    return (
      <Tooltip content={tooltip} variant={variant}>
        {button}
      </Tooltip>
    );
  }

  return button;
}
