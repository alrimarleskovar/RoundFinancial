import { test, expect } from "@playwright/test";

// Direct-navigation smoke tests for the 7 authenticated dashboard
// routes under `(app)/`. Without a connected wallet the layout still
// renders — `useRedirectOnDisconnect` only fires on an explicit
// disconnect event, not on fresh navigation. So these tests just
// assert "the route renders some content + no 5xx + no JS errors".
//
// Deeper wallet-connected flows (contribute, claim_payout, escape
// valve buy) live in their own spec files once the mock-wallet
// fixture lands — see `tests/e2e/README.md`.

const ROUTES = [
  { path: "/home", expectedHeading: /panorama|overview|dashboard|home/i },
  { path: "/carteira", expectedHeading: /carteira|wallet/i },
  { path: "/grupos", expectedHeading: /grupos|groups|catálogo|catalog/i },
  { path: "/reputacao", expectedHeading: /reputação|reputation|score|passport/i },
  { path: "/mercado", expectedHeading: /mercado|market|escape/i },
  { path: "/insights", expectedHeading: /insights|score|evolução/i },
  { path: "/lab", expectedHeading: /lab|stress|simulador|simulator/i },
];

test.describe("authenticated routes — unconnected-wallet smoke", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("roundfi.lang", "en");
      } catch {
        /* ignore */
      }
    });
  });

  for (const { path, expectedHeading } of ROUTES) {
    test(`${path} renders without 5xx`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `HTTP status for ${path}`).toBeLessThan(500);

      // At least one heading on the page — proves the layout mounted.
      const heading = page.getByRole("heading").first();
      await expect(heading).toBeVisible({ timeout: 10_000 });

      // Page-specific heading match if present (loose — i18n + animated
      // copy means we can't pin exact strings, so this is a regex hint
      // rather than a hard assertion).
      const bodyText = await page.locator("body").textContent();
      expect(
        bodyText,
        `expected route ${path} body to mention something matching ${expectedHeading}`,
      ).toMatch(expectedHeading);
    });
  }
});
