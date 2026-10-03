const TEAL_DOT = "#1FA88A";

const STROKE_BY_COLOR = {
  light: "#FFFFFF",
  dark: "#0f2744",
} as const;

type DavSuiteMarkProps = {
  color?: keyof typeof STROKE_BY_COLOR;
  className?: string;
};

/** Bare DavSuite bracket mark (no square background) for use beside the DAVSUITE wordmark. */
export default function DavSuiteMark({
  color = "light",
  className = "block h-11 w-auto shrink-0",
}: DavSuiteMarkProps) {
  const stroke = STROKE_BY_COLOR[color];

  return (
    <svg
      viewBox="50 66 104 84"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DavSuite"
      className={className}
    >
      <path
        d="M 60,140 L 60,80 L 96,80"
        fill="none"
        stroke={stroke}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 74,140 L 140,140 L 140,104"
        fill="none"
        stroke={stroke}
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={140} cy={80} r={11} fill={TEAL_DOT} />
    </svg>
  );
}
