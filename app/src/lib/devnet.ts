/**
 * Devnet on-chain reference points — single source of truth for the
 * front-end's read-only display of live protocol state.
 *
 * These values mirror `config/program-ids.devnet.json` at the repo
 * root. Hardcoding them here is fine for the hackathon demo; a
 * production deploy would read from a typed env var, a remote
 * config service, or a build-time generated module.
 */

import { PublicKey } from "@solana/web3.js";

export const DEVNET_PROGRAM_IDS = {
  core: new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw"),
  reputation: new PublicKey("Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2"),
  yieldKamino: new PublicKey("74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb"),
  yieldMock: new PublicKey("GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ"),
} as const;

export const DEVNET_DEPLOYER = new PublicKey("64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm");

export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/**
 * Pools driven on devnet so far. Pinned PDAs let the UI render real
 * state without an indexer / search.
 */
export const DEVNET_POOLS = {
  pool1: {
    seedId: 1n,
    pda: new PublicKey("5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa"),
    label: "Pool 1 · 3 members · Completed",
    headline: "Full lifecycle: contributions → claims → escrow release → close",
  },
  pool2: {
    seedId: 2n,
    pda: new PublicKey("8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm"),
    label: "Pool 2 · 3 members · 1h cycle · Active",
    headline: "Live cycles + idle yield deposits + escape valve list",
  },
  pool3: {
    seedId: 3n,
    pda: new PublicKey("D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5"),
    label: "Pool 3 · 3 members · 60s grace · Default",
    headline: "Triple Shield enforcement: settle_default with stake seizure",
  },
} as const;

export type DevnetPoolKey = keyof typeof DEVNET_POOLS;
