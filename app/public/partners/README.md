# Partner Logos

Drop the partner brand assets in this folder with the **exact filenames** below — the landing-page footers reference these paths at runtime.

| Filename | Status | Where to grab it |
|---|---|---|
| `solana.svg` | ⚠️ mark only | https://solana.com/branding · what we hold is the bare 101×88 symbol. The **wordmark** (white text + gradient mark) reads far better in a footer strip — worth replacing. |
| `colosseum.svg` | ✅ present | https://www.colosseum.com/ press kit, or right-click the logo on their landing. |
| `kamino.svg` | ⚠️ opaque plate | https://app.kamino.finance/ press kit. What we hold is a 540×540 square whose first element is `<rect fill="#082A56"/>` — an **opaque** navy background, against the guidance below. The footers round the corners so it reads as an app icon instead of a broken tile, but a transparent-background asset would be better. |

## What does NOT belong here

**No auditor logos.** `SECURITY.md` states outright that no external auditor has
reviewed this code: Adevar Labs / Halborn / OtterSec / **Sec3** are four
*candidate* firms and the selection is still pending. A logo in a footer reads
as "audited by", so none of the four goes in until an engagement is signed — and
then only the firm that actually did the work.

The same test applies to anyone else: a mark here asserts a real relationship.
If we can't point at the integration or the contract, the logo doesn't ship.

## Format guidelines

- **Format**: SVG strongly preferred (scales cleanly + tiny file size). PNG with transparent background is acceptable.
- **Color**: white or full-color on transparent. The footer applies a `grayscale opacity-50` filter that brightens to full color on hover, so dark-mode-friendly logos work best.
- **Aspect**: any. The footer normalizes height to ~28px on desktop, ~22px on mobile, width auto.

If a logo only has a colored version, that's fine — the grayscale CSS filter neutralizes the saturation until hover.
