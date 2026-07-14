/*
 * Vouchsafe — quorum panel + attestation history.
 * Drives the "Act IV" section: wallet status, stake top-up, endorse-by-id, and the event-indexed
 * attestation table served by /api/attestations. Endorsements go through the connected browser
 * wallet when available, otherwise fall back to the service's derived endorser (/api/endorse).
 */
(function () {
  "use strict";

  const EXPLORER = "https://coston2-explorer.flare.network";
  const $ = (id) => document.getElementById(id);
  const W = window.VouchsafeWallet;
  const short = (s, a = 8, b = 6) => (s && s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s || "");

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ------------------------------------------------------ wallet panel ---
  async function refreshWalletPanel() {
    const status = $("wStatus"), stakeEl = $("wStake"), actions = $("wActions");
    if (!W.account) {
      status.innerHTML = W.available()
        ? `No wallet connected — <b>connect</b> to endorse attestations with your own stake.`
        : `No browser wallet detected. Install MetaMask, or use the service endorser fallback below.`;
      stakeEl.textContent = "—";
      actions.style.display = "none";
      return;
    }
    status.innerHTML = `Connected as <span class="mono">${short(W.account, 10, 8)}</span> on Coston2.`;
    actions.style.display = "";
    try {
      const [staked, min] = await Promise.all([W.stakeOf(W.account), W.minStake()]);
      stakeEl.textContent = `${W.formatFlr(staked)} C2FLR (min to attest: ${W.formatFlr(min)})`;
      $("wStakeBtn").dataset.topup = staked >= min ? "0" : (min - staked).toString();
      $("wStakeBtn").textContent = staked >= min ? "Add 1 C2FLR stake" : `Stake ${W.formatFlr(min - staked)} C2FLR to qualify`;
    } catch (e) {
      stakeEl.textContent = "read failed: " + e.message;
    }
  }

  async function connectWallet() {
    try {
      await W.connect();
      $("walletBtn").textContent = short(W.account, 6, 4);
      toast("Wallet connected");
    } catch (e) {
      toast(e.message);
    }
    refreshWalletPanel();
  }

  async function doStake() {
    const btn = $("wStakeBtn");
    const topup = BigInt(btn.dataset.topup || "0");
    const amount = topup > 0n ? topup : 10n ** 18n; // qualify first, then 1 C2FLR increments
    btn.disabled = true;
    try {
      await W.stake(amount);
      toast(`Staked ${W.formatFlr(amount)} C2FLR`);
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      refreshWalletPanel();
    }
  }

  // --------------------------------------------------------- endorsing ---
  async function endorseWithWallet(id) {
    // Qualify the wallet's stake for the attestation's subject before endorsing.
    const r = await fetch("/api/attestation/" + id);
    const att = await r.json();
    if (!r.ok) throw new Error(att.error || "attestation not found");
    const [required, staked] = await Promise.all([W.requiredStakeFor(att.subject), W.stakeOf(W.account)]);
    if (staked < required) {
      toast(`Staking ${W.formatFlr(required - staked)} C2FLR to qualify…`);
      await W.stake(required - staked);
    }
    await W.endorse(id);
  }

  async function endorseViaService(id) {
    const r = await fetch("/api/endorse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `endorse failed (${r.status})`);
    return d;
  }

  async function doEndorse(id, btn) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return toast("Enter a valid 32-byte attestation id");
    if (btn) { btn.disabled = true; btn.textContent = "endorsing…"; }
    try {
      if (W.account) {
        await endorseWithWallet(id);
        toast("Endorsed with your wallet stake");
      } else {
        const d = await endorseViaService(id);
        toast(`Endorsed by service attestor (${d.endorsements} total)`);
      }
      loadHistory();
    } catch (e) {
      toast(e.message);
      if (btn) { btn.disabled = false; btn.textContent = "endorse"; }
    }
  }

  // ----------------------------------------------------------- history ---
  function rowHtml(a) {
    const when = new Date(a.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const status = a.revoked
      ? `<span class="badge bad">revoked · slashed</span>`
      : `<span class="badge ok">active</span>`;
    const quorum = a.quorate
      ? `<span class="badge ok">quorate</span>`
      : `<span class="badge warn">needs quorum</span>`;
    const action = a.revoked
      ? `<span class="muted">—</span>`
      : `<button class="btn sm ghost" data-endorse="${a.id}">endorse</button>`;
    return `<tr>
      <td class="mono" title="${a.id}"><a href="/?id=${a.id}">${short(a.id, 8, 6)}</a></td>
      <td class="mono">${short(a.subject, 6, 4)}</td>
      <td class="mono">${short(a.attestor, 6, 4)}</td>
      <td>${when}</td>
      <td>${status}</td>
      <td>${a.endorsements} · ${quorum}</td>
      <td><a href="${EXPLORER}/tx/${a.txHash}" target="_blank" rel="noopener">tx ↗</a></td>
      <td>${action}</td>
    </tr>`;
  }

  async function loadHistory() {
    const body = $("historyBody"), empty = $("historyEmpty");
    try {
      const r = await fetch("/api/attestations?limit=12");
      const list = await r.json();
      if (!r.ok) throw new Error(list.error || "history unavailable");
      body.innerHTML = list.map(rowHtml).join("");
      empty.style.display = list.length ? "none" : "";
      empty.textContent = list.length ? "" : "No attestations recorded yet — run a proof in Act I.";
    } catch (e) {
      body.innerHTML = "";
      empty.style.display = "";
      empty.textContent = "Could not load history: " + e.message;
    }
  }

  // -------------------------------------------------------------- init ---
  async function init() {
    if (!$("quorum")) return; // section not present
    try {
      const health = await (await fetch("/api/health")).json();
      W.setAddresses(health.addresses);
    } catch { /* service offline — table + wallet reads will surface it */ }

    $("walletBtn").onclick = connectWallet;
    $("wStakeBtn").onclick = doStake;
    $("endorseBtn").onclick = () => doEndorse($("endorseId").value.trim(), $("endorseBtn"));
    $("historyRefresh").onclick = loadHistory;
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-endorse]");
      if (b) doEndorse(b.getAttribute("data-endorse"), b);
    });
    W.onChange(refreshWalletPanel);

    refreshWalletPanel();
    loadHistory();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
