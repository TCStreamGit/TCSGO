#!/usr/bin/env python3
"""
build_case_aliases.py - Auto-generate data/case-aliases.json from Case-Odds/*.json

Usage:
    python tools/build_case_aliases.py           # Build aliases
    python tools/build_case_aliases.py --dry-run # Preview without writing

Features:
- Scans Case-Odds/*.json (ignores index.json)
- Extracts case.id, case.name, caseType, schemaVersion
- Computes requiresKey based on caseType
- Generates derived aliases (full id, short base, compact, filename compact)
- Handles collisions (drops derived alias, keeps full caseId)
- Merges manual overrides from data/case-aliases.manual.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Paths (relative to repo root)
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
CASE_ODDS_DIR = REPO_ROOT / "Case-Odds"
OUTPUT_FILE = REPO_ROOT / "data" / "case-aliases.json"
MANUAL_FILE = REPO_ROOT / "data" / "case-aliases.manual.json"

# Suffixes to strip for short base alias (order: longer/more specific first)
SUFFIX_PATTERNS = [
    "-weapon-case",
    "-souvenir-package",
    "-collection-package", 
    "-package",
    "-case",
]

# Case types that do NOT require a key
NO_KEY_CASE_TYPES = {
    "souvenir_package",
    "souvenir-package",
    "other",  # Collection packages don't need keys
}


def compute_requires_key(case_type: str | None) -> bool:
    """Determine if case requires a key based on caseType."""
    if not case_type:
        return True
    return case_type.lower() not in NO_KEY_CASE_TYPES


def generate_short_base(case_id: str) -> str | None:
    """Remove suffix from caseId to get short base alias."""
    short = case_id.lower()
    for suffix in SUFFIX_PATTERNS:
        if short.endswith(suffix):
            short = short[:-len(suffix)]
            break
    short = short.rstrip("-")
    if not short or short == case_id.lower():
        return None
    return short


def generate_compact(base: str) -> str:
    """Remove all non-alphanumeric chars from base."""
    return re.sub(r'[^a-z0-9]', '', base.lower())


def load_case_json(filepath: Path) -> dict | None:
    """Load and parse a case JSON file."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"  ⚠️  Error loading {filepath.name}: {e}", file=sys.stderr)
        return None


def load_manual_overrides() -> dict:
    """Load manual alias overrides if file exists."""
    if not MANUAL_FILE.exists():
        return {}
    try:
        with open(MANUAL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("aliases", {})
    except (json.JSONDecodeError, IOError) as e:
        print(f"  ⚠️  Error loading manual overrides: {e}", file=sys.stderr)
        return {}


def scan_case_odds() -> list[dict[str, Any]]:
    """Scan Case-Odds/*.json and extract metadata for each case."""
    cases = []
    
    if not CASE_ODDS_DIR.exists():
        print(f"❌ Case-Odds directory not found: {CASE_ODDS_DIR}", file=sys.stderr)
        return cases
    
    for filepath in sorted(CASE_ODDS_DIR.glob("*.json")):
        if filepath.name.lower() == "index.json":
            continue
        
        data = load_case_json(filepath)
        if not data:
            continue
        
        case_obj = data.get("case", {})
        case_id = case_obj.get("id")
        if not case_id:
            print(f"  ⚠️  Skipping {filepath.name}: missing case.id", file=sys.stderr)
            continue
        
        cases.append({
            "filename": filepath.name,
            "caseId": case_id,
            "displayName": case_obj.get("name") or case_id,
            "caseType": case_obj.get("caseType") or "unknown",
            "schemaVersion": data.get("schemaVersion") or "unknown",
            "requiresKey": compute_requires_key(case_obj.get("caseType")),
        })
    
    return cases


def build_alias_map(cases: list[dict[str, Any]], manual_overrides: dict) -> tuple[dict, dict, list]:
    """
    Build alias and cases mappings with collision detection.
    
    Returns: (aliases dict, cases dict, warnings list)
    """
    # Track which caseIds want each alias
    alias_sources: dict[str, list[str]] = {}
    case_potential_aliases: dict[str, list[str]] = {}
    
    # Build cases lookup
    cases_map: dict[str, dict] = {}
    for c in cases:
        case_id = c["caseId"]
        cases_map[case_id] = {
            "caseId": case_id,
            "filename": c["filename"],
            "displayName": c["displayName"],
            "requiresKey": c["requiresKey"],
            "caseType": c["caseType"],
            "schemaVersion": c["schemaVersion"],
        }
        
        # Generate potential aliases
        potential = set()
        case_id_lower = case_id.lower()
        
        # A) Full caseId (always)
        potential.add(case_id_lower)
        
        # B) Short base (remove suffix)
        short_base = generate_short_base(case_id)
        if short_base:
            potential.add(short_base)
            # C) Compact alias from short base
            compact = generate_compact(short_base)
            if compact and compact != short_base:
                potential.add(compact)
        
        # D) Filename compact
        stem = Path(c["filename"]).stem.lower()
        filename_compact = generate_compact(stem)
        if filename_compact:
            potential.add(filename_compact)
        
        case_potential_aliases[case_id] = list(potential)
        
        for alias in potential:
            alias_sources.setdefault(alias, []).append(case_id)
    
    # Detect collisions
    collisions = {a for a, sources in alias_sources.items() if len(sources) > 1}
    
    # Build final alias map
    aliases: dict[str, dict] = {}
    warnings: list[str] = []
    
    for c in cases:
        case_id = c["caseId"]
        case_id_lower = case_id.lower()
        
        for alias in case_potential_aliases[case_id]:
            if alias in collisions and alias != case_id_lower:
                # Drop derived alias on collision
                others = [x for x in alias_sources[alias] if x != case_id]
                warnings.append(f"Alias '{alias}' collision: {case_id} vs {', '.join(others)}; dropped")
                continue
            
            if alias not in aliases:
                aliases[alias] = {
                    "caseId": case_id,
                    "filename": c["filename"],
                    "displayName": c["displayName"],
                    "requiresKey": c["requiresKey"],
                }
    
    # Merge manual overrides (always win)
    for alias, override in manual_overrides.items():
        alias_lower = alias.lower()
        target_case_id = override.get("caseId")
        
        if target_case_id and target_case_id in cases_map:
            case_info = cases_map[target_case_id]
            aliases[alias_lower] = {
                "caseId": target_case_id,
                "filename": case_info["filename"],
                "displayName": case_info["displayName"],
                "requiresKey": case_info["requiresKey"],
            }
        else:
            warnings.append(f"Manual alias '{alias}' points to unknown caseId: {target_case_id}")
    
    return aliases, cases_map, list(dict.fromkeys(warnings))


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv
    
    print("=" * 60)
    print("TCSGO Case Alias Builder")
    print("=" * 60)
    
    if dry_run:
        print("🔍 DRY RUN MODE - No files will be written\n")
    
    # Scan cases
    print(f"📂 Scanning: {CASE_ODDS_DIR}")
    cases = scan_case_odds()
    print(f"   Found {len(cases)} case JSON files")
    
    # Load manual overrides
    manual_overrides = load_manual_overrides()
    if manual_overrides:
        print(f"📝 Loaded {len(manual_overrides)} manual overrides from {MANUAL_FILE.name}")
    
    if not cases:
        print("❌ No cases found. Exiting.", file=sys.stderr)
        sys.exit(1)
    
    # Build maps
    print("\n🔧 Building alias map...")
    aliases, cases_map, warnings = build_alias_map(cases, manual_overrides)
    print(f"   Generated {len(aliases)} aliases for {len(cases_map)} cases")
    
    if warnings:
        print(f"\n⚠️  Warnings ({len(warnings)}):")
        for w in warnings[:10]:
            print(f"   - {w}")
        if len(warnings) > 10:
            print(f"   ... and {len(warnings) - 10} more")
    
    # Build output
    output = {
        "schemaVersion": "1.0-case-aliases",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "aliases": dict(sorted(aliases.items())),
        "cases": dict(sorted(cases_map.items())),
    }
    
    output_json = json.dumps(output, indent=2, ensure_ascii=False)
    
    if dry_run:
        print(f"\n📝 Would write to: {OUTPUT_FILE}")
        print(f"   File size: ~{len(output_json):,} bytes")
        print("\n📋 Sample aliases:")
        for key in list(aliases.keys())[:5]:
            e = aliases[key]
            print(f"   {key} -> {e['caseId']} (key: {e['requiresKey']})")
    else:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(output_json)
        print(f"\n✅ Written to: {OUTPUT_FILE}")
        print(f"   File size: {len(output_json):,} bytes")
    
    # Summary
    key_req = sum(1 for c in cases_map.values() if c["requiresKey"])
    print("\n" + "=" * 60)
    print(f"Generated {len(aliases)} aliases for {len(cases_map)} cases")
    print(f"  Key required: {key_req} | No key: {len(cases_map) - key_req}")
    print("=" * 60)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
