import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verifies all deployed Vouchsafe contracts on the Coston2 Blockscout explorer, reading their
 * addresses and constructor params from deployments/coston2.json.
 *
 * yarn hardhat run scripts/verify.ts --network coston2
 */
async function main() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "coston2.json"), "utf8"));
  const c = d.contracts;
  const p = d.params;

  const jobs: { name: string; address: string; args: unknown[] }[] = [
    { name: "SolvencyRegistry", address: c.SolvencyRegistry, args: [] },
    { name: "AttestorStaking", address: c.AttestorStaking, args: [p.minStake, p.unbondingPeriod] },
    {
      name: "SolvencyVerifier",
      address: c.SolvencyVerifier,
      args: [c.SolvencyRegistry, c.AttestorStaking, p.challengeWindow, p.slashPenalty],
    },
    { name: "VouchsafeInstructionSender", address: c.VouchsafeInstructionSender, args: ["0x0000000000000000000000000000000000000000"] },
    { name: "FxrpAgentBinding", address: c.FxrpAgentBinding, args: [] },
    { name: "XrplReserveProof", address: c.XrplReserveProof, args: [] },
  ];

  for (const j of jobs) {
    if (!j.address) {
      console.log(`SKIP ${j.name}: no address`);
      continue;
    }
    try {
      console.log(`Verifying ${j.name} @ ${j.address} …`);
      await run("verify:verify", { address: j.address, constructorArguments: j.args });
      console.log(`  OK ${j.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.log(`  ${msg.toLowerCase().includes("already verified") ? "ALREADY" : "ERR"} ${j.name}: ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
