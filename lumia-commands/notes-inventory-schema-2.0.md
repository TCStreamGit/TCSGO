# Inventory Schema 2.0 Commit Updates

Updated scripts:
- tcsgo-commit-buycase.js
- tcsgo-commit-buykey.js
- tcsgo-commit-open.js
- tcsgo-commit-sell-start.js
- tcsgo-commit-sell-confirm.js

New helper functions (added per script):
- resolveBasePath (reads global `TCSGO_BASE`, with env fallback)
- joinPath (uses base path separator)
- uuidv4 (inventory id generation)
- createEmptyInventories / ensureInventoryRoot (schema 2.0 root setup)
- getOrCreateInventory (identityIndex lookup + auto-create)
