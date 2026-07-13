import { ethers } from "hardhat";

/**
 * Reads full on-chain info for one FXRP agent vault (status, minted FXRP, collateral ratios, etc.).
 * This is the "liabilities" side of a solvency assertion for an FAsset agent: minted FXRP is the agent's
 * obligation, backed by collateral.
 *
 * AGENT_VAULT=0x... yarn hardhat run scripts/fassets/agent-info.ts --network coston2
 */
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

function stringifyBigInt(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

async function main() {
  const vault = process.env.AGENT_VAULT;
  if (!vault) throw new Error("Set AGENT_VAULT=0x... (see list-agents.ts output)");

  const registry = new ethers.Contract(
    FLARE_CONTRACT_REGISTRY,
    ["function getContractAddressByName(string) view returns (address)"],
    ethers.provider
  );
  const assetManagerAddress = await registry.getContractAddressByName("AssetManagerFXRP");
  const assetManager = await ethers.getContractAt("IAssetManager", assetManagerAddress);

  const info = await assetManager.getAgentInfo(vault);
  console.log(`Agent ${vault} info:`);
  console.log(stringifyBigInt(info));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
