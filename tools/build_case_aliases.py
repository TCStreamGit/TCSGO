#!/usr/bin/env python3
"""
build_case_aliases.py - Auto-generate data/case-aliases.json from Case-Odds/*.json

Usage:
    python tools/build_case_aliases.py           # Build aliases
    python tools/build_case_aliases.py --dry-run # Preview without writing

Output Schema (data/case-aliases.json):
{
  "schemaVersion": "1.0-case-aliases",
  "generatedAt": "ISO-UTC",
  "sourceDir": "Case-Odds",
  "cases": { "<caseId>": { caseId, filename, displayName, caseType, caseSchemaVersion, requiresKey, image } },
  "aliases": { "<alias>": { caseId, filename, displayName, requiresKey } }
}

Features:
- Scans Case-Odds/*.json (ignores index.json)
- Extracts case.id, case.name, caseType, schemaVersion, case.image
- Computes requiresKey based on caseType
- Generates derived aliases (full id, filename slug, short base, compact)
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
SOURCE_DIR_NAME = "Case-Odds"
OUTPUT_FILE = REPO_ROOT / "data" / "case-aliases.json"
MANUAL_FILE = REPO_ROOT / "data" / "case-aliases.manual.json"

# Suffixes to strip for short base alias (order: longer/more specific first)
SUFFIX_PATTERNS = [
    "-weapon-case",
    "-souvenir-package",
    "-collection-package",
    "-package",
    "-case",
    "-weapon",
]

# Case types that do NOT require a key (normalized to lowercase, any separator style)
NO_KEY_CASE_TYPES = {
    # souvenir packages
    "souvenir-package",
    "souvenir_package",
    "souvenirpackage",
    # collection packages
    "collection-package",
    "collection_package",
    "collectionpackage",
    # other (e.g., Anubis Collection Package)
    "other",
}


def normalize_case_type(case_type):
    """Normalize case type for comparison."""
    if not case_type:
        return ""
    return case_type.lower().replace("_", "-").replace(" ", "-")


def compute_requires_key(case_type):
    """Determine if case requires a key based on caseType."""
    if not case_type:
        return True
    normalized = normalize_case_type(case_type)
    # Also check normalized without any separators
    compact = re.sub(r'[^a-z0-9]', '', normalized)
    return normalized not in NO_KEY_CASE_TYPES and compact not in {
        re.sub(r'[^a-z0-9]', '', t) for t in NO_KEY_CASE_TYPES
    }


def filename_to_slug(filename):
    """Convert filename to kebab-case slug (e.g., CS20_Case.json -> cs20-case)."""
    stem = Path(filename).stem
    # Replace underscores with hyphens, lowercase
    slug = stem.replace("_", "-").lower()
    # Collapse multiple hyphens
    slug = re.sub(r'-+', '-', slug)
    return slug.strip("-")


def generate_short_base(case_id):
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


def generate_compact(base):
    """Remove all non-alphanumeric chars from base."""
    return re.sub(r'[^a-z0-9]', '', base.lower())


def load_case_json(filepath):
    """Load and parse a case JSON file."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Warning: Error loading {filepath.name}: {e}", file=sys.stderr)
        return None


def load_manual_overrides():
    """Load manual alias overrides if file exists."""
    if not MANUAL_FILE.exists():
        return {}
    try:
        with open(MANUAL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("aliases", {})
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Warning: Error loading manual overrides: {e}", file=sys.stderr)
        return {}


def scan_case_odds():
    """Scan Case-Odds/*.json and extract metadata for each case."""
    cases = []
    
    if not CASE_ODDS_DIR.exists():
        print(f"ERROR: Case-Odds directory not found: {CASE_ODDS_DIR}", file=sys.stderr)
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
            print(f"  Warning: Skipping {filepath.name}: missing case.id", file=sys.stderr)
            continue
        
        # Get image (empty string if not present)
        case_image = case_obj.get("image", "")
        if case_image is None:
            case_image = ""
        
        cases.append({
            "filename": filepath.name,
            "caseId": case_id,
            "displayName": case_obj.get("name") or case_id,
            "caseType": case_obj.get("caseType") or "unknown",
            "caseSchemaVersion": data.get("schemaVersion") or "unknown",
            "requiresKey": compute_requires_key(case_obj.get("caseType")),
            "image": case_image,
        })
    
    return cases


def build_maps(cases, manual_overrides):
    """
    Build cases and aliases mappings with collision detection.
    
    Returns: (cases dict, aliases dict, warnings list)
    """
    # Track which caseIds want each alias (for collision detection)
    alias_sources = {}
    case_potential_aliases = {}
    
    # Build cases lookup (the stable "cases" index)
    cases_map = {}
    for c in cases:
        case_id = c["caseId"]
        cases_map[case_id] = {
            "caseId": case_id,
            "filename": c["filename"],
            "displayName": c["displayName"],
            "caseType": c["caseType"],
            "caseSchemaVersion": c["caseSchemaVersion"],
            "requiresKey": c["requiresKey"],
            "image": c["image"],
        }
        
        # Generate potential aliases (in priority order)
        potential = []
        case_id_lower = case_id.lower()
        
        # 1) Full caseId (always keep)
        potential.append(case_id_lower)
        
        # 2) Filename stem slug (e.g., CS20_Case.json -> cs20-case)
        filename_slug = filename_to_slug(c["filename"])
        if filename_slug and filename_slug != case_id_lower:
            potential.append(filename_slug)
        
        # 3) Short base (remove suffix like -case, -souvenir-package)
        short_base = generate_short_base(case_id)
        if short_base and short_base not in potential:
            potential.append(short_base)
        
        # 4) Compact alias from short base (remove all non-alphanumerics)
        if short_base:
            compact = generate_compact(short_base)
            if compact and compact != short_base and compact not in potential:
                potential.append(compact)
        
        # Store the potential aliases
        case_potential_aliases[case_id] = potential
        
        # Track sources for collision detection
        for alias in potential:
            if alias not in alias_sources:
                alias_sources[alias] = []
            alias_sources[alias].append(case_id)
    
    # Detect collisions (aliases claimed by multiple caseIds)
    collisions = {a for a, sources in alias_sources.items() if len(sources) > 1}
    
    # Build final alias map
    aliases = {}
    warnings = []
    
    for c in cases:
        case_id = c["caseId"]
        case_id_lower = case_id.lower()
        
        for alias in case_potential_aliases[case_id]:
            # If collision and this isn't the full caseId, drop it
            if alias in collisions and alias != case_id_lower:
                others = [x for x in alias_sources[alias] if x != case_id]
                warnings.append(f"Alias '{alias}' collision: {case_id} vs {', '.join(others)}; dropped")
                continue
            
            # Don't overwrite existing alias (first-come wins for derived aliases)
            if alias not in aliases:
                aliases[alias] = {
                    "caseId": case_id,
                    "filename": c["filename"],
                    "displayName": c["displayName"],
                    "requiresKey": c["requiresKey"],
                }
    
    # Merge manual overrides (always win - can overwrite)
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
    
    # Deduplicate warnings
    unique_warnings = list(dict.fromkeys(warnings))
    
    return cases_map, aliases, unique_warnings


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv
    
    print("=" * 60)
    print("TCSGO Case Alias Builder")
    print("=" * 60)
    
    if dry_run:
        print("DRY RUN MODE - No files will be written\n")
    
    # Scan cases
    print(f"Scanning: {CASE_ODDS_DIR}")
    cases = scan_case_odds()
    print(f"   Found {len(cases)} case JSON files")
    
    # Load manual overrides
    manual_overrides = load_manual_overrides()
    if manual_overrides:
        print(f"Loaded {len(manual_overrides)} manual overrides from {MANUAL_FILE.name}")
    
    if not cases:
        print("ERROR: No cases found. Exiting.", file=sys.stderr)
        sys.exit(1)
    
    # Build maps
    print("\nBuilding alias map...")
    cases_map, aliases, warnings = build_maps(cases, manual_overrides)
    print(f"   Generated {len(aliases)} aliases for {len(cases_map)} cases")
    
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings[:10]:
            print(f"   - {w}")
        if len(warnings) > 10:
            print(f"   ... and {len(warnings) - 10} more")
    
    # Build output with deterministic ordering
    output = {
        "schemaVersion": "1.0-case-aliases",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceDir": SOURCE_DIR_NAME,
        "cases": dict(sorted(cases_map.items())),
        "aliases": dict(sorted(aliases.items())),
    }
    
    output_json = json.dumps(output, indent=2, ensure_ascii=False) + "\n"
    
    if dry_run:
        print(f"\nWould write to: {OUTPUT_FILE}")
        print(f"   File size: ~{len(output_json):,} bytes")
        print("\nSample cases:")
        for key in list(cases_map.keys())[:3]:
            e = cases_map[key]
            print(f"   {key}: type={e['caseType']}, key={e['requiresKey']}")
        print("\nSample aliases:")
        for key in list(aliases.keys())[:5]:
            e = aliases[key]
            print(f"   {key} -> {e['caseId']}")
    else:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(output_json)
        print(f"\nWritten to: {OUTPUT_FILE}")
        print(f"   File size: {len(output_json):,} bytes")
    
    # Summary counts
    key_req = sum(1 for c in cases_map.values() if c["requiresKey"])
    no_key = len(cases_map) - key_req
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Cases:   {len(cases_map)}")
    print(f"  Aliases: {len(aliases)}")
    print(f"  Key required: {key_req} | No key: {no_key}")
    print("=" * 60)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
