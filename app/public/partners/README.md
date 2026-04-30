# Partner Logos

Drop the 3 partner brand assets in this folder with the **exact filenames** below — the landing-page footer references these paths at runtime.

| Filename | Where to grab it |
|---|---|
| `solana.svg` | https://solana.com/branding · prefer the wordmark in dark-mode (white text + gradient mark). SVG ideal. |
| `colosseum.svg` | https://www.colosseum.com/ press kit, or right-click the logo on their landing. |
| `kamino.svg` | https://app.kamino.finance/ press kit, or extract from their site favicon-set. |

## Format guidelines

- **Format**: SVG strongly preferred (scales cleanly + tiny file size). PNG with transparent background is acceptable.
- **Color**: white or full-color on transparent. The footer applies a `grayscale opacity-50` filter that brightens to full color on hover, so dark-mode-friendly logos work best.
- **Aspect**: any. The footer normalizes height to ~28px on desktop, ~22px on mobile, width auto.

If a logo only has a colored version, that's fine — the grayscale CSS filter neutralizes the saturation until hover.
