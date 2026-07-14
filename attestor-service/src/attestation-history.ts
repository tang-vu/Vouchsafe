import { Contract, EventLog, JsonRpcProvider } from "ethers";
import { config } from "./config";
import { REGISTRY_ABI, VERIFIER_ABI } from "./abis";

/** One attestation as seen by the event-indexed history (commitments only — never raw figures). */
export interface AttestationRecord {
  id: string;
  subject: string;
  attestor: string;
  inputHash: string;
  timestamp: number;
  blockNumber: number;
  txHash: string;
  revoked: boolean;
  endorsements: number;
  quorate: boolean;
}

/** Block-range page size the public Coston2 RPC accepts for eth_getLogs. */
const LOG_PAGE = 25_000;

/** When the deployment block is unknown, only scan this recent window instead of from genesis. */
const FALLBACK_WINDOW = 200_000;

async function pagedQuery(contract: Contract, filter: unknown, from: number, to: number): Promise<EventLog[]> {
  const logs: EventLog[] = [];
  for (let start = from; start <= to; start += LOG_PAGE) {
    const end = Math.min(start + LOG_PAGE - 1, to);
    logs.push(...((await contract.queryFilter(filter as string, start, end)) as EventLog[]));
  }
  return logs;
}

/**
 * List recorded attestations, newest first, by scanning `SolvencyAsserted` / `AttestationRevoked`
 * events from the deployment block and joining live quorum state from the verifier.
 */
export async function listAttestations(
  opts: { subject?: string; limit?: number } = {}
): Promise<AttestationRecord[]> {
  const provider = new JsonRpcProvider(config.rpc);
  const registry = new Contract(config.addresses.SolvencyRegistry, REGISTRY_ABI, provider);
  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, provider);

  const latest = await provider.getBlockNumber();
  const from = config.startBlock > 0 ? config.startBlock : Math.max(0, latest - FALLBACK_WINDOW);

  const assertedFilter = registry.filters.SolvencyAsserted(null, opts.subject ?? null);
  const [asserted, revokedLogs] = await Promise.all([
    pagedQuery(registry, assertedFilter, from, latest),
    pagedQuery(registry, registry.filters.AttestationRevoked(), from, latest),
  ]);
  const revokedIds = new Set(revokedLogs.map((e) => e.args.id as string));

  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const newest = asserted.reverse().slice(0, limit);

  return Promise.all(
    newest.map(async (e): Promise<AttestationRecord> => {
      const id = e.args.id as string;
      const [endorsements, quorate] = await Promise.all([
        verifier.endorsementCount(id),
        verifier.isQuorate(id),
      ]);
      return {
        id,
        subject: e.args.subject as string,
        attestor: e.args.attestor as string,
        inputHash: e.args.inputHash as string,
        timestamp: Number(e.args.timestamp),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash,
        revoked: revokedIds.has(id),
        endorsements: Number(endorsements),
        quorate: quorate as boolean,
      };
    })
  );
}
