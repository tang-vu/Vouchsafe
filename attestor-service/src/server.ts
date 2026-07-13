import express, { Request, Response } from "express";
import * as path from "path";
import { config } from "./config";
import { attest, commitFraud, readAttestation } from "./orchestrator";

/** HTTP API + static frontend for the Vouchsafe attestor-service. */
export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", chainId: config.chainId, addresses: config.addresses });
  });

  // Issue an attestation: private figures -> TEE sign -> FDC proof -> record on Coston2 (~2 min).
  app.post("/api/attest", async (req: Request, res: Response) => {
    try {
      const { subject, reserves, liabilities } = req.body ?? {};
      const result = await attest({ subject, reserves, liabilities });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "error" });
    }
  });

  // Third-party verification: solvent at T + inputHash, no underlying numbers.
  app.get("/api/attestation/:id", async (req: Request, res: Response) => {
    try {
      res.json(await readAttestation(req.params.id));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "error" });
    }
  });

  // Demo fraud path: record a lie, then prove it and slash the attestor's stake (~2 min).
  app.post("/api/fraud", async (req: Request, res: Response) => {
    try {
      const { subject, reserves, liabilities } = req.body ?? {};
      res.json(await commitFraud({ subject, reserves, liabilities }));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "error" });
    }
  });

  return app;
}
