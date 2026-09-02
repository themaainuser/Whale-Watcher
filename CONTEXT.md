# Whale-Watcher

Real-time whale-watch pipeline classifying large on-chain transfers across Bitcoin, Ethereum, and the XRP Ledger, then alerting on them.

## Language

### Accounts

**Account**:
A controllable on-chain address (or contract) that can send or receive transfers.
_Avoid_: wallet (reserved for informal prose), user

**Category set**:
The set of roles assigned to an account; an account may hold several at once.
_Avoid_: label type, tag

**Exchange endpoint**:
An account whose category set contains any `exchange_*` category; only endpoints participate in direction classification.
_Avoid_: exchange account

### Account categories

**Hot wallet** (`exchange_hot`):
Venue-operated address holding spendable funds for day-to-day withdrawals.

**Cold reserve** (`exchange_cold_reserve`):
Venue-operated address holding bulk treasury funds moved rarely.

**Deposit address** (`exchange_deposit`):
Address designated to receive user deposits at a venue — per-user or shared.
_Avoid_: funding address

**Issuer treasury** (`issuer_treasury`):
Stablecoin issuer's mint/treasury-controlled address (e.g. Tether, Circle).

**Bridge** (`bridge`):
Address or contract moving assets between chains.

**Custodian** (`custodian`):
Professional key-holding service acting on behalf of clients (e.g. Fireblocks, BitGo).

**Market maker** (`market_maker`):
Firm rotating inventory across venues (e.g. Wintermute).
_Avoid_: MM

**ETF vehicle** (`etf_prime_vehicle`):
ETF or prime-brokerage wallet holding fund reserves.

**Protocol infra** (`protocol_infra`):
Chain-native protocol addresses emitting large but non-market flows (e.g. Ripple escrow releases, RLUSD operations).

**Destination tag**:
Off-ledger XRPL number routing a deposit to one user behind a shared venue address.
_Avoid_: memo

**Omnibus address**:
Shared venue deposit address that credits users by destination tag instead of issuing per-user addresses.

### Transfers

**Direction**:
Transfer classification against exchange endpoints: `to_exchange`, `from_exchange`, `exchange_to_exchange`, or `wallet_to_wallet`.

### Market timing

**Session overlap**:
The 13:00–17:00 UTC window when the London and New York sessions coincide — peak transaction volume and liquidity (17:30–22:30 IST). Drives listener polling cadence.
_Avoid_: market hours
