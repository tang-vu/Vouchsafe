import { createServer } from "./server";
import { config } from "./config";

createServer().listen(config.port, () => {
  console.log(`Vouchsafe attestor-service: http://localhost:${config.port}`);
  console.log(`  verifier: ${config.addresses.SolvencyVerifier}`);
});
