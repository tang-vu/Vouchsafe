import express, { Request, Response } from "express";
import * as path from "path";
import { config } from "./config";
import { attest, commitFraud, readAttestation } from "./orchestrator";
import { listAttestations } from "./attestation-history";
import { endorseAttestation } from "./quorum-endorser";
import { readXrplControl } from "./xrpl-status";

/** HTTP API + static frontend for the Vouchsafe attestor-service. */
export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      chainId: config.chainId,
      addresses: config.addresses,
      readOnly: config.readOnly,
      demoSubject: config.deployer,
    });
  });

  // Read-only hosting: block anything that would spend the service's key or stake.
  const guardReadOnly = (_req: Request, res: Response, next: () => void) => {
    if (config.readOnly) {
      return res.status(403).json({
        error: "read-only public demo — run the repo locally (yarn service) for the write paths, or use MetaMask",
      });
    }
    return next();
  };
  app.post(["/api/attest", "/api/fraud", "/api/endorse"], guardReadOnly);

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

  // Event-indexed attestation history (newest first) with live quorum status.
  app.get("/api/attestations", async (req: Request, res: Response) => {
    try {
      const subject = typeof req.query.subject === "string" ? req.query.subject : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json(await listAttestations({ subject, limit }));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "error" });
    }
  });

  // Endorse an attestation with the service's derived second attestor (stake-backed co-signature).
  app.post("/api/endorse", async (req: Request, res: Response) => {
    try {
      const { id } = req.body ?? {};
      if (typeof id !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error("bad attestation id");
      res.json(await endorseAttestation(id));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "error" });
    }
  });

  // XRPL-native reserve signal: has the subject proven control of its registered XRP address?
  app.get("/api/xrpl-proof/:subject", async (req: Request, res: Response) => {
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.subject)) throw new Error("bad subject address");
      res.json(await readXrplControl(req.params.subject));
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
