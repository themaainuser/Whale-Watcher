export type Chain = "bitcoin" | "ethereum" | "xrpl";

export const CATEGORIES = [
  "exchange_hot",
  "exchange_cold_reserve",
  "exchange_deposit",
  "issuer_treasury",
  "bridge",
  "custodian",
  "market_maker",
  "etf_prime_vehicle",
  "protocol_infra",
  "unknown",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Confidence = "verified" | "heuristic" | "community";

export type Direction =
  | "to_exchange"
  | "from_exchange"
  | "exchange_to_exchange"
  | "wallet_to_wallet";

export interface NormalizedTransfer {
  chain: Chain;
  /** Canonical asset symbol, e.g. "ETH", "USDC"; XRPL IOUs use the decoded currency code. */
  asset: string;
  txHash: string;
  logIndex?: number;
  blockHeight?: number;
  from: string;
  to?: string;
  destinationTag?: number;
  /**
   * Human-unit decimal amount (already scaled from wei/satoshis/drops).
   * Listeners must parse raw chain units with BigInt before constructing this.
   */
  amount: number;
  occurredAt: Date;
}

export interface LabelAssignmentRow {
  category: Category;
  label: string;
  source: string;
  confidence: Confidence;
  lastSeen: Date;
}

export interface LabelUpsert {
  chain: Chain;
  address: string;
  category: Category;
  label: string;
  source: string;
  confidence: Confidence;
  clusterId?: string;
  destinationTag?: number;
}

export interface AlertPayload {
  transferId: number;
  message: string;
}

export interface Threshold {
  chain: string;
  asset: string;
  minAmount: string | null;
  minUsd: string | null;
}
