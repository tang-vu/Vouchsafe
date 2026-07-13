import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load root .env first (shared across workspaces), then a local override if present.
dotenv.config({ path: "../.env" });
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const FLARE_RPC_API_KEY = process.env.FLARE_RPC_API_KEY ?? "";
const FLARE_EXPLORER_API_KEY = process.env.FLARE_EXPLORER_API_KEY ?? "";

// Only attach accounts when a key is configured, so `hardhat compile`/local tests
// work without any secrets present.
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      // Flare starter targets EVM `cancun` (requires solc >= 0.8.24).
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Flare Testnet Coston2 — the target for all development and demos.
    coston2: {
      url: FLARE_RPC_API_KEY
        ? `https://coston2-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
        : "https://coston2-api.flare.network/ext/C/rpc",
      accounts,
      chainId: 114,
    },
    coston: {
      url: "https://coston-api.flare.network/ext/C/rpc",
      accounts,
      chainId: 16,
    },
  },
  etherscan: {
    // Blockscout-based verification for Coston2.
    apiKey: { coston2: FLARE_EXPLORER_API_KEY },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network",
        },
      },
    ],
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
