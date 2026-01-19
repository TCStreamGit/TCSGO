# README — Lumia CS:GO/CS2 Container JSON Format (Cases + Souvenir Packages)

This document defines **exactly how each exported container JSON must look**, how it’s structured, what each field means, and the **hard validation rules** an AI (or script) should use to review your entire library of JSONs for correctness.

---

## 1) What these JSONs are for

Each JSON file represents **one** CS:GO/CS2 “container” that can be opened in your Lumia Stream simulator:

* **Standard cases** (weapon/operation/esports/etc.): have color tiers (blue/purple/pink/red) and a **Rare Special Item** pool (gold) with **fully expanded** knife/glove outcomes.
* **Souvenir packages**: do **not** have knives/gloves, do **not** support StatTrak, and instead contain **map collection** skins using collection tiers (consumer/industrial/milspec/restricted/classified/covert).

The simulator should pick outcomes using **integer weights** that sum to **1,000,000,000,000** (`unit.scale`) per container.

---

## 2) File naming & IDs

### File naming

* Store one file per container:

  * `data/containers/<case.id>.json`

### ID convention (required)

All IDs must be **kebab-case only**:

* Allowed characters: `a-z`, `0-9`, `-`
* Applies to:

  * `case.id`
  * `goldPool.poolId` (if present)
  * every `itemId`

✅ Good: `csgo-weapon-case-2`, `m4a1-s-blood-tiger`
❌ Bad: `csgo_weapon_case_2`, `M4A1S_BloodTiger`

---

## 3) Output formatting rules (JSON hygiene)

These rules exist to keep parsing + downstream JS simple:

* **No `null`** anywhere.
* **No empty strings** `""` anywhere.
* If something doesn’t apply, use the literal string: `"None"`.
* JSON must be **pretty-printed** (multi-line) — do **not** minify into a single line.
* Every `sources` array must contain **at least 1** URL string.
* All `sources` entries must be **plain URL strings only**:

  * Must begin with `http://` or `https://`
  * No markdown links, no brackets, no parentheses.

✅ Good: `"https://csgostash.com/case/1/CS:GO-Weapon-Case"`
❌ Bad: `"[text](https://...)"`, `"(https://...)"`

---

## 4) Schema overview (required structure)

Every file must match this top-level layout:

```json
{
  "schemaVersion": "3.1-container-export",
  "unit": { "scale": 1000000000000, "name": "ppt" },
  "meta": { ... },
  "case": { ... },
  "audit": { ... }
}
```

### 4.1 `unit`

* `unit.scale` MUST be exactly `1000000000000`
* `unit.name` MUST be `"ppt"`

### 4.2 `meta`

Required keys:

* `meta.game` = `"CSGO/CS2"`
* `meta.generatedAt` = ISO-8601 timestamp string
* `meta.defaultOdds` must include both:

  * `case` default odds (blue/purple/pink/red/gold)
  * `collection` default odds (consumer/industrial/milspec/restricted/classified/covert)
* `meta.defaultStatTrakRate` = `0.1`

---

## 5) Container types & required tier keys

### A) Standard cases (non-souvenir)

`case.caseType` is one of:

* `weapon_case`, `operation_case`, `esports_case`, `special_event_case`, `other`

**Required tiers**

* `tiers.blue` (Mil-Spec)
* `tiers.purple` (Restricted)
* `tiers.pink` (Classified)
* `tiers.red` (Covert)

**Required gold**

* `goldPool` MUST be an object (not `"None"`)
* `goldPool.items` MUST contain the **FULL expanded** rare pool:

  * every knife/glove type AND every finish/phase variant as its own entry
  * no `...`, no “etc.”, no missing outcomes

### B) Souvenir packages

`case.caseType` MUST be:

* `souvenir_package`

**Required tiers**

* `tiers.consumer`
* `tiers.industrial`
* `tiers.milspec`
* `tiers.restricted`
* `tiers.classified`
* `tiers.covert`

**Forbidden**

* `goldPool` MUST be `"None"` (no knives/gloves)
* No StatTrak of any kind (see StatTrak rules below)

**Souvenir item marking**

* Every item must be a “Souvenir” version:

  * `item.variant` = `"Souvenir"`
  * `displayName` should include the word `"Souvenir"`

**Stickers**

* Do not enumerate sticker permutations.
* Use `case.souvenir.stickersMode = "ignored"`

---

## 6) `case` object rules

Required keys:

| Key                     | Required | Notes                                        |
| ----------------------- | -------: | -------------------------------------------- |
| `case.id`               |        ✅ | kebab-case                                   |
| `case.name`             |        ✅ | non-empty string                             |
| `case.caseType`         |        ✅ | must match container type rules              |
| `case.supportsStatTrak` |        ✅ | `false` for souvenir packages                |
| `case.statTrakRate`     |        ✅ | `0` for souvenirs; `0.1` default for cases   |
| `case.sources`          |        ✅ | ≥ 1 plain URL string                         |
| `case.notes`            |        ✅ | array of non-empty strings (≥ 1 recommended) |
| `case.souvenir`         |        ✅ | `"None"` for cases; object for souvenirs     |
| `case.oddsWeights`      |        ✅ | integers that sum to `unit.scale`            |
| `case.tiers`            |        ✅ | must include all tier lists for that type    |
| `case.goldPool`         |        ✅ | object for cases; `"None"` for souvenirs     |

### `case.souvenir` rules

* For non-souvenir: `"None"`
* For souvenir packages: object with:

  * `tournament`, `year`, `map`, `collection` (strings, can be `"None"` but not empty)
  * `stickersMode`: `"ignored"`
  * `sources`: ≥ 1 plain URL string

---

## 7) ItemObject rules (every item in tiers and goldPool.items)

Every item entry MUST include all fields below:

```json
{
  "itemId": "kebab-case",
  "displayName": "Non-empty",
  "category": "weapon|knife|glove|other",
  "weapon": "Non-empty or 'None'",
  "skin": "Non-empty or 'None'",
  "variant": "Non-empty or 'None' (Souvenir uses 'Souvenir')",
  "rarity": "tier-key",
  "statTrakEligible": true,
  "verified": true,
  "confidence": "High|Medium|Low",
  "rationale": "Non-empty explanation",
  "weights": { "base": 123, "nonStatTrak": 111, "statTrak": 12 },
  "probs": {
    "base": "0.000000000000000000",
    "nonStatTrak": "0.000000000000000000",
    "statTrak": "0.000000000000000000"
  }
}
```

### No missing items rule

* Do not output a container unless its tier lists are **complete** for that container type.
* If anything is uncertain, the item must still be included with:

  * `verified: false`
  * `confidence: "High" | "Medium" | "Low"`
  * `rationale`: **non-empty** explanation of the estimate

---

## 8) Math & integrity rules (the most important part)

### 8.1 Weight totals

* `unit.scale` is exactly **1,000,000,000,000**
* `case.oddsWeights` MUST sum to exactly `unit.scale`
* The sum of **all** `weights.base` across:

  * every item in every tier
  * plus every item in `goldPool.items` (if goldPool exists)

  MUST equal exactly `unit.scale`

### 8.2 Computed audit total (not hardcoded)

* `audit.weightSums.totalCaseWeight` MUST be the **computed** sum of all item `weights.base`.
* It MUST equal `unit.scale`.
* `audit.weightSums.expectedTotalCaseWeight` MUST be `1000000000000`.

### 8.3 Per-item StatTrak consistency

For every item:

* `weights.base = weights.nonStatTrak + weights.statTrak`

### 8.4 Prob strings

For every item:

* `probs.base = weights.base / unit.scale`
* `probs.nonStatTrak = weights.nonStatTrak / unit.scale`
* `probs.statTrak = weights.statTrak / unit.scale`

And every `probs.*` must be:

* a **decimal string**
* with **at least 18 digits after the decimal**

✅ Good: `"0.006400000000000000"`
❌ Bad: `0.0064` (number), `"0.0064"` (not enough precision)

---

## 9) StatTrak rules

### Standard cases

* Weapons & knives: default StatTrak rate **10%**
* Gloves: StatTrak is **impossible**:

  * `statTrakEligible: false`
  * `weights.statTrak: 0`
  * `weights.nonStatTrak = weights.base`

**Never allow eligible StatTrak to round to zero**

* If `statTrakEligible: true` and `weights.base > 0` but computed `weights.statTrak == 0`:

  * force `weights.statTrak = 1`
  * set `weights.nonStatTrak = weights.base - 1`

### Souvenir packages

StatTrak is **impossible** for all items:

* `case.supportsStatTrak = false`
* `case.statTrakRate = 0`
* For every item:

  * `statTrakEligible = false`
  * `weights.statTrak = 0`
  * `weights.nonStatTrak = weights.base`

---

## 10) How the simulator should use these JSONs

### Selection flow (recommended)

1. **Choose tier** using `case.oddsWeights`
2. **Choose item within tier** using each item’s `weights.base`
3. Determine StatTrak outcome by using the embedded split:

   * if `weights.statTrak > 0`, you can:

     * roll within the item using `weights.nonStatTrak` vs `weights.statTrak`
     * or treat `itemId + ":st"` as a second-level outcome

### Why the weights are structured this way

* Keeps the dataset deterministic and easy to validate.
* Avoids floating point drift.
* Allows ultra-small outcomes without representing “0%”.

---

## 11) `audit` section requirements

Required structure:

```json
"audit": {
  "tierCounts": { "...": 0 },
  "weightSums": {
    "totalCaseWeight": 1000000000000,
    "expectedTotalCaseWeight": 1000000000000
  },
  "warnings": ["Non-empty string"]
}
```

Rules:

* `tierCounts` must match actual array lengths.
* `warnings` can be empty array **only if allowed by your system**; if unsure, include at least one meaningful warning string.
  (If you require non-empty strings always, keep warnings ≥ 1.)

---

## 12) Common mistakes (AI reviewer should catch)

* Pink tier weight typo (e.g., `320000000000` instead of `32000000000`)
* `audit.weightSums.totalCaseWeight` hardcoded but not equal to computed sum
* Markdown links in `sources`
* Any `null` or `""`
* Missing any tier list required for the container type
* Gold pool not fully expanded (cases)
* Souvenir package containing goldPool or StatTrak
* Any `...` or “etc.”
* One-line/minified JSON output
* `probs` are numbers instead of strings or don’t have ≥ 18 decimal digits

---

## 13) AI Review Checklist (what the reviewing AI must do)

When reviewing a JSON file, the AI should:

1. **Parse check**

   * Confirm it is valid JSON and pretty-printed

2. **Schema presence**

   * Confirm required top-level keys exist: `schemaVersion`, `unit`, `meta`, `case`, `audit`

3. **No null/blank**

   * Verify no `null`, no `""`

4. **Sources validation**

   * Every `sources[]` entry is a plain URL string starting with `http://` or `https://`

5. **Type compliance**

   * If `case.caseType == "souvenir_package"`:

     * goldPool must be `"None"`
     * supportsStatTrak must be `false`
     * statTrakRate must be `0`
     * tiers must be collection tiers
   * Otherwise:

     * tiers must include `blue/purple/pink/red`
     * goldPool must be an object and fully expanded

6. **Math checks**

   * `oddsWeights` sum equals `unit.scale`
   * Sum of all item `weights.base` equals `unit.scale`
   * `audit.weightSums.totalCaseWeight` equals computed sum
   * For each item: `base = nonStatTrak + statTrak`

7. **Prob checks**

   * `probs.*` are decimal strings with ≥ 18 digits after decimal
   * Each equals weights / unit.scale

8. **StatTrak policy checks**

   * Gloves never StatTrak
   * Souvenirs never StatTrak
   * Eligible items with base>0 must not have statTrak=0

9. **Completeness**

   * No missing items, no ellipses
   * If uncertain items exist, they must be `verified=false` with confidence + non-empty rationale

---

## 14) Recommended AI Reviewer Output Format

To review a library of files, run the review per file and output:

* `PASS` / `FAIL`
* list of violations with:

  * JSON path (e.g., `case.sources[0]`)
  * what’s wrong
  * how to fix

Example:

```text
csgo-weapon-case.json — FAIL
- case.sources[0]: contains markdown link; must be plain URL string
- case.oddsWeights.pink: expected 32000000000; found 320000000000 (10x)
- audit.weightSums.totalCaseWeight: hardcoded; does not match computed sum (computed=999999999999)
```

---

## 15) <mark style='background: var(--mk-color-yellow)'>ASSUMPTION</mark> Default odds reference

If exact per-item weights aren’t available, the dataset uses deterministic equal distribution within each tier.

### Standard case default odds

* blue  = 0.7992
* purple= 0.1598
* pink  = 0.0320
* red   = 0.0064
* gold  = 0.0026

### Souvenir/collection default odds

* consumer   = 0.7992
* industrial = 0.1598
* milspec    = 0.0320
* restricted = 0.0064
* classified = 0.00128
* covert     = 0.000256

---

## 16) Minimal skeleton examples

### A) Standard case skeleton (structure only)

```json
{
  "schemaVersion": "3.1-container-export",
  "unit": { "scale": 1000000000000, "name": "ppt" },
  "meta": {
    "game": "CSGO/CS2",
    "generatedAt": "2026-01-17T00:00:00Z",
    "defaultOdds": {
      "case": { "blue": 0.7992, "purple": 0.1598, "pink": 0.032, "red": 0.0064, "gold": 0.0026 },
      "collection": { "consumer": 0.7992, "industrial": 0.1598, "milspec": 0.032, "restricted": 0.0064, "classified": 0.00128, "covert": 0.000256 }
    },
    "defaultStatTrakRate": 0.1
  },
  "case": {
    "id": "csgo-weapon-case",
    "name": "CS:GO Weapon Case",
    "caseType": "weapon_case",
    "supportsStatTrak": true,
    "statTrakRate": 0.1,
    "sources": ["https://example.com"],
    "notes": ["Tier odds use default model; within-tier weights equal."],
    "souvenir": "None",
    "oddsWeights": { "blue": 799200000000, "purple": 159800000000, "pink": 32000000000, "red": 6400000000, "gold": 2600000000 },
    "tiers": { "blue": [], "purple": [], "pink": [], "red": [] },
    "goldPool": {
      "poolId": "original-knives",
      "name": "Original Knives",
      "category": "knife_pool",
      "sources": ["https://example.com"],
      "items": []
    }
  },
  "audit": {
    "tierCounts": { "blue": 0, "purple": 0, "pink": 0, "red": 0, "gold": 0 },
    "weightSums": { "totalCaseWeight": 1000000000000, "expectedTotalCaseWeight": 1000000000000 },
    "warnings": ["Within-tier weights assumed equal; StatTrak uses default rate."]
  }
}
```

### B) Souvenir package skeleton (structure only)

```json
{
  "schemaVersion": "3.1-container-export",
  "unit": { "scale": 1000000000000, "name": "ppt" },
  "meta": {
    "game": "CSGO/CS2",
    "generatedAt": "2026-01-17T00:00:00Z",
    "defaultOdds": {
      "case": { "blue": 0.7992, "purple": 0.1598, "pink": 0.032, "red": 0.0064, "gold": 0.0026 },
      "collection": { "consumer": 0.7992, "industrial": 0.1598, "milspec": 0.032, "restricted": 0.0064, "classified": 0.00128, "covert": 0.000256 }
    },
    "defaultStatTrakRate": 0.1
  },
  "case": {
    "id": "paris-2023-mirage-souvenir-package",
    "name": "Paris 2023 Mirage Souvenir Package",
    "caseType": "souvenir_package",
    "supportsStatTrak": false,
    "statTrakRate": 0,
    "sources": ["https://example.com"],
    "notes": ["Souvenir package: collection tiers; stickers ignored; no StatTrak."],
    "souvenir": {
      "tournament": "Paris Major",
      "year": "2023",
      "map": "Mirage",
      "collection": "Mirage Collection",
      "stickersMode": "ignored",
      "sources": ["https://example.com"]
    },
    "oddsWeights": {
      "consumer": 799200000000,
      "industrial": 159800000000,
      "milspec": 32000000000,
      "restricted": 6400000000,
      "classified": 1280000000,
      "covert": 256000000
    },
    "tiers": {
      "consumer": [],
      "industrial": [],
      "milspec": [],
      "restricted": [],
      "classified": [],
      "covert": []
    },
    "goldPool": "None"
  },
  "audit": {
    "tierCounts": { "consumer": 0, "industrial": 0, "milspec": 0, "restricted": 0, "classified": 0, "covert": 0 },
    "weightSums": { "totalCaseWeight": 1000000000000, "expectedTotalCaseWeight": 1000000000000 },
    "warnings": ["Collection odds use default model; within-tier weights equal; stickers ignored."]
  }
}
```

---