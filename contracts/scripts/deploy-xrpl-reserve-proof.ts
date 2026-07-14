import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys XrplReserveProof (XRPL-native reserve-address control proofs via FDC Payment) and appends
 * its address to the existing deployments/<network>.json — the v2 core contracts are untouched.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:   ${network.name} (chainId ${network.config.chainId ?? "?"})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

  const XrplReserveProof = await ethers.getContractFactory("XrplReserveProof");
  const xrpl = await XrplReserveProof.deploy();
  await xrpl.waitForDeployment();
  const address = await xrpl.getAddress();
  console.log(`XrplReserveProof: ${address}`);

  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing ${file} — deploy the core contracts first`);
  const deployments = JSON.parse(fs.readFileSync(file, "utf8"));
  deployments.contracts.XrplReserveProof = address;
  deployments.timestamp = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(deployments, null, 2));
  console.log(`Updated deployments/${network.name}.json`);

  if (network.name === "coston2") {
    console.log(`Explorer: https://coston2-explorer.flare.network/address/${address}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
