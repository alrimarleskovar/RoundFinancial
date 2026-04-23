import type { AnyIdl, RoundFiIdls } from "@roundfi/sdk";

/**
 * IDL loader for real mode.
 *
 * IDLs are produced by `anchor build` into `<repo>/target/idl/*.json`.
 * Run `pnpm --filter @roundfi/app prepare-idls` to copy them into
 * `app/public/idls/*.json`, after which the browser can fetch them
 * from `/idls/<name>.json`.
 *
 * If any IDL is missing, `loadIdls()` throws a caller-friendly error
 * that the real driver turns into a visible `action.fail` event so the
 * user sees the fix instructions rather than a silent crash.
 */

const IDL_BASE = "/idls";

export const IDL_FILES = {
  core: "roundfi_core.json",
  reputation: "roundfi_reputation.json",
  yieldAdapter: "roundfi_yield_mock.json",
} as const;

async function fetchIdl(file: string): Promise<AnyIdl> {
  const url = `${IDL_BASE}/${file}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `IDL not found at ${url} (HTTP ${res.status}). ` +
        `Run \`anchor build\` then \`pnpm --filter @roundfi/app prepare-idls\` ` +
        `to populate app/public/idls/.`,
    );
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as AnyIdl;
  } catch (err) {
    throw new Error(
      `Failed to parse IDL at ${url}: ${(err as Error).message}`,
    );
  }
}

export async function loadIdls(): Promise<RoundFiIdls> {
  const [core, reputation, yieldAdapter] = await Promise.all([
    fetchIdl(IDL_FILES.core),
    fetchIdl(IDL_FILES.reputation),
    fetchIdl(IDL_FILES.yieldAdapter),
  ]);
  return { core, reputation, yieldAdapter };
}
