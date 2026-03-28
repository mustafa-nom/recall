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
    <img
      src="/recall-logo.png"
      alt="Recall Logo"
      className={className}
      aria-hidden={ariaHidden}
    />
  );
}
