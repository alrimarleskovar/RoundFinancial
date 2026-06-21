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

// Hover relief for inline-styled buttons. CSS `:hover` can't reach inline
// styles, so interactive buttons built with the `style` prop need JS handlers
// to get any pointer feedback (same idiom as DeskBtn). A subtle lift plus a
// brightness bump that settles on leave — reads well on both gradient and
// subtle fill buttons. Pair with a `transition` that animates transform +
// filter on the button. Disabled buttons don't receive pointer events, so this
// is automatically inert while a CTA is mid-submit.
export function hoverBtn(lift = 2) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.transform = `translateY(-${lift}px)`;
      e.currentTarget.style.filter = "brightness(1.1)";
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.filter = "none";
    },
  };
}
