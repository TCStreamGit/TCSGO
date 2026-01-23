#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import subprocess
import sys

def read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def main() -> int:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))

    cfg_path = os.path.join(repo_root, "services", "price-refresher-config.json")
    if not os.path.isfile(cfg_path):
        print("Missing Config: services/price-refresher-config.json", file=sys.stderr)
        return 2

    cfg = read_json(cfg_path)
    base = cfg["paths"]["base"]
    prices_path = os.path.join(base, cfg["paths"]["pricesJson"])
    case_odds_dir = os.path.join(base, cfg["paths"]["caseOddsDir"])

    if not os.path.isdir(case_odds_dir):
        print(f"Missing Case-Odds Dir: {case_odds_dir}", file=sys.stderr)
        return 2
    if not os.path.isfile(prices_path):
        print(f"Missing prices.json: {prices_path}", file=sys.stderr)
        return 2

    prices = read_json(prices_path)
    required = ["version", "cadToCoins", "marketFeePercent", "tradeLockDays", "statTrakMultiplier", "wearMultipliers", "rarityFallbackPrices", "cases", "keys", "items"]
    missing = [k for k in required if k not in prices]
    if missing:
        print("prices.json Missing Required Keys:", ", ".join(missing), file=sys.stderr)
        return 2

    # Run A Tiny Dry-Run Sample
    refresher = os.path.join(base, "services", "price-refresher.py")
    if not os.path.isfile(refresher):
        print(f"Missing Script: {refresher}", file=sys.stderr)
        return 2

    cmd = [sys.executable, refresher, "--config", "services/price-refresher-config.json", "--dry-run", "--max-items", "10"]
    p = subprocess.run(cmd, cwd=base, capture_output=True, text=True)
    print(p.stdout)
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr)
        return p.returncode

    print("Test Completed Successfully.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
