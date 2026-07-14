/*
 * Vouchsafe — browser wallet integration (EIP-1193, MetaMask-compatible).
 * Connects an injected wallet, switches/adds Flare Coston2, and issues the quorum transactions
 * (stake, endorse) plus the reads behind the wallet panel. ABI encoding is done by hand with the
 * page's keccak lib — no bundler, no external dependencies.
 */
(function () {
  "use strict";

  const H = window.VouchsafeHash;
  const CHAIN_HEX = "0x72"; // Coston2, chain id 114
  const COSTON2_PARAMS = {
    chainId: CHAIN_HEX,
    chainName: "Flare Testnet Coston2",
    nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
    rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
    blockExplorerUrls: ["https://coston2-explorer.flare.network"],
  };

  // 4-byte selectors computed with the same keccak the commitment builder uses.
  const selector = (sig) => H.keccak256Hex(new TextEncoder().encode(sig)).slice(0, 10);
  const SEL = {
    stake: selector("stake()"),
    stakeOf: selector("stakeOf(address)"),
    minStake: selector("minStake()"),
    endorse: selector("endorse(bytes32)"),
    requiredStakeFor: selector("requiredStakeFor(address)"),
  };
  const addrWord = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const b32Word = (h) => h.toLowerCase().replace(/^0x/, "").padStart(64, "0");

  let account = null;
  let addresses = null; // contract addresses, injected from /api/health
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn(account));

  const eth = () => window.ethereum;
  const available = () => typeof window.ethereum !== "undefined";

  const requireReady = () => {
    if (!available()) throw new Error("No browser wallet found — install MetaMask to endorse from your own key");
    if (!addresses) throw new Error("Contract addresses not loaded yet (is the service running?)");
  };

  async function ensureChain() {
    try {
      await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      const code = e && (e.code ?? (e.data && e.data.originalError && e.data.originalError.code));
      if (code === 4902) await eth().request({ method: "wallet_addEthereumChain", params: [COSTON2_PARAMS] });
      else throw e;
    }
  }

  async function connect() {
    requireReady();
    const accounts = await eth().request({ method: "eth_requestAccounts" });
    await ensureChain();
    account = accounts[0] || null;
    if (eth().on && !connect._wired) {
      connect._wired = true;
      eth().on("accountsChanged", (a) => { account = a[0] || null; emit(); });
    }
    emit();
    return account;
  }

  async function call(to, data) {
    return eth().request({ method: "eth_call", params: [{ to, data }, "latest"] });
  }

  /** Send a transaction and wait for its receipt (Coston2 blocks land in a few seconds). */
  async function send(to, data, valueWei) {
    if (!account) throw new Error("Connect the wallet first");
    const tx = { from: account, to, data };
    if (valueWei) tx.value = "0x" + BigInt(valueWei).toString(16);
    const txHash = await eth().request({ method: "eth_sendTransaction", params: [tx] });
    for (let i = 0; i < 120; i++) {
      const receipt = await eth().request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("transaction reverted on-chain");
        return txHash;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("timed out waiting for the transaction receipt");
  }

  // --- reads ---
  const stakeOf = async (addr) => BigInt(await call(addresses.AttestorStaking, SEL.stakeOf + addrWord(addr)));
  const minStake = async () => BigInt(await call(addresses.AttestorStaking, SEL.minStake));
  const requiredStakeFor = async (subject) =>
    BigInt(await call(addresses.SolvencyVerifier, SEL.requiredStakeFor + addrWord(subject)));

  // --- transactions ---
  const stake = (amountWei) => send(addresses.AttestorStaking, SEL.stake, amountWei);
  const endorse = (id) => send(addresses.SolvencyVerifier, SEL.endorse + b32Word(id));

  /** Format wei as C2FLR with up to 4 decimals (display only). */
  function formatFlr(wei) {
    const whole = wei / 10n ** 18n;
    const frac = ((wei % 10n ** 18n) / 10n ** 14n).toString().padStart(4, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  }

  window.VouchsafeWallet = {
    available,
    connect,
    onChange: (fn) => listeners.push(fn),
    get account() { return account; },
    setAddresses: (a) => { addresses = a; },
    get ready() { return !!addresses; },
    stakeOf,
    minStake,
    requiredStakeFor,
    stake,
    endorse,
    formatFlr,
  };
})();
