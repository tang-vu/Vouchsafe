import { Contract, EventLog, Interface, JsonRpcProvider } from "ethers";
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

/** Decoded registry event in a source-agnostic shape (explorer API and RPC produce the same). */
interface RegistryEvent {
  name: string;
  args: Record<string, unknown>;
  blockNumber: number;
  txHash: string;
}

const registryIface = new Interface(REGISTRY_ABI);

/**
 * Primary source: the Blockscout explorer logs API. One request covers the whole deployment range —
 * the public Coston2 RPC caps `eth_getLogs` at ~30 blocks per call, which makes RPC-side scanning
 * of a multi-week deployment infeasible.
 */
async function explorerLogs(eventName: string): Promise<RegistryEvent[]> {
  const topic0 = registryIface.getEvent(eventName)!.topicHash;
  const from = config.startBlock > 0 ? config.startBlock : 0;
  const url =
    `${config.explorer}/api?module=logs&action=getLogs&fromBlock=${from}&toBlock=latest` +
    `&address=${config.addresses.SolvencyRegistry}&topic0=${topic0}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`explorer logs API ${r.status}`);
  const j = (await r.json()) as { status?: string; message?: string; result?: unknown };
  if (!Array.isArray(j.result)) {
    if (typeof j.message === "string" && /no (records|logs)/i.test(j.message)) return [];
    throw new Error(`explorer logs API: ${j.message ?? "unexpected response"}`);
  }
  return j.result.map((raw: any) => {
    const parsed = registryIface.parseLog({
      topics: (raw.topics as (string | null)[]).filter((t): t is string => !!t),
      data: raw.data as string,
    })!;
    return {
      name: parsed.name,
      args: parsed.args.toObject(),
      blockNumber: Number(raw.blockNumber),
      txHash: raw.transactionHash as string,
    };
  });
}

/** Fallback block-range page size — the public RPC rejects wider eth_getLogs windows. */
const LOG_PAGE = 30;
/** Fallback only covers a recent window (LOG_PAGE-sized calls make long ranges impractical). */
const FALLBACK_WINDOW = 1_500;

async function rpcLogs(eventName: string, provider: JsonRpcProvider): Promise<RegistryEvent[]> {
  const registry = new Contract(config.addresses.SolvencyRegistry, REGISTRY_ABI, provider);
  const latest = await provider.getBlockNumber();
  const from = Math.max(config.startBlock, latest - FALLBACK_WINDOW);
  const logs: EventLog[] = [];
  for (let start = from; start <= latest; start += LOG_PAGE) {
    const end = Math.min(start + LOG_PAGE - 1, latest);
    logs.push(...((await registry.queryFilter(registry.filters[eventName](), start, end)) as EventLog[]));
  }
  return logs.map((e) => ({
    name: eventName,
    args: e.args.toObject(),
    blockNumber: e.blockNumber,
    txHash: e.transactionHash,
  }));
}

async function registryEvents(eventName: string, provider: JsonRpcProvider): Promise<RegistryEvent[]> {
  try {
    return await explorerLogs(eventName);
  } catch (err) {
    console.warn(`history: explorer API failed (${err instanceof Error ? err.message : err}) — RPC fallback (recent window only)`);
    return rpcLogs(eventName, provider);
  }
}

/**
 * List recorded attestations, newest first, from `SolvencyAsserted` / `AttestationRevoked` events
 * (explorer-indexed since deployment), joined with live quorum state from the verifier.
 */
export async function listAttestations(
  opts: { subject?: string; limit?: number } = {}
): Promise<AttestationRecord[]> {
  const provider = new JsonRpcProvider(config.rpc);
  const verifier = new Contract(config.addresses.SolvencyVerifier, VERIFIER_ABI, provider);

  const [asserted, revoked] = await Promise.all([
    registryEvents("SolvencyAsserted", provider),
    registryEvents("AttestationRevoked", provider),
  ]);
  const revokedIds = new Set(revoked.map((e) => e.args.id as string));

  const filtered = opts.subject
    ? asserted.filter((e) => (e.args.subject as string).toLowerCase() === opts.subject!.toLowerCase())
    : asserted;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const newest = filtered.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, limit);

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
        txHash: e.txHash,
        revoked: revokedIds.has(id),
        endorsements: Number(endorsements),
        quorate: quorate as boolean,
      };
    })
  );
}
