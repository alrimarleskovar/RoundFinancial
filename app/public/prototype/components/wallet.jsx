// wallet.jsx — Real Phantom + Solana devnet integration for the prototype.
// Adds a `wallet` slice to APP_STATE (reuses the pub/sub from i18n.jsx),
// exposes `useWallet()` + imperative helpers, and talks to the browser's
// injected Phantom provider (window.solana) + the Solana devnet RPC.
//
// Depends on:
//   - @solana/web3.js global (window.solanaWeb3) — loaded from CDN in index.html
//   - APP_STATE, subscribe, notify (from i18n.jsx) — loaded before this file
//
// Devnet is the only cluster the prototype talks to; mainnet happens on
// the Next.js /demo side via wallet-adapter.

const DEVNET_RPC = 'https://api.devnet.solana.com';
const AIRDROP_LAMPORTS_DEFAULT = 1_000_000_000; // 1 SOL

const WALLET_EXPLORER = (sig) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const ADDR_EXPLORER = (addr) =>
  `https://explorer.solana.com/address/${addr}?cluster=devnet`;

// ── Wallet slice on APP_STATE ──────────────────────────────
// Only touches APP_STATE.wallet, plus flips APP_STATE.connections.phantom
// so the existing Connections card stays in sync with the real state.
APP_STATE.wallet = {
  status:    'disconnected',    // 'disconnected' | 'connecting' | 'connected' | 'error'
  publicKey: null,              // base58 string when connected
  balance:   null,              // lamports (bigint) when fetched
  network:   'devnet',
  rpc:       DEVNET_RPC,
  lastError: null,              // string | null
  lastTxSig: null,              // base58 string | null (last airdrop / tx)
  airdropping: false,
};

function _connection() {
  const { Connection, clusterApiUrl } = window.solanaWeb3 || {};
  if (!Connection) throw new Error('solanaWeb3 not loaded');
  return new Connection(APP_STATE.wallet.rpc || DEVNET_RPC, 'confirmed');
}

function _setWallet(patch) {
  APP_STATE.wallet = { ...APP_STATE.wallet, ...patch };
  // Keep the legacy Connections card's phantom status consistent.
  const cur = APP_STATE.connections?.phantom || {};
  const st = APP_STATE.wallet.status;
  const mapped =
    st === 'connected'  ? 'connected'  :
    st === 'connecting' ? 'pending'    :
                          'disconnected';
  APP_STATE.connections.phantom = { ...cur, status: mapped };
  notify();
}

// ── Phantom detection + event wiring ───────────────────────
function getPhantom() {
  if (typeof window === 'undefined') return null;
  // Phantom injects `window.solana` with isPhantom=true.
  // Some wallets (Brave) also expose window.phantom.solana.
  const provider = window.phantom?.solana || window.solana;
  return provider && provider.isPhantom ? provider : null;
}

function _wireProvider(provider) {
  if (!provider || provider.__rfiWired) return;
  provider.__rfiWired = true;
  provider.on?.('accountChanged', (pk) => {
    if (pk) {
      _setWallet({ status: 'connected', publicKey: pk.toString(), lastError: null });
      refreshBalance();
    } else {
      _setWallet({ status: 'disconnected', publicKey: null, balance: null });
    }
  });
  provider.on?.('disconnect', () => {
    _setWallet({ status: 'disconnected', publicKey: null, balance: null });
  });
}

// ── Imperative actions ─────────────────────────────────────
async function connectPhantom({ onlyIfTrusted = false } = {}) {
  const provider = getPhantom();
  if (!provider) {
    _setWallet({
      status: 'error',
      lastError: 'phantom_not_installed',
    });
    return { ok: false, reason: 'phantom_not_installed' };
  }
  _wireProvider(provider);
  _setWallet({ status: 'connecting', lastError: null });
  try {
    const res = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
    const pk = res?.publicKey?.toString() || provider.publicKey?.toString();
    if (!pk) throw new Error('no_public_key');
    _setWallet({ status: 'connected', publicKey: pk, lastError: null });
    refreshBalance();
    return { ok: true, publicKey: pk };
  } catch (err) {
    const code = err?.code;
    // 4001 = user rejected
    const reason = code === 4001 ? 'user_rejected' : (err?.message || 'connect_failed');
    _setWallet({ status: 'disconnected', lastError: reason });
    return { ok: false, reason };
  }
}

async function disconnectPhantom() {
  const provider = getPhantom();
  try {
    await provider?.disconnect?.();
  } catch (_) { /* ignore */ }
  _setWallet({ status: 'disconnected', publicKey: null, balance: null, lastError: null });
  return { ok: true };
}

async function refreshBalance() {
  const { publicKey } = APP_STATE.wallet;
  if (!publicKey) return;
  try {
    const { PublicKey } = window.solanaWeb3;
    const conn = _connection();
    const lamports = await conn.getBalance(new PublicKey(publicKey), 'confirmed');
    _setWallet({ balance: lamports });
  } catch (err) {
    _setWallet({ lastError: `balance_fetch_failed: ${err?.message || err}` });
  }
}

// Request a devnet SOL airdrop. Rate-limited by the public RPC (~1 SOL/req,
// a handful per IP per minute). If the public faucet rejects, we surface
// the error so the UI can point users to the hosted faucet as fallback.
async function requestAirdrop(lamports = AIRDROP_LAMPORTS_DEFAULT) {
  const { publicKey } = APP_STATE.wallet;
  if (!publicKey) return { ok: false, reason: 'not_connected' };
  const { PublicKey } = window.solanaWeb3;
  const conn = _connection();
  _setWallet({ airdropping: true, lastError: null });
  try {
    const sig = await conn.requestAirdrop(new PublicKey(publicKey), lamports);
    await conn.confirmTransaction(sig, 'confirmed');
    _setWallet({ airdropping: false, lastTxSig: sig });
    refreshBalance();
    return { ok: true, signature: sig };
  } catch (err) {
    const msg = err?.message || String(err);
    const reason =
      /429|rate.?limit|too many/i.test(msg) ? 'rate_limited' :
      /airdrop.*limit/i.test(msg)           ? 'airdrop_limit' :
                                              msg;
    _setWallet({ airdropping: false, lastError: reason });
    return { ok: false, reason };
  }
}

// ── Try eager reconnect on load ────────────────────────────
// If the user previously approved the site, Phantom reconnects silently.
(function eagerReconnect() {
  if (typeof window === 'undefined') return;
  const tryIt = () => {
    const provider = getPhantom();
    if (!provider) return;
    _wireProvider(provider);
    connectPhantom({ onlyIfTrusted: true }).catch(() => {});
  };
  if (document.readyState === 'complete') setTimeout(tryIt, 0);
  else window.addEventListener('load', tryIt, { once: true });
})();

// ── React hook ─────────────────────────────────────────────
function useWallet() {
  useAppState(); // re-renders on any notify()
  const w = APP_STATE.wallet;
  const { LAMPORTS_PER_SOL } = window.solanaWeb3 || { LAMPORTS_PER_SOL: 1e9 };
  return {
    ...w,
    balanceSol: w.balance == null ? null : Number(w.balance) / LAMPORTS_PER_SOL,
    isInstalled: !!getPhantom(),
    connect: connectPhantom,
    disconnect: disconnectPhantom,
    airdrop: requestAirdrop,
    refresh: refreshBalance,
    explorerTx: WALLET_EXPLORER,
    explorerAddr: ADDR_EXPLORER,
  };
}

// Helper: short address like "4xRf…KpQ2" for UI.
function shortAddr(addr, left = 4, right = 4) {
  if (!addr || addr.length <= left + right + 1) return addr || '';
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

Object.assign(window, {
  DEVNET_RPC,
  connectPhantom, disconnectPhantom, refreshBalance, requestAirdrop,
  getPhantom, useWallet, shortAddr,
  WALLET_EXPLORER, ADDR_EXPLORER,
});
