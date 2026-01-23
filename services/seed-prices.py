#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Seed prices.json With Default Prices For All Items Found In Case-Odds JSON Files.

Purpose:
- Pre-Fill prices.json With All Weapon Skins / Knives / Specials So The Refresher Only Needs To Update.
- Avoid Manual “Missing Key” Issues Downstream.

Behaviour:
- Preserves All Existing Non-Price Fields In prices.json
- Adds Missing Item Price Keys Using:
  <itemId>|<wear>|<statTrak01>|<variant>
- By Default, Does NOT Overwrite Existing Prices (Use --overwrite To Force)

Standard Library Only.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import shutil
import sys
from typing import Any, Dict, Iterable, List, Set, Tuple


DEFAULT_WEAR_ORDER = [
    "Factory New",
    "Minimal Wear",
    "Field-Tested",
    "Well-Worn",
    "Battle-Scarred",
]


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def read_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: str, data: Any) -> None:
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp_path, path)


def safe_copy(src: str, dst: str) -> None:
    shutil.copy2(src, dst)


def now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d_%H%M%S")


def list_case_files(case_odds_dir: str) -> List[str]:
    files: List[str] = []

    idx_path = os.path.join(case_odds_dir, "index.json")
    if os.path.isfile(idx_path):
        try:
            idx = read_json(idx_path)
            cases = idx.get("cases", []) if isinstance(idx, dict) else []
            if isinstance(cases, list):
                for c in cases:
                    if not isinstance(c, dict):
                        continue
                    fn = c.get("filename")
                    if isinstance(fn, str) and fn.lower().endswith(".json"):
                        fp = os.path.join(case_odds_dir, fn)
                        if os.path.isfile(fp):
                            files.append(fp)
        except Exception:
            files = []

    if files:
        return files

    try:
        for fn in os.listdir(case_odds_dir):
            if not fn.lower().endswith(".json"):
                continue
            if fn.lower() == "index.json":
                continue
            fp = os.path.join(case_odds_dir, fn)
            if os.path.isfile(fp):
                files.append(fp)
    except Exception:
        pass

    return files


def iter_items_from_case_json(doc: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    """
    Supports Both Layouts:
    - Older: { "tiers": { ... } }
    - Newer: { "case": { "tiers": { ... }, "goldPool": { "items": [...] } } }
    """

    def yield_from_items(items: Any) -> Iterable[Dict[str, Any]]:
        if not isinstance(items, list):
            return []
        out: List[Dict[str, Any]] = []
        for it in items:
            if isinstance(it, dict):
                out.append(it)
        return out

    tiers = None
    if isinstance(doc.get("tiers"), dict):
        tiers = doc.get("tiers")
    elif isinstance(doc.get("case"), dict) and isinstance(doc["case"].get("tiers"), dict):
        tiers = doc["case"].get("tiers")

    if isinstance(tiers, dict):
        for _, items in tiers.items():
            for it in yield_from_items(items):
                yield it

    gold_pool = None
    if isinstance(doc.get("goldPool"), dict):
        gold_pool = doc.get("goldPool")
    elif isinstance(doc.get("case"), dict) and isinstance(doc["case"].get("goldPool"), dict):
        gold_pool = doc["case"].get("goldPool")

    if isinstance(gold_pool, dict):
        for it in yield_from_items(gold_pool.get("items")):
            yield it


def extract_case_id(doc: Dict[str, Any]) -> str:
    c = doc.get("case")
    if isinstance(c, dict):
        cid = c.get("id")
        if isinstance(cid, str):
            return cid
    return ""


def build_item_price_key(item_id: str, wear: str, stattrak: int, variant: str) -> str:
    v = variant if variant else "None"
    return f"{item_id}|{wear}|{int(stattrak)}|{v}"


def load_wear_list_from_prices(prices: Dict[str, Any]) -> List[str]:
    wm = prices.get("wearMultipliers")
    if isinstance(wm, dict):
        wears = [str(k) for k in wm.keys() if isinstance(k, str)]
        if wears:
            # Preserve A Human-Friendly Order If Possible
            ordered: List[str] = []
            for w in DEFAULT_WEAR_ORDER:
                if w in wears:
                    ordered.append(w)
            for w in wears:
                if w not in ordered:
                    ordered.append(w)
            return ordered
    return list(DEFAULT_WEAR_ORDER)


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed prices.json With Default Prices For All Case Items")
    ap.add_argument("--config", default="services/price-refresher-config.json", help="Path To Config JSON (Relative To Repo Root)")
    ap.add_argument("--value", type=float, default=1.0, help="Default CAD Price To Assign")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite Existing Prices")
    ap.add_argument("--dry-run", action="store_true", help="Do Not Write Any Files")
    ap.add_argument("--items-only", action="store_true", help="Only Seed prices.items (Do Not Touch cases/keys)")
    ap.add_argument("--seed-cases", action="store_true", help="Also Seed prices.cases Using Case Ids From Case-Odds")
    ap.add_argument("--seed-keys", action="store_true", help="Also Seed prices.keys If Missing Entries Exist")
    ap.add_argument("--no-stattrak", action="store_true", help="Do Not Seed StatTrak Variants")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))
    cfg_path = os.path.join(repo_root, args.config)

    if not os.path.isfile(cfg_path):
        print(f"Config Not Found: {cfg_path}", file=sys.stderr)
        return 2

    cfg = read_json(cfg_path)
    if not isinstance(cfg, dict) or not isinstance(cfg.get("paths"), dict):
        print("Invalid Config JSON (Missing paths).", file=sys.stderr)
        return 2

    base = str(cfg["paths"].get("base", repo_root))
    prices_path = os.path.join(base, str(cfg["paths"]["pricesJson"]))
    case_odds_dir = os.path.join(base, str(cfg["paths"]["caseOddsDir"]))

    if not os.path.isfile(prices_path):
        print(f"prices.json Not Found: {prices_path}", file=sys.stderr)
        return 2
    if not os.path.isdir(case_odds_dir):
        print(f"Case-Odds Dir Not Found: {case_odds_dir}", file=sys.stderr)
        return 2

    prices = read_json(prices_path)
    if not isinstance(prices, dict):
        print("prices.json Must Be A JSON Object.", file=sys.stderr)
        return 2

    if not isinstance(prices.get("cases"), dict):
        prices["cases"] = {}
    if not isinstance(prices.get("keys"), dict):
        prices["keys"] = {}
    if not isinstance(prices.get("items"), dict):
        prices["items"] = {}

    wears = load_wear_list_from_prices(prices)

    case_files = list_case_files(case_odds_dir)
    if not case_files:
        print("No Case JSON Files Found In Case-Odds.", file=sys.stderr)
        return 2

    # Collect Unique Items Across All Cases
    seen_items: Set[Tuple[str, str, bool]] = set()
    seen_case_ids: Set[str] = set()

    for fp in case_files:
        try:
            doc = read_json(fp)
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue

        cid = extract_case_id(doc)
        if cid:
            seen_case_ids.add(cid)

        for it in iter_items_from_case_json(doc):
            item_id = it.get("itemId")
            variant = it.get("variant", "None")
            st_ok = it.get("statTrakEligible", False)

            if not isinstance(item_id, str) or not item_id.strip():
                continue
            if not isinstance(variant, str) or not variant.strip():
                variant = "None"
            st_bool = bool(st_ok)

            seen_items.add((item_id.strip(), variant.strip(), st_bool))

    items_dict: Dict[str, Any] = prices["items"]
    cases_dict: Dict[str, Any] = prices["cases"]
    keys_dict: Dict[str, Any] = prices["keys"]

    seeded_items = 0
    skipped_items = 0

    seeded_cases = 0
    skipped_cases = 0

    seeded_keys = 0
    skipped_keys = 0

    default_value = float(args.value)

    # Seed Items
    for (item_id, variant, st_eligible) in sorted(seen_items):
        # Always Seed Non-StatTrak
        for wear in wears:
            k0 = build_item_price_key(item_id, wear, 0, variant)
            if args.overwrite or (k0 not in items_dict):
                items_dict[k0] = default_value
                seeded_items += 1
            else:
                skipped_items += 1

            if args.no_stattrak:
                continue
            if st_eligible:
                k1 = build_item_price_key(item_id, wear, 1, variant)
                if args.overwrite or (k1 not in items_dict):
                    items_dict[k1] = default_value
                    seeded_items += 1
                else:
                    skipped_items += 1

    # Seed Cases (Optional)
    if (not args.items_only) and args.seed_cases:
        for cid in sorted(seen_case_ids):
            if args.overwrite or (cid not in cases_dict):
                cases_dict[cid] = default_value
                seeded_cases += 1
            else:
                skipped_cases += 1

    # Seed Keys (Optional)
    if (not args.items_only) and args.seed_keys:
        # Ensure At Least These Keys Exist If You Use Them Elsewhere
        must_have = ["default", "csgo-case-key"]
        for kid in must_have:
            if args.overwrite or (kid not in keys_dict):
                keys_dict[kid] = default_value
                seeded_keys += 1
            else:
                skipped_keys += 1

    print("Seed Summary:")
    print(f"- Items Seeded: {seeded_items} | Items Skipped: {skipped_items}")
    if (not args.items_only) and args.seed_cases:
        print(f"- Cases Seeded: {seeded_cases} | Cases Skipped: {skipped_cases}")
    if (not args.items_only) and args.seed_keys:
        print(f"- Keys Seeded: {seeded_keys} | Keys Skipped: {skipped_keys}")

    if args.dry_run:
        print("Dry Run Enabled; No Files Were Written.")
        return 0

    # Backup Then Write
    ts = now_stamp()
    backup_path = prices_path + f".backup.seed.{ts}"
    safe_copy(prices_path, backup_path)
    print(f"Backup Created: {backup_path}")

    write_json_atomic(prices_path, prices)
    print("prices.json Seeded Successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
