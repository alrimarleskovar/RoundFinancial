import { test, expect } from "@playwright/test";

// Smoke coverage for the public landing at `/`.
//
// Rewritten when the landing graduated from `/landing-v2`. The previous
// version asserted the page it replaced — the old hero copy, and a
// `wallet-adapter-button` that the current landing does not render at all
// (it links out to /grupos instead of connecting in place). Those
// assertions could only fail from here on, and the e2e lane is advisory
// (`continue-on-error` on both the job and the step), so nothing in CI
// would have said so.
//
// Language is component state on this page, not the app-wide
// `roundfi.lang` key the dashboard reads — so it always loads in PT and
// the toggle is driven by clicking it, not by seeding localStorage.

test.describe("/ — public landing", () => {
  test("renders hero, primary CTA and key sections", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      // Subresource fetch failures are a property of the network the run
      // sits on, not of the page — a sandbox that blocks the webfont CDN
      // would fail this for a reason the landing has no say in. Page
      // defects (exceptions, React errors) still come through.
      if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // Hero — PT is the default language. Scoped to the h1 because the
    // headline copy also appears in the page's other breakpoints.
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible();
    await expect(hero).toContainText("Contribua em grupo.");
    await expect(hero).toContainText("Construa reputação.");

    // The primary CTA is a link into the app, not an in-place connect.
    // Both the header and the hero carry one; either proves the path out.
    await expect(page.locator('a[href="/grupos"]').first()).toBeVisible();

    // A couple of anchors further down, so a hero-only render fails loudly.
    await expect(page.locator("#como-funciona")).toBeAttached();
    await expect(page.locator("#simulador")).toBeAttached();

    // Wallet-adapter emits "Wallet not ready" as a warning, not an error,
    // so this stays a hard-error check.
    expect(consoleErrors, `console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("language toggle flips hero copy to EN", async ({ page }) => {
    await page.goto("/");
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toContainText("Realize objetivos.");

    await page.getByLabel("Alternar idioma").click();

    await expect(hero).toContainText("Contribute together.");
    await expect(hero).toContainText("Build reputation.");
  });

  test("the retired candidate route is gone", async ({ page }) => {
    // /landing-v2 was the review route this page graduated from. Asserting
    // the 404 keeps a stale copy from being resurrected unnoticed.
    const response = await page.goto("/landing-v2");
    expect(response?.status()).toBe(404);
  });
});
