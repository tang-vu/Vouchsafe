import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the Vouchsafe core contracts (SolvencyRegistry, AttestorStaking, SolvencyVerifier),
 * wires their roles, and writes the addresses to deployments/<network>.json.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:   ${network.name} (chainId ${network.config.chainId ?? "?"})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} ${network.name === "coston2" ? "C2FLR" : "ETH"}`);

  // --- deployment parameters ---
  const minStake = ethers.parseEther("1"); // minimum active stake to attest
  const unbondingPeriod = 60 * 60; // 1 hour before withdrawal after unstake
  const challengeWindow = 60 * 60 * 24; // 24 hours stake lock per assertion
  const slashPenalty = ethers.parseEther("1"); // slashed on a proven fraud

  const Registry = await ethers.getContractFactory("SolvencyRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`SolvencyRegistry:  ${registryAddress}`);

  const Staking = await ethers.getContractFactory("AttestorStaking");
  const staking = await Staking.deploy(minStake, unbondingPeriod);
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log(`AttestorStaking:   ${stakingAddress}`);

  const Verifier = await ethers.getContractFactory("SolvencyVerifier");
  const verifier = await Verifier.deploy(registryAddress, stakingAddress, challengeWindow, slashPenalty);
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`SolvencyVerifier:  ${verifierAddress}`);

  // FCC on-chain footprint. TeeExtensionRegistry is not yet in the Coston2 FlareContractRegistry, so
  // deploy in simulated (event-anchored) mode with the registry address unset (zero).
  const Sender = await ethers.getContractFactory("VouchsafeInstructionSender");
  const sender = await Sender.deploy(ethers.ZeroAddress);
  await sender.waitForDeployment();
  const senderAddress = await sender.getAddress();
  console.log(`InstructionSender: ${senderAddress}`);

  // FAsset binding reader (resolves FXRP AssetManager + agent metadata via the registry).
  const Binding = await ethers.getContractFactory("FxrpAgentBinding");
  const binding = await Binding.deploy();
  await binding.waitForDeployment();
  const bindingAddress = await binding.getAddress();
  console.log(`FxrpAgentBinding:  ${bindingAddress}`);

  // --- wire roles ---
  await (await registry.setVerifier(verifierAddress)).wait();
  await (await staking.setSlasher(verifierAddress)).wait();
  console.log("Roles wired: registry.verifier + staking.slasher -> SolvencyVerifier");

  // --- persist addresses ---
  const out = {
    network: network.name,
    chainId: network.config.chainId ?? null,
    deployer: deployer.address,
    contracts: {
      SolvencyRegistry: registryAddress,
      AttestorStaking: stakingAddress,
      SolvencyVerifier: verifierAddress,
      VouchsafeInstructionSender: senderAddress,
      FxrpAgentBinding: bindingAddress,
    },
    params: {
      minStake: minStake.toString(),
      unbondingPeriod,
      challengeWindow,
      slashPenalty: slashPenalty.toString(),
    },
    timestamp: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`Saved deployments/${network.name}.json`);

  if (network.name === "coston2") {
    const base = "https://coston2-explorer.flare.network/address/";
    console.log("\nExplorer links:");
    console.log(`  ${base}${registryAddress}`);
    console.log(`  ${base}${stakingAddress}`);
    console.log(`  ${base}${verifierAddress}`);
    console.log(`  ${base}${senderAddress}`);
    console.log(`  ${base}${bindingAddress}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
