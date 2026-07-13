import { ethers } from "hardhat";

/**
 * Lists currently available FXRP agents on the target network, resolved entirely through the
 * FlareContractRegistry. Prints each agent's vault address so it can be used as an attestation subject.
 *
 * yarn hardhat run scripts/fassets/list-agents.ts --network coston2
 */
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

function stringifyBigInt(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

async function main() {
  const registry = new ethers.Contract(
    FLARE_CONTRACT_REGISTRY,
    ["function getContractAddressByName(string) view returns (address)"],
    ethers.provider
  );
  const assetManagerAddress = await registry.getContractAddressByName("AssetManagerFXRP");
  console.log(`AssetManagerFXRP: ${assetManagerAddress}`);

  const assetManager = await ethers.getContractAt("IAssetManager", assetManagerAddress);
  const [agents, total] = await assetManager.getAvailableAgentsDetailedList(0, 50);
  console.log(`Total available agents: ${total}\n`);

  for (const agent of agents) {
    // Field layout is decoded by the compiled ABI; print the vault plus the full struct.
    console.log(`Vault: ${agent.agentVault ?? agent[0]}`);
    console.log(stringifyBigInt(agent));
    console.log();
  }

  const firstVault = agents.length > 0 ? agents[0].agentVault ?? agents[0][0] : null;
  if (firstVault) console.log(`Use as attestation subject: ${firstVault}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
