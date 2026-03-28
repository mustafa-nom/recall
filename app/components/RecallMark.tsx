/**
 * Recall brand mark — transparent SVG (no background). Uses currentColor for themeable blue via text-accent.
 */
export function RecallMark({
  className,
  "aria-hidden": ariaHidden = true,
}: {
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 120"
      fill="none"
      className={className}
      aria-hidden={ariaHidden}
    >
      <circle cx="30" cy="60" r="11" fill="currentColor" />
      <circle cx="210" cy="60" r="11" fill="currentColor" />
      <line
        x1="41"
        y1="60"
        x2="75"
        y2="60"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <line
        x1="165"
        y1="60"
        x2="199"
        y2="60"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <polyline
        points="75,60 100,30 140,30 165,60"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="75,60 100,90 140,90 165,60"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
