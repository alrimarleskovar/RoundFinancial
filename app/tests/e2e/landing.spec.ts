import { test, expect } from "@playwright/test";

test.describe("/ — public landing", () => {
  test.beforeEach(async ({ context }) => {
    // Pin locale to EN so text assertions are stable across CI runs;
    // the default `roundfi.lang` localStorage value is "pt".
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("roundfi.lang", "en");
      } catch {
        /* private mode — ignore */
      }
    });
  });

  test("renders hero, wallet connect, and key sections", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");

    // Hero — pinned EN copy (i18n key `landing.hero.title1`).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Collateral that earns/i)).toBeVisible();
    await expect(page.getByText(/Credit that scales/i)).toBeVisible();

    // Wallet adapter button — its inner text is "Select Wallet" until
    // a wallet is selected. Use a generous selector so it matches the
    // button regardless of state.
    await expect(
      page.locator("button.wallet-adapter-button, [class*='wallet-adapter-button']").first(),
    ).toBeVisible();

    // No console errors caught during the initial render. We tolerate
    // wallet-adapter's harmless "Wallet not ready" warnings (they
    // surface as `warn`, not `error`) — that's why this only checks
    // hard errors.
    expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("language toggle flips hero copy to PT", async ({ page }) => {
    // Start in EN (per beforeEach), flip to PT via localStorage and
    // reload — the i18n provider hydrates from storage on mount.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.setItem("roundfi.lang", "pt"));
    await page.reload();

    await expect(page.getByText(/Colateral que rende/i)).toBeVisible();
    await expect(page.getByText(/Crédito que expande/i)).toBeVisible();
  });
});
