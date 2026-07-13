import { createApp } from "./server";
import { TeeSigner } from "./tee-signer";
import { config } from "./config";

/** Entry point: start the confidential solvency extension server. */
function main() {
  const signer = new TeeSigner(config.teeSignerPrivateKey, config.simulated);
  const app = createApp(signer);

  app.listen(config.port, () => {
    console.log("Vouchsafe TEE extension (solvency)");
    console.log(`  mode:       ${config.simulated ? "SIMULATED" : "REAL"} (MODE=${config.mode})`);
    console.log(`  teeAddress: ${signer.address}`);
    console.log(`  listening:  http://localhost:${config.port}  (POST /action, GET /health, GET /pubkey)`);
    if (config.simulated) {
      console.log("  note: simulated enclave key. Real Confidential Space (MODE=0) holds the key inside the TEE.");
    }
  });
}

main();
