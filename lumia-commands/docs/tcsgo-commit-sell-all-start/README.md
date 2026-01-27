# tcsgo-commit-sell-all-start

Starts the two-step sell-all flow. It previews credit amounts and issues a confirmation token.

## Command name and usage

- Command name: `tcsgo-commit-sell-all-start`
- Viewer usage: `!sell all`

## Inputs

Provided via Lumia variables when the command is invoked:
- `eventId` (required)
- `platform` (required)
- `username` (required)

## Output payload

Result type: `sell-all-start-result`

On success, `data` includes:
- `eventId`
- `effectivePlatform`, `effectiveUsername`
- `linkedFromDiscord`
- `token`
- `expiresAt`, `expiresInSeconds`
- `eligibleCount`
- `lockedCount`
- `unsellableCount`
- `creditAmount`
- `marketFeePercent`
- `timings`

On error, `error` includes:
- `code`, `message`, `details`

## Behavior notes

- Blocks if a pending sell is still active and unexpired.
- Only includes unlocked items with a positive `priceSnapshot.chosenCoins` value.
- Persists a pending record on the inventory:
  - `pendingSell = { mode: "all", token, oids, creditAmount, feePercent, expiresAt }`.

## Dependencies and related code

- Inventories: `data/inventories.json`
- Prices: `data/prices.json`
- Overlay routing: `lumia-overlays/case-opening/script.js`
- Confirm command: `lumia-commands/tcsgo-commit-sell-all-confirm.js`
