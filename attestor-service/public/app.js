/*
 * Vouchsafe — front-of-house controller.
 * Talks only to the existing service API (/api/health, /api/attest, /api/attestation/:id, /api/fraud);
 * everything visual is derived client-side so the page is fully decoupled from the backend internals.
 */
(function () {
  "use strict";

  const EXPLORER = "https://coston2-explorer.flare.network";
  const $ = (id) => document.getElementById(id);
  const H = window.VouchsafeHash;

  // ------------------------------------------------------------- utils ---
  const short = (s, a = 8, b = 6) => (s && s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s || "");
  const isUint = (s) => /^\d+$/.test((s || "").trim());
  const sumTokens = (raw) => raw.split(",").map((x) => x.trim()).filter(Boolean);

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 1600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Copy failed");
    }
  }

  function copyBtn(text) {
    return `<button class="copybtn" data-copy="${text}">copy</button>`;
  }

  function txLink(hash) {
    return `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${short(hash, 10, 8)} ↗</a>`;
  }

  // one delegated handler for every copy affordance on the page
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (b) return copy(b.getAttribute("data-copy"));
    const f = e.target.closest("[data-full]");
    if (f && f.dataset.full && f.dataset.full !== "—") copy(f.dataset.full);
  });

  // ---------------------------------------------------------- console ---
  function logLine(el, kind, msg) {
    const now = new Date();
    const tk = now.toTimeString().slice(0, 8);
    const div = document.createElement("div");
    div.className = "ln " + kind;
    div.innerHTML = `<span class="tk">${tk}</span><span>${msg}</span>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }
  const makeLogger = (el) => (kind, msg) => logLine(el, kind, msg);

  // --------------------------------------------------------- pipeline ---
  const STAGES = ["input", "tee", "fdc", "chain", "accord"];
  const stageEl = (name) => document.querySelector(`.stage[data-stage="${name}"]`);
  const stageLabel = (name, text) => {
    const el = stageEl(name);
    if (el) el.querySelector(".lbl").textContent = text;
  };

  function setStage(name, state, label) {
    const el = stageEl(name);
    if (!el) return;
    el.classList.remove("active", "done", "failed");
    if (state) el.classList.add(state);
    if (label) el.querySelector(".lbl").textContent = label;
  }

  function fillTo(pct) {
    $("pipeFill").style.right = 100 - Math.max(0, Math.min(100, pct)) + "%";
  }

  function resetPipeline() {
    STAGES.forEach((s) => setStage(s, null, "idle"));
    fillTo(0);
  }

  // Heuristic timeline for the ~2-minute honest path. Real completion reconciles it (advanceComplete/advanceFail).
  function startTimeline() {
    const timers = [];
    setStage("input", "done", "sealed");
    setStage("tee", "active", "signing");
    fillTo(20);
    timers.push(
      setTimeout(() => {
        setStage("tee", "done", "signed");
        setStage("fdc", "active", "attesting");
        fillTo(42);
      }, 1500)
    );
    // gentle creep while the FDC round is in flight so the bar never looks stuck
    let creep = 42;
    const creepTimer = setInterval(() => {
      creep = Math.min(creep + 1.5, 66);
      fillTo(creep);
    }, 1800);
    timers.push(creepTimer);
    return {
      done() {
        timers.forEach(clearTimeout);
        clearInterval(creepTimer);
        setStage("tee", "done", "signed");
        setStage("fdc", "done", "proven");
        setStage("chain", "active", "recording");
        fillTo(85);
        setTimeout(() => {
          setStage("chain", "done", "recorded");
          setStage("accord", "done", "staked");
          fillTo(100);
        }, 700);
      },
      fail() {
        timers.forEach(clearTimeout);
        clearInterval(creepTimer);
        const active = STAGES.find((s) => stageEl(s).classList.contains("active")) || "fdc";
        setStage(active, "failed", "failed");
      },
    };
  }

  // Fraud timeline: same spine, but framed as a lie being recorded then punished.
  function startFraudTimeline() {
    const timers = [];
    setStage("input", "done", "insolvent");
    setStage("tee", "active", "forging");
    fillTo(20);
    timers.push(setTimeout(() => { setStage("tee", "done", "signed lie"); setStage("fdc", "active", "attesting"); fillTo(42); }, 1400));
    let creep = 42;
    const creepTimer = setInterval(() => { creep = Math.min(creep + 1.5, 66); fillTo(creep); }, 1800);
    timers.push(creepTimer);
    return {
      done() {
        timers.forEach(clearTimeout); clearInterval(creepTimer);
        setStage("fdc", "done", "proven"); setStage("chain", "done", "lie recorded");
        setStage("accord", "active", "challenged"); fillTo(88);
        setTimeout(() => { setStage("accord", "failed", "slashed"); fillTo(100); }, 700);
      },
      fail() {
        timers.forEach(clearTimeout); clearInterval(creepTimer);
        const active = STAGES.find((s) => stageEl(s).classList.contains("active")) || "fdc";
        setStage(active, "failed", "failed");
      },
    };
  }

  // ----------------------------------------------------- button state ---
  function setBusy(btn, busy, text) {
    if (busy) {
      btn._label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spin"></span><span>${text || "Working…"}</span>`;
      btn._t0 = Date.now();
      btn._timer = setInterval(() => {
        const s = Math.floor((Date.now() - btn._t0) / 1000);
        btn.querySelector("span:last-child").textContent = `${text} ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);
    } else {
      clearInterval(btn._timer);
      btn.disabled = false;
      btn.innerHTML = btn._label;
    }
  }

  // ------------------------------------------------- commitment builder ---
  function freshSalt() {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  function updateCommitment() {
    const rTokens = sumTokens($("reserves").value);
    const lTokens = sumTokens($("liabilities").value);
    const saltRaw = $("salt").value.trim();
    const validR = rTokens.length && rTokens.every(isUint);
    const validL = lTokens.length && lTokens.every(isUint);
    const validSalt = /^0x[0-9a-fA-F]{2,64}$/.test(saltRaw);

    const rSum = validR ? rTokens.reduce((a, b) => a + BigInt(b), 0n) : null;
    const lSum = validL ? lTokens.reduce((a, b) => a + BigInt(b), 0n) : null;

    $("cbReserves").textContent = rSum !== null ? rSum.toString() : "—";
    $("cbLiab").textContent = lSum !== null ? lSum.toString() : "—";

    // solvency preview (local, before anything leaves the browser)
    const prev = $("solvencyPreview"), prevT = $("solvencyPreviewText");
    if (rSum !== null && lSum !== null) {
      const solvent = rSum >= lSum;
      prev.className = "callout" + (solvent ? "" : " warn");
      prev.querySelector(".ic").textContent = solvent ? "✓" : "✕";
      prevT.innerHTML = solvent
        ? `Enclave verdict: <b style="color:var(--ok)">SOLVENT</b> — reserves ${rSum} ≥ liabilities ${lSum}.`
        : `Enclave verdict: <b style="color:var(--bad)">INSOLVENT</b> — reserves ${rSum} &lt; liabilities ${lSum}. This claim would be slashable.`;
    } else {
      prev.className = "callout";
      prev.querySelector(".ic").textContent = "◇";
      prevT.textContent = "Enter valid integer figures to preview the enclave's verdict locally.";
    }

    if (rSum !== null && lSum !== null && validSalt) {
      try {
        const inputHash = H.inputHash(rSum.toString(), lSum.toString(), saltRaw);
        const resCommit = H.reservesCommitment(rSum.toString());
        $("cbInputHash").textContent = short(inputHash, 12, 8);
        $("cbInputHash").dataset.full = inputHash;
        $("cbResCommit").textContent = short(resCommit, 12, 8);
        $("cbResCommit").dataset.full = resCommit;
        return;
      } catch (_) {}
    }
    $("cbInputHash").textContent = "—";
    $("cbResCommit").textContent = "—";
  }

  // --------------------------------------------------------- flows ------
  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `request failed (${r.status})`);
    return d;
  }

  async function doAttest() {
    const btn = $("attestBtn");
    const rTokens = sumTokens($("reserves").value);
    const lTokens = sumTokens($("liabilities").value);
    if (!rTokens.every(isUint) || !lTokens.every(isUint) || !rTokens.length || !lTokens.length) {
      return toast("Reserves & liabilities must be positive integers");
    }
    const log = makeLogger($("attestConsole"));
    $("attestConsole").innerHTML = "";
    $("attestResult").className = "result";
    resetPipeline();
    const tl = startTimeline();
    setBusy(btn, true, "Proving…");
    log("step", "→ Sealing figures into the enclave…");
    log("info", "Only a signed commitment + FDC reserve proof will reach the chain.");
    log("info", "Requesting the FDC Web2Json round (one voting round, ~1–2 min)…");

    try {
      const d = await postJSON("/api/attest", {
        subject: $("subject").value.trim(),
        reserves: rTokens,
        liabilities: lTokens,
      });
      tl.done();
      log("ok", "✓ Enclave signature + FDC proof accepted by recordSolvency.");
      log("ok", `✓ Recorded on Coston2 — attestation ${short(d.attestationId, 10, 8)}`);

      const res = $("attestResult");
      res.className = "result show good";
      $("attestResultBar").innerHTML = `<span>✓</span> Solvency recorded on-chain — no figures disclosed`;
      $("attestResultBody").innerHTML = `
        <div class="kv"><span class="k">attestation id</span><span class="v hash">${short(d.attestationId, 12, 10)} ${copyBtn(d.attestationId)}</span></div>
        <div class="kv"><span class="k">subject</span><span class="v">${short(d.subject, 10, 8)}</span></div>
        <div class="kv"><span class="k">solvent</span><span class="v" style="color:var(--ok)">${d.solvent}</span></div>
        <div class="kv"><span class="k">inputHash</span><span class="v hash">${short(d.inputHash, 12, 10)} ${copyBtn(d.inputHash)}</span></div>
        <div class="kv"><span class="k">transaction</span><span class="v">${txLink(d.txHash)}</span></div>
        <div style="margin-top:14px"><button class="btn sm" id="gotoVerify">Verify this attestation →</button></div>`;
      $("verifyId").value = d.attestationId;
      $("gotoVerify").onclick = () => { document.getElementById("verify").scrollIntoView({ behavior: "smooth" }); doVerify(); };
      toast("Attestation recorded");
    } catch (e) {
      tl.fail();
      log("err", "✕ " + e.message);
      const res = $("attestResult");
      res.className = "result show bad";
      $("attestResultBar").innerHTML = `<span>✕</span> Could not record`;
      $("attestResultBody").innerHTML = `<div class="muted">${e.message}</div>
        <div class="faint" style="font-size:12px;margin-top:8px">Live proofs need a funded deployer key and the FDC verifier/DA-layer endpoints configured in <span class="mono">.env</span>.</div>`;
    } finally {
      setBusy(btn, false);
    }
  }

  async function doVerify() {
    const id = $("verifyId").value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return toast("Enter a valid 32-byte attestation id");
    const res = $("verifyResult");
    res.className = "result show";
    $("verifyBody").innerHTML = `<div class="muted">Reading the registry on Coston2…</div>`;
    try {
      const r = await fetch("/api/attestation/" + id);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "not found");
      const when = d.timestamp ? new Date(d.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
      const cls = d.revoked ? "revoked" : d.solvent ? "solvent" : "revoked";
      const big = d.revoked ? "REVOKED" : d.solvent ? "SOLVENT AT T" : "NOT SOLVENT";
      $("verifyBody").innerHTML = `
        <div class="verdict ${cls}">
          <div class="big">${big}</div>
          <div class="t">${d.revoked ? "This attestation was proven fraudulent and slashed." : "Confirmed directly from the on-chain registry."}</div>
        </div>
        <div class="ledger">
          <div class="col on">
            <h4>◆ On-chain record</h4>
            <p class="note">Every field the registry stores</p>
            <div class="kv"><span class="k">subject</span><span class="v">${short(d.subject, 10, 8)} ${copyBtn(d.subject)}</span></div>
            <div class="kv"><span class="k">attestor</span><span class="v">${short(d.attestor, 10, 8)} ${copyBtn(d.attestor)}</span></div>
            <div class="kv"><span class="k">solvent</span><span class="v">${d.solvent}</span></div>
            <div class="kv"><span class="k">at T</span><span class="v">${when}</span></div>
            <div class="kv"><span class="k">revoked</span><span class="v" style="color:${d.revoked ? "var(--bad)" : "var(--ok)"}">${d.revoked}</span></div>
            <div class="kv"><span class="k">inputHash</span><span class="v hash">${short(d.inputHash, 12, 10)} ${copyBtn(d.inputHash)}</span></div>
          </div>
          <div class="col off">
            <h4>▲ Not on-chain</h4>
            <p class="note">Structurally absent — never recorded</p>
            <div class="kv"><span class="k">reserves</span><span class="v secret">hidden</span></div>
            <div class="kv"><span class="k">liabilities</span><span class="v secret">hidden</span></div>
            <div class="kv"><span class="k">salt</span><span class="v secret">hidden</span></div>
          </div>
        </div>`;
    } catch (e) {
      $("verifyBody").innerHTML = `<div class="muted" style="color:var(--bad)">✕ ${e.message}</div>`;
    }
  }

  async function doFraud() {
    const btn = $("fraudBtn");
    const rTokens = sumTokens($("reserves").value);
    if (!rTokens.every(isUint) || !rTokens.length) return toast("Set valid reserves in Act I first");
    const log = makeLogger($("fraudConsole"));
    $("fraudConsole").innerHTML = "";
    $("fraudResult").className = "result";
    $("stakeMeter").className = "meter";
    $("stakeBar").style.width = "100%";
    resetPipeline();
    const tl = startFraudTimeline();
    setBusy(btn, true, "Slashing…");
    log("step", "→ Malicious attestor signs solvent=true over insolvent figures…");
    log("info", "Recording the lie on-chain, backed by a live stake…");

    try {
      const d = await postJSON("/api/fraud", {
        subject: $("subject").value.trim(),
        reserves: rTokens,
        liabilities: ["2000000"],
      });
      tl.done();
      log("ok", "✓ Lie recorded, then challenged by revealing the committed figures.");
      log("err", `✕ Fraud proven — attestor slashed: ${d.stakeBefore} → ${d.stakeAfter} C2FLR`);

      const before = parseFloat(d.stakeBefore) || 0;
      const after = parseFloat(d.stakeAfter) || 0;
      const pct = before > 0 ? Math.max(0, Math.min(100, (after / before) * 100)) : 0;
      $("stakeBeforeLbl").textContent = `staked: ${d.stakeBefore} C2FLR`;
      $("stakeAfterLbl").textContent = `${d.stakeAfter} C2FLR remaining`;
      requestAnimationFrame(() => {
        $("stakeMeter").className = "meter slashed";
        $("stakeBar").style.width = pct + "%";
      });

      const res = $("fraudResult");
      res.className = "result show bad";
      $("fraudResultBar").innerHTML = `<span>⚖</span> Stake slashed — the lie cost real collateral`;
      $("fraudResultBody").innerHTML = `
        <div class="kv"><span class="k">fraudulent id</span><span class="v hash">${short(d.attestationId, 12, 10)} ${copyBtn(d.attestationId)}</span></div>
        <div class="kv"><span class="k">slash tx</span><span class="v">${txLink(d.fraudTx)}</span></div>
        <div style="margin-top:12px"><button class="btn sm ghost" id="gotoVerifyFraud">Verify it's now revoked →</button></div>`;
      $("verifyId").value = d.attestationId;
      $("gotoVerifyFraud").onclick = () => { document.getElementById("verify").scrollIntoView({ behavior: "smooth" }); doVerify(); };
      toast("Attestor slashed");
    } catch (e) {
      tl.fail();
      log("err", "✕ " + e.message);
      const res = $("fraudResult");
      res.className = "result show bad";
      $("fraudResultBar").innerHTML = `<span>✕</span> Fraud demo failed`;
      $("fraudResultBody").innerHTML = `<div class="muted">${e.message}</div>`;
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------------------------------------------------------- health ---
  async function loadHealth() {
    const pill = $("netPill"), text = $("netText");
    try {
      const r = await fetch("/api/health");
      const d = await r.json();
      pill.className = "net-pill live";
      text.textContent = `Coston2 · chain ${d.chainId}`;
      const a = d.addresses || {};
      const order = ["SolvencyVerifier", "AttestorStaking", "SolvencyRegistry", "FxrpAgentBinding", "VouchsafeInstructionSender"];
      const chips = order.filter((k) => a[k]).map((k) => `
        <span class="chip">
          <span class="k">${k.replace(/([A-Z])/g, " $1").trim()}</span>
          <a href="${EXPLORER}/address/${a[k]}" target="_blank" rel="noopener">${short(a[k], 6, 4)}</a>
          <span class="copy" data-copy="${a[k]}" title="copy">⧉</span>
        </span>`);
      $("addrChips").innerHTML = chips.join("") || `<span class="chip"><span class="k">no deployment loaded</span></span>`;
    } catch {
      pill.className = "net-pill down";
      text.textContent = "service offline";
      $("addrChips").innerHTML = `<span class="chip"><span class="k">start the service: yarn service</span></span>`;
    }
  }

  // ------------------------------------------------------------ init ---
  function init() {
    $("salt").value = freshSalt();
    updateCommitment();
    ["reserves", "liabilities", "salt"].forEach((id) => $(id).addEventListener("input", updateCommitment));
    $("rollSalt").onclick = () => { $("salt").value = freshSalt(); updateCommitment(); toast("Fresh salt"); };
    $("attestBtn").onclick = doAttest;
    $("verifyBtn").onclick = doVerify;
    $("fraudBtn").onclick = doFraud;

    // deep link: /?id=0x... prefills + verifies
    const qp = new URLSearchParams(location.search).get("id");
    if (qp && /^0x[0-9a-fA-F]{64}$/.test(qp)) { $("verifyId").value = qp; doVerify(); }

    loadHealth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
