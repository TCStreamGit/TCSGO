# TCSGO Lumia Commands

This folder contains Lumia custom JavaScript command scripts. There are two groups:
- Viewer chat commands (help, cases, inventory, checkprice)
- Backend commit commands (buycase, buykey, open, sell-start, sell-confirm)

The overlay calls the commit commands. The viewer chat commands reply directly in chat.

## Global rules

- Paged commands show a maximum of 5 bullet items per page
- Page numbers start at 1
- Invalid pages return a helpful error message
- Toggle logs by editing `LOG_ENABLED` at the top of each script

## Command list and files

Chat commands (viewer-facing):
- `tcsgo-help.js` -> command name: `help`
- `tcsgo-cases.js` -> command name: `cases`
- `tcsgo-inventory.js` -> command name: `inventory`
- `tcsgo-checkprice.js` -> command name: `checkprice`

Commit commands (overlay-facing):
- `tcsgo-commit-buycase.js` -> command name: `tcsgo-commit-buycase`
- `tcsgo-commit-buykey.js` -> command name: `tcsgo-commit-buykey`
- `tcsgo-commit-open.js` -> command name: `tcsgo-commit-open`
- `tcsgo-commit-sell-start.js` -> command name: `tcsgo-commit-sell-start`
- `tcsgo-commit-sell-confirm.js` -> command name: `tcsgo-commit-sell-confirm`

Helper (not a command):
- `tcsgo-core.js`

## Viewer chat commands

### !help [page]

Shows a paged list of all commands (5 per page).

Parameters:
- `page` (optional): page number, 1-based

Valid examples:
- `!help`
- `!help 2`

Error examples:
- `!help 0` -> invalid page
- `!help 999` -> invalid page

Output format:
- Header: `@user Commands (page X/Y)`
- Bullets: `- command - description` (5 per page)

Edge cases:
- Out of range page -> error message with valid range

### !cases [page] [tag]

Lists available cases with paging and optional filtering.

Parameters:
- `page` (optional): page number, 1-based
- `tag` (optional): filters by caseType or substring in case name/id

Valid examples:
- `!cases`
- `!cases 1`
- `!cases 1 souvenir`
- `!cases 1 knife`

Error examples:
- `!cases 0` -> invalid page
- `!cases 999` -> invalid page

Output format:
- Header: `@user Cases (page X/Y, tag="...")`
- Bullets: `- Case Name [caseType] (alias: c2, key)`

Edge cases:
- Tag with no matches -> `No cases found for "tag"`
- If a manual alias exists, it is shown; otherwise the caseId is shown

### !inventory [page]

Lists the user's owned items (5 per page).

Parameters:
- `page` (optional): page number, 1-based

Valid examples:
- `!inventory`
- `!inventory 2`

Error examples:
- `!inventory 0` -> invalid page

Output format:
- Header: `@user Inventory (page X/Y, items N)`
- Bullets: `- oid: OID | Item Name (Wear) | locked 2d 3h`

Edge cases:
- No items -> `No items in your inventory yet.`

### !checkprice [oid|itemId]

Checks the value of an item from inventory or case data.

Parameters:
- `oid`: item id from inventory
- `itemId`: item id from case data

Valid examples:
- `!checkprice oid_abc123_xyz`
- `!checkprice ak-47-elite-build`

Error examples:
- `!checkprice` -> missing identifier
- `!checkprice unknown-item` -> item not found

Output format:
- `@user Item [rarity] | Price | Case: Name | OID: ...`

Behavior:
- If `oid` is used, the command reads inventory and includes lock status
- If `itemId` is used, the command searches case data for the item
- Price is pulled from `data/prices.json` or computed from fallback rarity

Edge cases:
- Unknown itemId -> error message
- User not found -> error message

## Viewer chat commands handled by the overlay

These commands are parsed in `lumia-overlays/case-opening/script.js`.

### !buycase <alias> [qty]

Parameters:
- `alias`: case alias (from `data/case-aliases.json`)
- `qty` (optional): number of cases

Valid examples:
- `!buycase c2`
- `!buycase cs20 3`

Output format:
- Chat success: `@user Bought 3x Case Name!`
- Chat failure: `@user Insufficient Coins` or `Unknown Case`

Edge cases:
- Unknown alias -> error
- Insufficient coins -> error

### !buykey [qty]

Parameters:
- `qty` (optional): number of keys

Valid examples:
- `!buykey`
- `!buykey 2`

Output format:
- Chat success: `@user Bought 2x Key(s)!`
- Chat failure: insufficient coins

### !open <alias>

Parameters:
- `alias`: case alias

Valid examples:
- `!open cs20`

Output format:
- Chat success: `@user Opened Item Name (Wear)!`
- Overlay runs the case-opening animation

Edge cases:
- No case or no key -> error

### !sell <oid>

Parameters:
- `oid`: inventory item id

Valid examples:
- `!sell oid_abc123_xyz`

Output format:
- Chat success: `@user Selling Item... Confirm: !sellconfirm token`
- Chat failure: trade locked or invalid oid

### !sellconfirm <token>

Parameters:
- `token`: sell token from `!sell`

Valid examples:
- `!sellconfirm sell_abc123_xyz`

Output format:
- Chat success: `@user Sold Item! +Coins`
- Chat failure: invalid token or expired

## Backend commit commands (JSON outputs)

These commands are called by the overlay. They return JSON payloads via
`overlaySendCustomContent` and the `tcsgo_last_event_json` variable.

All responses use this envelope:

```json
{
  "type": "open-result",
  "ok": true,
  "eventId": "evt_abc123",
  "platform": "twitch",
  "username": "viewer",
  "data": { "timings": { "msTotal": 5 } }
}
```

### tcsgo-commit-buycase

Inputs:
- `eventId`, `platform`, `username`, `alias`, `qty`

Output data:
- `caseId`, `displayName`, `qty`, `newCount`

### tcsgo-commit-buykey

Inputs:
- `eventId`, `platform`, `username`, `qty`

Output data:
- `keyId`, `qty`, `newCount`

### tcsgo-commit-open

Inputs:
- `eventId`, `platform`, `username`, `alias`

Output data:
- `winner` (item fields)
- `imagePath`, `priceSnapshot`, `lockedUntil`
- `newCounts` (cases/keys)

### tcsgo-commit-sell-start

Inputs:
- `eventId`, `platform`, `username`, `oid`

Output data:
- `token`, `expiresAt`, `creditAmount`, `item`

### tcsgo-commit-sell-confirm

Inputs:
- `eventId`, `platform`, `username`, `token`

Output data:
- `creditedCoins`, `item`

## Possible case outcomes

- Standard: blue or purple tiers
- Rare: pink or red tiers
- Gold: gold/extraordinary tier
- Special variants: StatTrak and item variant fields (for example, Souvenir)

## Data files used by commands

- `data/inventories.json`: user inventories and items
- `data/case-aliases.json`: case list and alias mapping
- `data/prices.json`: price data and fallback rarity values
- `Case-Odds/*.json`: case pools and odds

## Setup notes

1) Update `TCSGO_BASE` in each command file if your repo path differs
2) Create commands in Lumia with the names listed above
3) Ensure `LOG_ENABLED` is true only when debugging
4) For TikTok chat, update `TIKTOK_SEND_COMMAND` if your send command name differs
