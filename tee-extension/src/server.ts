import express, { Express, Request, Response } from "express";
import { TeeSigner } from "./tee-signer";
import { handleProveSolvency } from "./action-handler";
import { OP_TYPE_SOLVENCY, OP_COMMAND_PROVE, config } from "./config";
import { ActionEnvelope, ProveSolvencyRequest } from "./types";

/**
 * Build the extension HTTP app. The TEE node delivers instructions to `POST /action`; we accept both
 * an FCC-style envelope `{ opType, opCommand, message }` and a bare ProveSolvencyRequest for convenience.
 */
export function createApp(signer: TeeSigner): Express {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", simulated: signer.simulated, mode: config.mode, teeAddress: signer.address });
  });

  // Public key / signer address so a verifier owner can register this TEE.
  app.get("/pubkey", (_req: Request, res: Response) => {
    res.json({ teeAddress: signer.address, simulated: signer.simulated });
  });

  app.post("/action", async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<ActionEnvelope> & Partial<ProveSolvencyRequest>;

      // Route on (opType, opCommand) when an envelope is provided.
      let message: ProveSolvencyRequest;
      if ((body as ActionEnvelope).opType !== undefined) {
        const env = body as ActionEnvelope;
        if (env.opType !== OP_TYPE_SOLVENCY) return res.status(400).json({ error: "unsupported op type" });
        if (env.opCommand !== OP_COMMAND_PROVE) return res.status(400).json({ error: "unsupported op command" });
        message = env.message;
      } else {
        message = body as ProveSolvencyRequest;
      }

      const result = await handleProveSolvency(message, signer);
      // Log only non-sensitive metadata — never the raw reserves/liabilities.
      console.log(`[action] solvency proved subject=${result.subject} solvent=${result.solvent} nonce=${result.nonce}`);
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      return res.status(400).json({ error: msg });
    }
  });

  return app;
}
