# PATCH

## Target: `services/PRICE-REFRESHER-README.md`

### Operation: REPLACE (Entire File)

### Anchor: Entire File

### Code:

````markdown
# TCSGO Price Refresher

## What This Does
- Updates `data/prices.json` With Fresh Prices
- Provider Order (Most Resilient):
  1) Skinport Bulk Cache (CAD) (If Enabled And Available)
  2) Steam Community Market `priceoverview` (CAD)
  3) CSFloat Lowest Buy-Now Listing (USD) Converted To CAD Using Bank Of Canada FXUSDCAD
- Creates Backups Before Writing
- Uses A Lock File To Prevent Multiple Instances
- Logs To `logs\price-refresher\` With Daily Rotation
- Stores Update Timestamps In `priceUpdatedAtUtc` (Inside `prices.json`)

## Install
1) From Repo Root:
```bat
cd /d "A:\Development\Version Control\Github\TCSGO"
````

2. If You Want Skinport Enabled (Recommended), Install Brotli:

```bat
python -m pip install brotli
```

3. Dry Run (No File Writes):

```bat
python services\price-refresher.py --dry-run
```

4. Real Run (Writes Backup + Updates prices.json):

```bat
python services\price-refresher.py
```

## Skinport Support (Free Bulk Provider)

Skinport Is Used As The First Provider When Enabled:

* `/v1/sales/history` Bulk Snapshot (Optional, Configurable)
* `/v1/items` Bulk Snapshot (Always)

Important:

* Skinport Requires Brotli (`Accept-Encoding: br`) For These Endpoints.
* If Brotli Is Not Installed, The Script Will Log A Warning And Continue Using Steam + CSFloat.

Install Brotli Decoder:

```bat
python -m pip install brotli
```

## CSFloat API Key (Optional) And Keeping It Out Of GitHub

CSFloat Fallback Works Best With An API Key, But You Should NOT Store It In A Tracked JSON File.

Recommended Options:

1. Secrets File (Ignored By Git)

* Create: `services\price-refresher-secrets.json`

```json
{
  "csfloatApiKey": "PASTE_YOUR_KEY_HERE"
}
```

2. Environment Variable

* System-Wide (Good For Scheduled Tasks Running As SYSTEM):

```bat
setx /M CSFLOAT_API_KEY "PASTE_YOUR_KEY_HERE"
```

* User-Level:

```bat
setx CSFLOAT_API_KEY "PASTE_YOUR_KEY_HERE"
```

The Script Loads CSFloat Key In This Order:

1. `services\price-refresher-secrets.json` (`csfloatApiKey`)
2. Environment Variable (Default: `CSFLOAT_API_KEY`)
3. Config `providers.csfloat.apiKey` (Discouraged; Logged As A Warning)

## Scheduling (Run On Boot + Run Weekly)

The Recommended Setup Is A Single Windows Task That Starts On Boot And Runs The Script In `--daemon` Mode.
The Script Then Executes Your Day/Time Schedule From Config.

1. Create The Task (Run As Administrator):

```bat
services\setup-price-refresher.bat
```

2. The Task Runs:

```bat
python services\price-refresher.py --config services\price-refresher-config.json --daemon
```

3. Change Schedule In:

* `services\price-refresher-config.json`

```json
"schedule": {
  "daysOfWeek": ["sunday"],
  "time": "03:00"
}
```

## Configuration Reference

Edit:

* `services\price-refresher-config.json`

Key Sections:

* `providers.skinport.enabled`: Enable/Disable Skinport
* `providers.skinport.useSalesHistory`: Use Sales History (Median/Mean Over A Window)
* `providers.steam.delaySeconds`: Slow Down Steam Requests If You Get Rate Limited
* `providers.csfloat.enabled`: Enable/Disable CSFloat Fallback
* `providers.csfloat.apiKeyEnvVar`: Environment Variable Name For CSFloat Key
* `cache.maxAgeHours`: Skip Items Updated More Recently Than This
* `git.enabled`: Auto-Commit `data/prices.json` After Successful Update

## Variant Items

If An Item Key Has `variant != None`, The Steam/Skinport Market Hash Name May Differ.
Add Exact Overrides Here:

* `services\market-hash-overrides.json`

Example:

```json
{
  "items": {
    "some-item-id|Factory New|0|Ruby": "★ Karambit | Doppler (Factory New) - Ruby"
  }
}
```

## Output Notes

* Prices Are Stored As CAD Floats (2 Decimals)
* Update Timestamps Are Stored In:

  * `priceUpdatedAtUtc.cases`
  * `priceUpdatedAtUtc.keys`
  * `priceUpdatedAtUtc.items`
* Backups Are Created As:

  * `data\prices.json.backup.YYYYMMDD_HHMMSS`

## Logs

Folder:

* `logs\price-refresher\`

Main Log:

* `price-refresher.log`

## Troubleshooting

* Skinport Fails With Brotli Error:

  * Install Brotli:

    ```bat
    python -m pip install brotli
    ```
* Steam Starts Returning Many Failures:

  * Increase `providers.steam.delaySeconds` (Example: 4.0 Or 5.0)
* CSFloat Returns 401/403:

  * Add A CSFloat Key Via Secrets Or Env Var
* “Another Instance Is Already Running (Lock Held)”:

  * Wait For The Current Run To Finish
  * If You Are Certain Nothing Is Running, Delete:

    * `services\price-refresher.lock`