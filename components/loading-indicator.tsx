type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const spinnerSizeClassName = {
  sm: "h-4 w-4 border",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-[3px]",
};

export function LoadingSpinner({
  size = "md",
  className = "",
}: LoadingSpinnerProps) {
  return (
    <div
      className={`${spinnerSizeClassName[size]} animate-spin rounded-full border-slate-200 border-t-[#0f2744] ${className}`.trim()}
      role="status"
      aria-label="Loading"
    />
  );
}

type LoadingStateProps = {
  label?: string;
  size?: "sm" | "md" | "lg";
  layout?: "inline" | "section" | "page";
  className?: string;
};

export function LoadingState({
  label,
  size = "md",
  layout = "section",
  className = "",
}: LoadingStateProps) {
  const layoutClassName = {
    inline: "flex items-center justify-center gap-3 py-8",
    section:
      "flex min-h-[min(16rem,calc(100vh-16rem))] w-full flex-col items-center justify-center gap-3 py-12",
    page: "flex min-h-[min(24rem,calc(100vh-10rem))] w-full flex-col items-center justify-center gap-3",
  }[layout];

  return (
    <div
      className={`${layoutClassName} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoadingSpinner size={size} />
      {label ? <p className="text-sm text-slate-600">{label}</p> : null}
    </div>
  );
}
