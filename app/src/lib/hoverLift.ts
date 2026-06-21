import type { MouseEvent } from "react";

// Shared dashboard-card hover: a subtle lift plus a tone-colored border,
// reverting to an explicit base color on leave (default transparent).
//
// It deliberately never reverts borderColor to "" — that drops the inline
// color and the element falls back to the white `currentColor`, which was
// the bright edge that lingered after the first hover. Pair this with a
// `1px solid transparent` base border + a border-color transition on the
// element so the outline only shows on hover (the reputacao card look).
export function liftHover(toneColor: string, base = "transparent", lift = 2) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.transform = `translateY(-${lift}px)`;
      e.currentTarget.style.borderColor = `${toneColor}55`;
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.borderColor = base;
    },
  };
}
