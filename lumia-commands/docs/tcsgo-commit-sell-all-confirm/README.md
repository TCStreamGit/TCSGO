# tcsgo-commit-sell-all-confirm

Completes the sell-all flow using a confirmation token and credits the viewer balance in the inventory data.

## Command name and usage

- Command name: `tcsgo-commit-sell-all-confirm`
- Viewer usage: `!sell all <code>`

## Inputs

Provided via Lumia variables when the command is invoked:
- `eventId` (required)
- `platform` (required)
- `username` (required)
- `token` (required)

## Output payload

Result type: `sell-all-confirm-result`

On success, `data` includes:
- `eventId`
- `effectivePlatform`, `effectiveUsername`
- `linkedFromDiscord`
- `soldCount`
- `lockedCount`
- `unsellableCount`
- `missingCount`
- `creditedCoins`
- `newBalance`
- `marketFeePercent`
- `timings`

On error, `error` includes:
- `code`, `message`, `details`

## Behavior notes

- Validates pending sell, token match, sell-all mode, and expiration.
- Sells only items that are still present, unlocked, and have a positive `priceSnapshot.chosenCoins` value.
- Clears `pendingSell` even if nothing was sold to avoid stuck pending state.

## Dependencies and related code

- Inventories: `data/inventories.json`
- Prices: `data/prices.json`
- Overlay routing: `lumia-overlays/case-opening/script.js`
- Start command: `lumia-commands/tcsgo-commit-sell-all-start.js`
