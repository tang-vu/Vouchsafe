import { attest, commitFraud, readAttestation } from "./orchestrator";

/**
 * Unattended end-to-end demo on Coston2:
 *   1. HAPPY PATH  — prove solvency privately; record with TEE signature + FDC reserve proof.
 *   2. FRAUD PATH  — a malicious attestor lies (insolvent); the fraud is proven and the stake slashed.
 * `reserves` must sum to the value the public RESERVES_URL returns (the demo gist = 1,500,000).
 */
const AGENT_VAULT = "0x5b89514d1F060AdbEA8B7294AFf81ed8dbAa7fC5"; // a real Coston2 FXRP agent
const RESERVES = ["1000000", "500000"]; // sums to 1,500,000 (matches the reserves endpoint)

async function main() {
  console.log("========================================");
  console.log(" Vouchsafe demo — Coston2");
  console.log("========================================\n");

  console.log("[1/2] HAPPY PATH — private solvency proof (TEE) + reserve proof (FDC)\n");
  const happy = await attest({ subject: AGENT_VAULT, reserves: RESERVES, liabilities: ["900000"] });
  console.log(`\n  attestation id : ${happy.attestationId}`);
  console.log(`  recorded tx    : ${happy.explorerUrl}`);
  const view = await readAttestation(happy.attestationId);
  console.log(`  third-party view: solvent=${view.solvent} at T=${view.timestamp}`);
  console.log(`                    inputHash=${view.inputHash}`);
  console.log("                    (reserves & liabilities never appear on-chain)\n");

  console.log("[2/2] FRAUD PATH — attestor lies (reserves < liabilities), gets slashed\n");
  const fraud = await commitFraud({ subject: AGENT_VAULT, reserves: RESERVES, liabilities: ["2000000"] });
  console.log(`\n  fraudulent id  : ${fraud.attestationId}`);
  console.log(`  slash tx       : ${fraud.fraudExplorerUrl}`);
  console.log(`  attestor stake : ${fraud.stakeBefore} -> ${fraud.stakeAfter} C2FLR (slashed)\n`);

  console.log("========================================");
  console.log(" Demo complete — both bounties exercised live on Coston2");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
