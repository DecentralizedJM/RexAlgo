import { cn } from "@/lib/utils";
import webhooksMarkSrc from "@/assets/webhooks-mark.svg?url";

/** Webhooks glyph (SVG Repo), bundled for the TradingView webhooks page and nav. */
export function WebhooksMark({
  className,
  height = 18,
}: {
  className?: string;
  /** Box height in CSS pixels (non-square viewBox is letterboxed). */
  height?: number;
}) {
  const px = `${height}px`;
  return (
    <img
      src={webhooksMarkSrc}
      alt=""
      width={height}
      height={height}
      decoding="async"
      draggable={false}
      aria-hidden
      className={cn(
        "block shrink-0 max-w-none select-none object-contain opacity-90",
        className
      )}
      style={{
        width: px,
        height: px,
        minWidth: px,
        minHeight: px,
        flexShrink: 0,
      }}
    />
  );
}
