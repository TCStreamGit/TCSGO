#!/usr/bin/env python3
"""
rename_assets.py - CS:GO/CS2 Asset Organization Tool (v2.2 - Aspect Ratio Fix + Case Icons)

Generates a comprehensive plan for organizing assets from Global into case folders.
NEVER deletes images - only copies.

WORKFLOW:
1. --plan-only: Scan and generate reports for review
2. --apply: Execute the plan (copy files, update JSONs)

REPORTS GENERATED:
- rename-plan.csv: Complete plan of all copies with variations
- unmatched-global.csv: Global images that don't match any JSON item
- missing-items.csv: JSON items without matching Global images
- global-assets-index.txt: Full index of Global folder contents

CHANGES IN v2.2:
- Fixed aspect ratio preservation during resize (no more squished images)
- Added case icon linking (copies icon from Global/Icons to case folder)
- Updates JSON with both item images and case image
"""

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Image processing
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("WARNING: Pillow not installed. Images will be copied without resizing.")
    print("         Install with: pip install Pillow")


# =============================================================================
# CONSTANTS
# =============================================================================

# DEFAULT_ROOT = r"A:\Development Environment\Source Control\GitHub\TCSGO"

DEFAULT_ROOT = r"A:\Development\Version Control\Github\TCSGO"

# Maximum dimension for any side of the image (maintains aspect ratio)
MAX_IMAGE_DIMENSION = 512

SCHEMA_CASE_EXPORT = "3.0-case-export"
SCHEMA_CONTAINER_EXPORT = "3.1-container-export"
SUPPORTED_SCHEMAS = [SCHEMA_CASE_EXPORT, SCHEMA_CONTAINER_EXPORT]

CASE_TIER_KEYS = ["blue", "purple", "pink", "red"]
COLLECTION_TIER_KEYS = ["consumer", "industrial", "milspec", "restricted", "classified", "covert"]
GOLD_KEY = "gold"

CATEGORY_FOLDERS = {
    "weapon": "Weapons", "knife": "Knives", "glove": "Gloves",
    "rifle": "Weapons", "smg": "Weapons", "pistol": "Weapons",
    "shotgun": "Weapons", "machinegun": "Weapons", "sniper": "Weapons",
    "weapon_skin": "Weapons",
}

GLOVE_TOKENS = [
    "bloodhound gloves", "driver gloves", "hand wraps", "hydra gloves",
    "moto gloves", "specialist gloves", "sport gloves", "broken fang gloves",
]

# IMPORTANT: M9 Bayonet and Bayonet are SEPARATE!
# Longer prefixes MUST come first for correct parsing
WEAPON_PREFIXES = [
    # Knives (specific first)
    "m9-bayonet",  # MUST be before "bayonet"
    "bayonet",
    "bowie-knife", "butterfly-knife", "classic-knife", "falchion-knife",
    "flip-knife", "gut-knife", "huntsman-knife", "karambit", "kukri-knife",
    "navaja-knife", "nomad-knife", "paracord-knife", "shadow-daggers",
    "skeleton-knife", "stiletto-knife", "survival-knife", "talon-knife", "ursus-knife",
    # Gloves
    "bloodhound-gloves", "broken-fang-gloves", "driver-gloves", "hand-wraps",
    "hydra-gloves", "moto-gloves", "specialist-gloves", "sport-gloves",
    # Weapons
    "ak-47", "m4a4", "m4a1-s", "awp", "usp-s", "glock-18", "desert-eagle",
    "p250", "p2000", "five-seven", "tec-9", "cz75-auto", "dual-berettas",
    "r8-revolver", "mp9", "mac-10", "mp7", "mp5-sd", "ump-45", "p90",
    "pp-bizon", "famas", "galil-ar", "aug", "sg-553", "ssg-08", "scar-20",
    "g3sg1", "nova", "xm1014", "mag-7", "sawed-off", "m249", "negev", "zeus-x27",
]

# Skin name variations: JSON name -> file name (normalized)
# When JSON says X, but the file is named Y
SKIN_ALIASES = {
    "neon-queen": "neoqueen",
}


# =============================================================================
# NORMALIZATION
# =============================================================================

def normalize_text(text: str) -> str:
    """Normalize text for matching."""
    if not text:
        return ""
    result = text.lower()
    result = result.replace("&", " and ")
    result = result.replace("★", "").replace("|", " ")
    result = re.sub(r'[\[\](){}]', ' ', result)
    # Remove non-ASCII characters (Chinese, etc.)
    result = re.sub(r'[^\x00-\x7F]+', '-', result)
    result = re.sub(r"[^\w\s\-]", "", result)
    result = re.sub(r'[\s_]+', '-', result)
    result = re.sub(r'-+', '-', result)
    return result.strip('-')


def to_kebab_case(text: str) -> str:
    normalized = normalize_text(text)
    result = re.sub(r'[^a-z0-9\-]', '', normalized)
    return re.sub(r'-+', '-', result).strip('-')


def strip_souvenir_prefix(text: str) -> str:
    t = text
    if t.lower().startswith("souvenir-"):
        t = t[9:]
    if t.lower().startswith("souvenir "):
        t = t[9:]
    if t.lower().endswith("-souvenir"):
        t = t[:-9]
    return t


def parse_global_filename(filename: str) -> Dict:
    """Parse a Global folder filename into components."""
    stem = Path(filename).stem
    original_stem = stem
    
    # Check for --Icon suffix
    is_icon = "--icon" in stem.lower()
    if is_icon:
        stem = re.sub(r'--[Ii]con$', '', stem)
    
    # Extract variation suffix (--01, -001, -01, -1, etc.)
    variation = None
    var_match = re.search(r'[-–](\d{1,3})$', stem)
    if var_match:
        variation = var_match.group(1).zfill(2)  # Normalize to 2 digits
        stem = stem[:var_match.start()]
    
    base_normalized = normalize_text(stem)
    
    # Extract weapon and skin using prefixes
    weapon = ""
    skin = ""
    for prefix in WEAPON_PREFIXES:
        if base_normalized.startswith(prefix + "-"):
            weapon = prefix
            skin = base_normalized[len(prefix) + 1:]
            break
        elif base_normalized == prefix:
            weapon = prefix
            break
    
    if not weapon:
        weapon = base_normalized
    
    return {
        "base_name": base_normalized,
        "weapon": weapon,
        "skin": skin,
        "variation": variation,
        "is_icon": is_icon,
        "original_stem": original_stem,
    }


def is_glove(name: str) -> bool:
    return any(t in name.lower() for t in GLOVE_TOKENS)


def infer_category(item: dict, context: str = "") -> str:
    cat = item.get("category", "").lower()
    if cat in CATEGORY_FOLDERS:
        return cat
    if is_glove(item.get("itemId", "")) or is_glove(item.get("displayName", "")):
        return "glove"
    if context == "goldPool":
        return "knife"
    return "weapon"


def get_category_folder(category: str) -> str:
    return CATEGORY_FOLDERS.get(category.lower(), "Weapons")


# =============================================================================
# IMAGE UTILITIES
# =============================================================================

def get_file_hash(filepath: Path) -> str:
    """MD5 hash for duplicate detection (short form)."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hasher.update(chunk)
    return hasher.hexdigest()[:12]


def get_image_dimensions(filepath: Path) -> Tuple[int, int]:
    if not PIL_AVAILABLE:
        return (0, 0)
    try:
        with Image.open(filepath) as img:
            return img.size
    except:
        return (0, 0)


def get_quality_score(filepath: Path) -> int:
    """Quality score = width * height (higher = better)."""
    w, h = get_image_dimensions(filepath)
    return w * h


def resize_and_copy(src: Path, dst: Path, max_dimension: int = MAX_IMAGE_DIMENSION) -> bool:
    """
    Copy and optionally resize image while PRESERVING ASPECT RATIO.
    
    Images are scaled so that the largest dimension does not exceed max_dimension.
    Original files are NEVER modified - only copies are made.
    
    Args:
        src: Source image path
        dst: Destination path
        max_dimension: Maximum size for the largest dimension (default 512)
    
    Returns:
        True if successful, False otherwise
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    
    if not PIL_AVAILABLE:
        shutil.copy2(str(src), str(dst))
        return True
    
    try:
        with Image.open(src) as img:
            # Preserve transparency if present
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                img = img.convert('RGBA')
            else:
                img = img.convert('RGB')
            
            orig_width, orig_height = img.size
            
            # Check if resize is needed (only if either dimension exceeds max)
            if orig_width > max_dimension or orig_height > max_dimension:
                # Calculate scale factor to fit within max_dimension while preserving aspect ratio
                scale = min(max_dimension / orig_width, max_dimension / orig_height)
                new_width = int(orig_width * scale)
                new_height = int(orig_height * scale)
                
                # Use LANCZOS for high-quality downscaling
                resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            else:
                # Image is already within bounds, no resize needed
                resized = img
            
            resized.save(dst, 'PNG', optimize=True)
            return True
            
    except Exception as e:
        print(f"  Warning: Failed to process {src.name}: {e}")
        # Fall back to simple copy
        try:
            shutil.copy2(str(src), str(dst))
            return True
        except:
            return False


# =============================================================================
# JSON HANDLING
# =============================================================================

def find_all_jsons(root: Path) -> List[Path]:
    json_files = []
    for json_path in root.rglob("*.json"):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if data.get("schemaVersion") in SUPPORTED_SCHEMAS:
                json_files.append(json_path)
        except:
            continue
    return sorted(json_files)


def load_json(path: Path) -> Optional[dict]:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return None


def extract_items_from_json(data: dict) -> List[dict]:
    items = []
    schema = data.get("schemaVersion", "")
    case_data = data.get("case", {})
    case_id = case_data.get("id", "")
    case_name = case_data.get("name", "")
    case_type = case_data.get("caseType", "")
    
    is_souvenir = "souvenir" in case_type.lower() or schema == SCHEMA_CONTAINER_EXPORT
    tier_keys = COLLECTION_TIER_KEYS if is_souvenir else CASE_TIER_KEYS
    
    tiers = case_data.get("tiers", {})
    for tier_key in tier_keys:
        for item in tiers.get(tier_key, []):
            item_copy = dict(item)
            item_copy["_rarity"] = item.get("rarity", tier_key)
            item_copy["_tierKey"] = tier_key
            item_copy["_context"] = "tiers"
            item_copy["_caseId"] = case_id
            item_copy["_caseName"] = case_name
            item_copy["_category"] = infer_category(item, "tiers")
            items.append(item_copy)
    
    if not is_souvenir:
        gold_pool = case_data.get("goldPool", {})
        for item in gold_pool.get("items", []):
            item_copy = dict(item)
            item_copy["_rarity"] = item.get("rarity", "extraordinary")
            item_copy["_tierKey"] = GOLD_KEY
            item_copy["_context"] = "goldPool"
            item_copy["_caseId"] = case_id
            item_copy["_caseName"] = case_name
            item_copy["_category"] = infer_category(item, "goldPool")
            items.append(item_copy)
    
    return items


def build_item_index(json_files: List[Path]) -> dict:
    index = {
        "by_case": defaultdict(list),
        "all_items": [],
        "json_paths": {},
        "json_data": {},
        "case_info": {},
    }
    
    for json_path in json_files:
        data = load_json(json_path)
        if not data:
            continue
        
        case_data = data.get("case", {})
        case_id = case_data.get("id", "")
        if not case_id:
            continue
        
        index["json_paths"][case_id] = json_path
        index["json_data"][case_id] = data
        index["case_info"][case_id] = {
            "name": case_data.get("name", ""),
            "type": case_data.get("caseType", ""),
        }
        
        items = extract_items_from_json(data)
        index["by_case"][case_id].extend(items)
        index["all_items"].extend(items)
    
    return index


# =============================================================================
# GLOBAL ASSET DISCOVERY
# =============================================================================

def discover_global_assets(global_root: Path) -> dict:
    """Discover all images in Global folder, grouped by base item name."""
    assets = {
        "by_base_name": {},  # base_name -> {variations: [...], weapon, skin, category}
        "icons": {},         # normalized_name -> path
        "all_files": [],     # Flat list of all files for unmatched tracking
    }
    
    def process_folder(folder: Path, category: str):
        if not folder.exists():
            return
        for type_folder in folder.iterdir():
            if not type_folder.is_dir():
                continue
            for png in type_folder.glob("*.png"):
                add_global_file(assets, png, category, type_folder.name)
    
    process_folder(global_root / "Knives", "knife")
    process_folder(global_root / "Gloves", "glove")
    process_folder(global_root / "Weapons", "weapon")
    
    # Icons folder - these are case icons
    icons_folder = global_root / "Icons"
    if icons_folder.exists():
        for png in icons_folder.glob("*.png"):
            name_norm = normalize_text(png.stem)
            assets["icons"][name_norm] = png
    
    # Deduplicate by hash and sort by quality
    dedupe_and_sort(assets)
    
    return assets


def add_global_file(assets: dict, png_path: Path, category: str, type_folder: str):
    """Add a single image file to the index."""
    parsed = parse_global_filename(png_path.name)
    base_name = parsed["base_name"]
    
    quality = get_quality_score(png_path)
    file_hash = get_file_hash(png_path)
    dims = get_image_dimensions(png_path)
    
    file_info = {
        "path": png_path,
        "filename": png_path.name,
        "type_folder": type_folder,
        "base_name": base_name,
        "weapon": parsed["weapon"],
        "skin": parsed["skin"],
        "variation": parsed["variation"],
        "is_icon": parsed["is_icon"],
        "quality": quality,
        "dimensions": dims,
        "hash": file_hash,
        "category": category,
        "matched_to": [],  # Will track which items this matched to
    }
    
    assets["all_files"].append(file_info)
    
    # Group by base_name
    if base_name not in assets["by_base_name"]:
        assets["by_base_name"][base_name] = {
            "variations": [],
            "weapon": parsed["weapon"],
            "skin": parsed["skin"],
            "category": category,
        }
    
    assets["by_base_name"][base_name]["variations"].append(file_info)


def dedupe_and_sort(assets: dict):
    """Remove true duplicates (same hash), sort by quality, mark main."""
    for base_name, entry in assets["by_base_name"].items():
        # Dedupe by hash - keep highest quality of duplicates
        seen_hashes = {}
        unique = []
        for var in entry["variations"]:
            h = var["hash"]
            if h not in seen_hashes:
                seen_hashes[h] = var
                unique.append(var)
            elif var["quality"] > seen_hashes[h]["quality"]:
                unique.remove(seen_hashes[h])
                unique.append(var)
                seen_hashes[h] = var
        
        # Sort: non-icons first, then by quality descending
        non_icons = sorted([v for v in unique if not v["is_icon"]], key=lambda x: -x["quality"])
        icons_list = sorted([v for v in unique if v["is_icon"]], key=lambda x: -x["quality"])
        all_sorted = non_icons + icons_list
        
        # Mark main and index
        for i, var in enumerate(all_sorted):
            var["is_main"] = (i == 0)
            var["var_index"] = i
        
        entry["variations"] = all_sorted
        entry["variation_count"] = len(all_sorted)


# =============================================================================
# CASE ICON MATCHING
# =============================================================================

def find_case_icon(case_id: str, case_name: str, icons: dict) -> Optional[Path]:
    """
    Find a matching icon for a case from Global/Icons folder.
    
    Tries multiple matching strategies:
    1. Exact case ID match
    2. Case name match
    3. Partial match (case ID contains icon name or vice versa)
    """
    case_id_norm = normalize_text(case_id)
    case_name_norm = normalize_text(case_name)
    
    # Strategy 1: Exact match on case ID
    if case_id_norm in icons:
        return icons[case_id_norm]
    
    # Strategy 2: Exact match on case name
    if case_name_norm in icons:
        return icons[case_name_norm]
    
    # Strategy 3: Partial matching
    for icon_name, icon_path in icons.items():
        # Check if case ID contains icon name or vice versa
        if icon_name in case_id_norm or case_id_norm in icon_name:
            return icon_path
        if icon_name in case_name_norm or case_name_norm in icon_name:
            return icon_path
    
    # Strategy 4: Remove common suffixes and try again
    # e.g., "operation-bravo-case" -> "operation-bravo"
    for suffix in ["-case", "-collection", "-package", "-capsule"]:
        if case_id_norm.endswith(suffix):
            stripped = case_id_norm[:-len(suffix)]
            if stripped in icons:
                return icons[stripped]
            # Also check partial
            for icon_name, icon_path in icons.items():
                if icon_name in stripped or stripped in icon_name:
                    return icon_path
    
    return None


# =============================================================================
# MATCHING ENGINE
# =============================================================================

def build_search_keys(item: dict) -> List[str]:
    """Build search keys for an item, ordered by preference."""
    keys = []
    
    item_id = item.get("itemId", "")
    display_name = item.get("displayName", "")
    weapon = item.get("weapon", "")
    skin = item.get("skin", "")
    
    # Primary: normalized item ID without souvenir prefix
    if item_id:
        keys.append(normalize_text(strip_souvenir_prefix(item_id)))
    
    # Secondary: weapon + skin from JSON
    if weapon and skin:
        keys.append(normalize_text(f"{weapon} {skin}"))
    
    # Tertiary: display name
    if display_name:
        keys.append(normalize_text(strip_souvenir_prefix(display_name)))
    
    # Also try without vanilla/none suffixes
    clean_keys = []
    for k in keys:
        clean = k.replace("-vanilla", "").replace("-none", "").rstrip("-")
        if clean and clean not in keys and clean not in clean_keys:
            clean_keys.append(clean)
    keys.extend(clean_keys)
    
    # Apply skin aliases (e.g., neon-queen -> neoqueen)
    aliased_keys = []
    for k in keys:
        for alias_from, alias_to in SKIN_ALIASES.items():
            if alias_from in k:
                aliased = k.replace(alias_from, alias_to)
                if aliased not in keys and aliased not in aliased_keys:
                    aliased_keys.append(aliased)
    keys.extend(aliased_keys)
    
    return [k for k in keys if k]  # Filter empty


# Doppler phase suffixes to strip when matching
DOPPLER_PHASES = [
    "-sapphire", "-ruby", "-black-pearl", "-emerald",
    "-phase-1", "-phase-2", "-phase-3", "-phase-4",
    "-none"
]

# Numbered skin suffixes (e.g., mag-7-swag-7 -> mag-7-swag)
NUMBERED_SKIN_PATTERNS = [
    (r'-(\d+)$', ''),  # Remove trailing number
]


def strip_doppler_phase(name: str) -> str:
    """Remove Doppler phase suffix from item name."""
    result = name
    for phase in DOPPLER_PHASES:
        if result.endswith(phase):
            result = result[:-len(phase)]
            break
    return result


def strip_trailing_number(name: str) -> str:
    """Remove trailing numbers like -7, -18, -36 from skin names."""
    # Common patterns: mag-7-swag-7, glock-18-block-18, famas-meow-36
    match = re.match(r'^(.+?)-(\d+)$', name)
    if match:
        base = match.group(1)
        # Make sure we're not stripping actual weapon numbers like ak-47
        # Check if the base still has the weapon prefix
        if any(base.startswith(wp) or base == wp for wp in WEAPON_PREFIXES):
            return base
    return name


def match_item_to_global(item: dict, global_assets: dict) -> Optional[Tuple[str, dict, str]]:
    """
    Match a JSON item to a Global asset entry.
    Returns (base_name, entry, match_method) or None.
    """
    by_base = global_assets["by_base_name"]
    search_keys = build_search_keys(item)
    
    # 1. Exact match
    for key in search_keys:
        if key in by_base:
            return (key, by_base[key], "exact")
    
    # 2. Doppler phase matching - strip phase suffix and try again
    for key in search_keys:
        stripped = strip_doppler_phase(key)
        if stripped != key and stripped in by_base:
            return (stripped, by_base[stripped], "doppler-phase")
    
    # 3. Gamma Doppler matching (e.g., karambit-gamma-doppler-phase-3 -> karambit-gamma-doppler)
    for key in search_keys:
        if "gamma-doppler" in key:
            stripped = strip_doppler_phase(key)
            if stripped in by_base:
                return (stripped, by_base[stripped], "gamma-doppler")
    
    # 4. Numbered skin matching (mag-7-swag-7 -> mag-7-swag)
    for key in search_keys:
        stripped = strip_trailing_number(key)
        if stripped != key and stripped in by_base:
            return (stripped, by_base[stripped], "numbered-skin")
    
    # 5. "Original" -> "Vanilla" mapping for knives
    for key in search_keys:
        if key.endswith("-original"):
            vanilla_key = key.replace("-original", "-vanilla")
            if vanilla_key in by_base:
                return (vanilla_key, by_base[vanilla_key], "original-to-vanilla")
    
    # 6. Truncated match (weapon + first word of skin)
    weapon = item.get("weapon", "")
    skin = item.get("skin", "")
    if weapon and skin:
        weapon_norm = to_kebab_case(weapon)
        skin_words = to_kebab_case(skin).split("-")
        if skin_words:
            truncated = f"{weapon_norm}-{skin_words[0]}"
            if truncated in by_base:
                return (truncated, by_base[truncated], "truncated")
    
    # 7. Partial match (more lenient)
    for key in search_keys:
        for base_name, entry in by_base.items():
            # Check if one is a prefix of the other
            if key.startswith(base_name) or base_name.startswith(key):
                return (base_name, entry, "prefix")
            # Check containment with reasonable ratio
            if key in base_name or base_name in key:
                ratio = min(len(key), len(base_name)) / max(len(key), len(base_name))
                if ratio > 0.55:  # Lowered threshold
                    return (base_name, entry, "partial")
    
    return None


# =============================================================================
# PLAN GENERATOR
# =============================================================================

def make_dest_filename(case_id: str, rarity: str, item_id: str, var_index: int = 0) -> str:
    """Generate canonical destination filename."""
    case_k = to_kebab_case(case_id)
    rarity_k = to_kebab_case(rarity)
    item_k = to_kebab_case(strip_souvenir_prefix(item_id))
    
    base = f"{case_k}--{rarity_k}--{item_k}"
    if var_index > 0:
        base = f"{base}--{var_index+1:02d}"  # --02, --03, etc. (main has no suffix)
    return f"{base}.png"


def case_id_to_folder(case_id: str) -> str:
    """Convert case ID to folder name (Title-Case)."""
    parts = case_id.split('-')
    return '-'.join(p.capitalize() for p in parts)


class PlanGenerator:
    """Generates matching plan and all reports."""
    
    def __init__(self, root: Path, assets_root: Path, item_index: dict, global_assets: dict):
        self.root = root
        self.assets_root = assets_root
        self.cases_root = assets_root / "Cases"
        self.item_index = item_index
        self.global_assets = global_assets
        
        # Results
        self.plan_rows = []
        self.missing_items = []
        self.matched_bases = set()
        self.case_icons = {}  # case_id -> (source_path, dest_path)
        
    def generate(self):
        """Generate the complete plan."""
        print("\nMatching JSON items to Global assets...")
        
        total_items = 0
        matched_items = 0
        
        for case_id, items in self.item_index["by_case"].items():
            case_info = self.item_index["case_info"].get(case_id, {})
            case_name = case_info.get("name", case_id)
            
            # Find case icon
            icon_path = find_case_icon(case_id, case_name, self.global_assets["icons"])
            if icon_path:
                folder_name = case_id_to_folder(case_id)
                dest_icon = self.cases_root / folder_name / "Icons" / f"{to_kebab_case(case_id)}--icon.png"
                self.case_icons[case_id] = (icon_path, dest_icon)
            
            for item in items:
                total_items += 1
                if self._process_item(item, case_id, case_name):
                    matched_items += 1
        
        print(f"  Items processed: {total_items}")
        print(f"  Items matched: {matched_items}")
        print(f"  Items missing: {len(self.missing_items)}")
        print(f"  Case icons found: {len(self.case_icons)}")
        
        # Sort results
        self.plan_rows.sort(key=lambda x: (x["CaseId"], x["ItemId"], x["VarIndex"]))
        self.missing_items.sort(key=lambda x: (x["CaseId"], x["ItemId"]))
    
    def _process_item(self, item: dict, case_id: str, case_name: str) -> bool:
        """Process a single JSON item. Returns True if matched."""
        item_id = item.get("itemId", "")
        display_name = item.get("displayName", "")
        rarity = item.get("_rarity", "")
        category = item.get("_category", "")
        weapon = item.get("weapon", "")
        skin = item.get("skin", "")
        
        match_result = match_item_to_global(item, self.global_assets)
        
        if match_result is None:
            self.missing_items.append({
                "CaseId": case_id,
                "CaseName": case_name,
                "ItemId": item_id,
                "DisplayName": display_name,
                "Rarity": rarity,
                "Category": category,
                "Weapon": weapon,
                "Skin": skin,
            })
            return False
        
        base_name, entry, match_method = match_result
        self.matched_bases.add(base_name)
        
        # Track that these files matched
        for var in entry["variations"]:
            var["matched_to"].append(f"{case_id}:{item_id}")
        
        # Destination folder
        folder_name = case_id_to_folder(case_id)
        cat_folder = get_category_folder(category)
        dest_folder = self.cases_root / folder_name / cat_folder
        
        # Create plan rows for ALL variations
        for var in entry["variations"]:
            dest_filename = make_dest_filename(case_id, rarity, item_id, var["var_index"])
            
            self.plan_rows.append({
                "Action": "copy",
                "SourcePath": str(var["path"]),
                "SourceFile": var["filename"],
                "DestFolder": str(dest_folder),
                "DestFile": dest_filename,
                "CaseId": case_id,
                "CaseName": case_name,
                "ItemId": item_id,
                "DisplayName": display_name,
                "Rarity": rarity,
                "Category": category,
                "IsMain": "Yes" if var["is_main"] else "No",
                "VarIndex": var["var_index"],
                "VarTotal": entry["variation_count"],
                "Quality": var["quality"],
                "Dimensions": f"{var['dimensions'][0]}x{var['dimensions'][1]}",
                "Hash": var["hash"],
                "MatchMethod": match_method,
                "GlobalBaseName": base_name,
            })
        
        return True
    
    def get_unmatched_files(self) -> List[dict]:
        """Get Global files that weren't matched to any JSON item."""
        unmatched = []
        for file_info in self.global_assets["all_files"]:
            if not file_info["matched_to"]:
                unmatched.append({
                    "SourcePath": str(file_info["path"]),
                    "Filename": file_info["filename"],
                    "TypeFolder": file_info["type_folder"],
                    "BaseName": file_info["base_name"],
                    "Weapon": file_info["weapon"],
                    "Skin": file_info["skin"],
                    "Category": file_info["category"],
                    "Quality": file_info["quality"],
                    "Dimensions": f"{file_info['dimensions'][0]}x{file_info['dimensions'][1]}",
                    "Variation": file_info["variation"] or "",
                    "IsIcon": "Yes" if file_info["is_icon"] else "No",
                })
        return sorted(unmatched, key=lambda x: x["BaseName"])


# =============================================================================
# REPORT WRITERS
# =============================================================================

def write_plan_csv(path: Path, plan_rows: List[dict]):
    """Write the main plan CSV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not plan_rows:
        path.write_text("No plan rows generated.\n")
        return
    
    fieldnames = list(plan_rows[0].keys())
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(plan_rows)


def write_missing_csv(path: Path, missing: List[dict]):
    """Write missing items CSV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not missing:
        path.write_text("No missing items! All JSON items have matching Global images.\n")
        return
    
    fieldnames = list(missing[0].keys())
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(missing)


def write_unmatched_csv(path: Path, unmatched: List[dict]):
    """Write unmatched Global files CSV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not unmatched:
        path.write_text("No unmatched files! All Global images matched to JSON items.\n")
        return
    
    fieldnames = list(unmatched[0].keys())
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(unmatched)


def write_global_index(path: Path, global_assets: dict):
    """Write full index of Global assets."""
    path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(path, 'w', encoding='utf-8') as f:
        by_base = global_assets["by_base_name"]
        
        f.write("=" * 70 + "\n")
        f.write("GLOBAL ASSETS INDEX\n")
        f.write("=" * 70 + "\n\n")
        
        # Summary
        f.write(f"Total unique items: {len(by_base)}\n")
        f.write(f"Total icons: {len(global_assets['icons'])}\n")
        f.write(f"Total image files: {len(global_assets['all_files'])}\n\n")
        
        # By category
        cats = defaultdict(int)
        for entry in by_base.values():
            cats[entry["category"]] += 1
        
        f.write("By category:\n")
        for cat, count in sorted(cats.items()):
            f.write(f"  {cat}: {count}\n")
        
        # List icons
        f.write(f"\n{'='*70}\n")
        f.write(f"CASE ICONS ({len(global_assets['icons'])} icons)\n")
        f.write(f"{'='*70}\n\n")
        
        for icon_name, icon_path in sorted(global_assets["icons"].items()):
            f.write(f"  {icon_name}: {icon_path.name}\n")
        
        # Items with multiple variations
        multi_var = [(name, entry) for name, entry in by_base.items() 
                     if entry["variation_count"] > 1]
        
        f.write(f"\n{'='*70}\n")
        f.write(f"ITEMS WITH MULTIPLE VARIATIONS ({len(multi_var)} items)\n")
        f.write(f"{'='*70}\n\n")
        
        for base_name, entry in sorted(multi_var):
            f.write(f"{base_name}: {entry['variation_count']} variations\n")
            for var in entry["variations"]:
                main_tag = " [MAIN]" if var["is_main"] else ""
                dims = f"{var['dimensions'][0]}x{var['dimensions'][1]}"
                f.write(f"  - {var['filename']} ({dims}, q={var['quality']}){main_tag}\n")
            f.write("\n")


# =============================================================================
# APPLY PLAN
# =============================================================================

def apply_plan(plan_rows: List[dict], item_index: dict, root: Path, case_icons: dict):
    """Execute the plan - copy files and update JSONs."""
    print("\n" + "=" * 60)
    print("APPLYING PLAN")
    print("=" * 60)
    
    # Group by case for JSON updates
    by_case = defaultdict(list)
    for row in plan_rows:
        by_case[row["CaseId"]].append(row)
    
    copied = 0
    errors = 0
    
    # Copy item images
    print("\nCopying item images...")
    for row in plan_rows:
        src = Path(row["SourcePath"])
        dest = Path(row["DestFolder"]) / row["DestFile"]
        
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            success = resize_and_copy(src, dest)
            if success:
                copied += 1
            else:
                errors += 1
        except Exception as e:
            print(f"  ERROR copying {src.name}: {e}")
            errors += 1
    
    print(f"  Item images copied: {copied}")
    print(f"  Errors: {errors}")
    
    # Copy case icons
    print("\nCopying case icons...")
    icons_copied = 0
    for case_id, (src_path, dest_path) in case_icons.items():
        try:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            success = resize_and_copy(src_path, dest_path)
            if success:
                icons_copied += 1
        except Exception as e:
            print(f"  ERROR copying icon for {case_id}: {e}")
    
    print(f"  Case icons copied: {icons_copied}")
    
    # Update JSONs
    print("\nUpdating JSON files...")
    updated_jsons = 0
    
    for case_id, rows in by_case.items():
        json_path = item_index["json_paths"].get(case_id)
        if not json_path:
            continue
        
        data = item_index["json_data"].get(case_id)
        if not data:
            continue
        
        # Build image map: item_id -> {main: path, alternates: [paths]}
        image_map = defaultdict(lambda: {"main": None, "alternates": []})
        
        for row in rows:
            item_id = row["ItemId"]
            dest_path = Path(row["DestFolder"]) / row["DestFile"]
            
            try:
                rel_path = dest_path.relative_to(root)
                rel_str = str(rel_path).replace("\\", "/")
            except ValueError:
                rel_str = str(dest_path)
            
            if row["IsMain"] == "Yes":
                image_map[item_id]["main"] = rel_str
            else:
                image_map[item_id]["alternates"].append(rel_str)
        
        # Apply to JSON
        case_data = data.get("case", {})
        schema = data.get("schemaVersion", "")
        is_souv = "souvenir" in case_data.get("caseType", "").lower() or schema == SCHEMA_CONTAINER_EXPORT
        tier_keys = COLLECTION_TIER_KEYS if is_souv else CASE_TIER_KEYS
        
        modified = False
        
        # Update case icon in JSON
        if case_id in case_icons:
            _, dest_icon_path = case_icons[case_id]
            try:
                rel_icon = dest_icon_path.relative_to(root)
                rel_icon_str = str(rel_icon).replace("\\", "/")
                case_data["image"] = rel_icon_str
                modified = True
            except ValueError:
                pass
        
        # Update item images
        tiers = case_data.get("tiers", {})
        for tk in tier_keys:
            for item in tiers.get(tk, []):
                iid = item.get("itemId", "")
                if iid in image_map:
                    imgs = image_map[iid]
                    if imgs["main"]:
                        item["image"] = imgs["main"]
                        modified = True
                    if imgs["alternates"]:
                        item["imageAlternates"] = imgs["alternates"]
                        modified = True
        
        if not is_souv:
            gold = case_data.get("goldPool", {})
            for item in gold.get("items", []):
                iid = item.get("itemId", "")
                if iid in image_map:
                    imgs = image_map[iid]
                    if imgs["main"]:
                        item["image"] = imgs["main"]
                        modified = True
                    if imgs["alternates"]:
                        item["imageAlternates"] = imgs["alternates"]
                        modified = True
        
        if modified:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            updated_jsons += 1
    
    print(f"JSONs updated: {updated_jsons}")
    print("\nApply complete!")


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="CS:GO/CS2 Asset Organization Tool v2.2",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python rename_assets.py --plan-only     # Generate plan and reports
  python rename_assets.py --apply         # Execute the plan
        """
    )
    parser.add_argument("--root", default=DEFAULT_ROOT, help="Repository root")
    parser.add_argument("--plan-only", action="store_true", help="Generate plan and reports only")
    parser.add_argument("--apply", action="store_true", help="Execute the plan (copies files)")
    args = parser.parse_args()
    
    # Default to plan-only if nothing specified
    if not args.plan_only and not args.apply:
        args.plan_only = True
    
    root = Path(args.root)
    assets_root = root / "Assets"
    reports_dir = root / "tools" / "reports"
    
    if not root.exists():
        print(f"ERROR: Root not found: {root}")
        return
    
    print("=" * 70)
    print("CS:GO/CS2 Asset Organization Tool v2.2")
    print("=" * 70)
    print(f"Root: {root}")
    print(f"Mode: {'Plan Only' if args.plan_only else 'APPLY'}")
    
    if not PIL_AVAILABLE:
        print("\nWARNING: Pillow not installed. Images copied without resizing.")
        print("         Install with: pip install Pillow\n")
    
    # 1. Scan JSONs
    print("\nScanning JSON files...")
    jsons = find_all_jsons(root)
    print(f"  Found {len(jsons)} JSON files")
    
    # 2. Build item index
    print("Building item index...")
    item_index = build_item_index(jsons)
    total_items = len(item_index["all_items"])
    print(f"  Indexed {len(item_index['by_case'])} cases with {total_items} items")
    
    # 3. Discover Global assets
    print("\nDiscovering Global assets...")
    global_root = assets_root / "Global"
    global_assets = discover_global_assets(global_root)
    
    by_base = global_assets["by_base_name"]
    total_files = len(global_assets["all_files"])
    multi_var = sum(1 for e in by_base.values() if e["variation_count"] > 1)
    
    print(f"  Unique items: {len(by_base)}")
    print(f"  Total image files: {total_files}")
    print(f"  Items with multiple variations: {multi_var}")
    print(f"  Case icons in Global/Icons: {len(global_assets['icons'])}")
    
    # 4. Generate plan
    planner = PlanGenerator(root, assets_root, item_index, global_assets)
    planner.generate()
    
    unmatched_files = planner.get_unmatched_files()
    
    # 5. Write reports
    reports_dir.mkdir(parents=True, exist_ok=True)
    
    plan_path = reports_dir / "rename-plan.csv"
    write_plan_csv(plan_path, planner.plan_rows)
    print(f"\nPlan written to: {plan_path}")
    print(f"  Total copy operations: {len(planner.plan_rows)}")
    
    missing_path = reports_dir / "missing-items.csv"
    write_missing_csv(missing_path, planner.missing_items)
    print(f"\nMissing items written to: {missing_path}")
    print(f"  Missing items: {len(planner.missing_items)}")
    
    unmatched_path = reports_dir / "unmatched-global.csv"
    write_unmatched_csv(unmatched_path, unmatched_files)
    print(f"\nUnmatched Global files written to: {unmatched_path}")
    print(f"  Unmatched files: {len(unmatched_files)}")
    
    index_path = reports_dir / "global-assets-index.txt"
    write_global_index(index_path, global_assets)
    print(f"\nGlobal index written to: {index_path}")
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  JSON items: {total_items}")
    print(f"  Global unique items: {len(by_base)}")
    print(f"  Global image files: {total_files}")
    print(f"  Matched items: {total_items - len(planner.missing_items)}")
    print(f"  Missing items: {len(planner.missing_items)}")
    print(f"  Unmatched Global files: {len(unmatched_files)}")
    print(f"  Case icons found: {len(planner.case_icons)}")
    print(f"  Planned item copies: {len(planner.plan_rows)}")
    
    if args.plan_only:
        print("\n" + "=" * 70)
        print("PLAN GENERATED - Review reports, then run with --apply to execute")
        print("=" * 70)
    elif args.apply:
        apply_plan(planner.plan_rows, item_index, root, planner.case_icons)


if __name__ == "__main__":
    main()
