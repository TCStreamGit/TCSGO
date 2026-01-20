#!/usr/bin/env python3
"""
rename_assets.py - CS:GO/CS2 Asset Renaming and Organization Tool

A deterministic 2-phase tool for scanning, renaming, organizing PNG images
for CS:GO/CS2 cases/souvenir packages, and updating case-export JSON files.

KEY FEATURES:
- Uses item's actual "rarity" field for filenames (mil-spec, restricted, etc.)
- Copies images from collection folders to souvenir package folders
- Copies images from Global/Knives, Global/Gloves, Global/Weapons for missing items
- Creates case folders if they don't exist
- Links Icons folder images to JSON case.icon field
- Handles multiple collections for early souvenirs
"""

import argparse
import csv
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional


# =============================================================================
# CONSTANTS
# =============================================================================

DEFAULT_ROOT = r"A:\Development Environment\Source Control\GitHub\TCSGO"

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

# Doppler phase variants
DOPPLER_PHASES = ["phase-1", "phase-2", "phase-3", "phase-4", "ruby", "sapphire", "black-pearl"]
GAMMA_DOPPLER_PHASES = ["phase-1", "phase-2", "phase-3", "phase-4", "emerald"]

# Map collection names to folder names
COLLECTION_FOLDER_MAP = {
    "the 2018 inferno collection": "The-2018-Inferno-Collection",
    "the 2018 nuke collection": "The-2018-Nuke-Collection",
    "the 2021 dust 2 collection": "The-2021-Dust-2-Collection",
    "the 2021 mirage collection": "The-2021-Mirage-Collection",
    "the 2021 train collection": "The-2021-Train-Collection",
    "the 2021 vertigo collection": "The-2021-Vertigo-Collection",
    "the alpha collection": "The-Alpha-Collection",
    "the ancient collection": "The-Ancient-Collection",
    "the assault collection": "The-Assault-Collection",
    "the aztec collection": "The-Aztec-Collection",
    "the baggage collection": "The-Baggage-Collection",
    "the bank collection": "The-Bank-Collection",
    "the blacksite collection": "The-Blacksite-Collection",
    "the cache collection": "The-Cache-Collection",
    "the canals collection": "The-Canals-Collection",
    "the chop shop collection": "The-Chop-Shop-Collection",
    "the cobblestone collection": "The-Cobblestone-Collection",
    "the control collection": "The-Control-Collection",
    "the dust 2 collection": "The-Dust-2-Collection",
    "the dust collection": "The-Dust-Collection",
    "the gods and monsters collection": "The-Gods-and-Monsters-Collection",
    "the havoc collection": "The-Havoc-Collection",
    "the inferno collection": "The-Inferno-Collection",
    "the italy collection": "The-Italy-Collection",
    "the lake collection": "The-Lake-Collection",
    "the militia collection": "The-Militia-Collection",
    "the mirage collection": "The-Mirage-Collection",
    "the norse collection": "The-Norse-Collection",
    "the nuke collection": "The-Nuke-Collection",
    "the office collection": "The-Office-Collection",
    "the overpass collection": "The-Overpass-Collection",
    "the rising sun collection": "The-Rising-Sun-Collection",
    "the safehouse collection": "The-Safehouse-Collection",
    "the st. marc collection": "The-St.-Marc-Collection",
    "the train collection": "The-Train-Collection",
    "the vertigo collection": "The-Vertigo-Collection",
    "the anubis collection": "The-Anubis-Collection",
}

# Case ID aliases
CASE_ALIAS_MAP = {
    "operation-shattered-web-case": "shattered-web-case",
}

def get_aliased_cases(canonical_case_id: str) -> list:
    return [alias for alias, canonical in CASE_ALIAS_MAP.items() if canonical == canonical_case_id]

PLAN_COLUMNS = [
    "FullPath", "CaseId", "CaseName", "CollectionName", "OriginalFolder", "OriginalName",
    "NewFolder", "NewName", "Rarity", "ItemId", "Category",
    "MatchedBy", "Verified", "Confidence", "Rationale", "Action", "CopiedFrom"
]
RESULTS_COLUMNS = PLAN_COLUMNS + ["Applied", "Error"]
MISSING_COLUMNS = ["CaseId", "Rarity", "ItemId", "DisplayName", "Category", "ResolvedBy", "SourcePath"]


# =============================================================================
# NORMALIZATION FUNCTIONS
# =============================================================================

def normalize_text(text: str) -> str:
    """Normalize text for matching: lowercase, strip punctuation, normalize separators."""
    if not text:
        return ""
    result = text.lower()
    result = result.replace("&", " and ")
    result = result.replace("★", "").replace("|", " ")
    result = re.sub(r'[\[\](){}]', ' ', result)
    result = re.sub(r"[^\w\s\-]", "", result)
    result = re.sub(r'[\s_]+', '-', result)
    result = re.sub(r'-+', '-', result)
    return result.strip('-')


def to_kebab_case(text: str) -> str:
    """Convert text to kebab-case."""
    normalized = normalize_text(text)
    result = re.sub(r'[^a-z0-9\-]', '', normalized)
    return re.sub(r'-+', '-', result).strip('-')


def strip_souvenir_prefix(text: str) -> str:
    """Remove 'souvenir-' or 'Souvenir ' prefix and '-souvenir' suffix."""
    t = text
    if t.lower().startswith("souvenir-"):
        t = t[9:]
    if t.lower().startswith("souvenir "):
        t = t[9:]
    if t.lower().endswith("-souvenir"):
        t = t[:-9]
    return t


def normalize_filename_for_matching(filename: str) -> tuple:
    """Normalize filename for matching. Returns (normalized_name, variant_suffix, is_icon)."""
    name = Path(filename).stem
    
    # Check for --Icon suffix
    is_icon = "--icon" in name.lower()
    if is_icon:
        name = re.sub(r'--[Ii]con$', '', name)
    
    # Extract variant suffix (-001, -002, -01, -02)
    variant_match = re.search(r'-(\d{2,3})$', name)
    variant_suffix = variant_match.group(0) if variant_match else None
    if variant_suffix:
        name = name[:variant_match.start()]
    
    # Handle Chinese/Unicode with English in parentheses
    paren_match = re.search(r'\(([^)]+)\)', name)
    if paren_match:
        english = paren_match.group(1)
        weapon_match = re.match(r'^([A-Za-z0-9\-]+)\s', name)
        if weapon_match:
            name = f"{weapon_match.group(1)} {english}"
    
    # Normalize glove separators and souvenir prefix
    name = name.replace(" - ", " ")
    name = strip_souvenir_prefix(name)
    
    return normalize_text(name), variant_suffix, is_icon


def is_glove(name: str) -> bool:
    name_lower = name.lower()
    return any(t in name_lower for t in GLOVE_TOKENS)


def infer_category(item: dict, context: str = "") -> str:
    cat = item.get("category", "").lower()
    if cat in CATEGORY_FOLDERS:
        return cat
    if is_glove(item.get("itemId", "")) or is_glove(item.get("displayName", "")):
        return "glove"
    if context == "goldPool":
        return "knife"
    return "weapon"


def get_collection_folder(collection_name: str) -> Optional[str]:
    if not collection_name:
        return None
    coll_lower = collection_name.lower().strip()
    return COLLECTION_FOLDER_MAP.get(coll_lower)


def get_first_word_of_skin(skin_name: str) -> str:
    """Get the first word of a skin name for matching truncated global weapon names."""
    if not skin_name:
        return ""
    # Handle common patterns
    parts = skin_name.split()
    if parts:
        return parts[0].lower()
    return ""


# =============================================================================
# JSON HANDLING
# =============================================================================

def find_all_jsons(root: Path) -> list:
    """Find all JSON files with supported schemas."""
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


def extract_items_from_json(data: dict) -> list:
    """Extract items with their actual rarity from item's rarity field."""
    items = []
    schema = data.get("schemaVersion", "")
    case_data = data.get("case", {})
    case_id = case_data.get("id", "")
    case_name = case_data.get("name", "")
    case_type = case_data.get("caseType", "")
    souvenir_info = case_data.get("souvenir", {})
    collection_name = souvenir_info.get("collection", "")
    
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
            item_copy["_caseType"] = case_type
            item_copy["_collectionName"] = collection_name
            item_copy["_schema"] = schema
            item_copy["_isSouvenir"] = is_souvenir
            item_copy["_category"] = infer_category(item, "tiers")
            items.append(item_copy)
    
    # Gold pool (cases only)
    if not is_souvenir:
        gold_pool = case_data.get("goldPool", {})
        for item in gold_pool.get("items", []):
            item_copy = dict(item)
            item_copy["_rarity"] = item.get("rarity", "extraordinary")
            item_copy["_tierKey"] = GOLD_KEY
            item_copy["_context"] = "goldPool"
            item_copy["_caseId"] = case_id
            item_copy["_caseName"] = case_name
            item_copy["_caseType"] = case_type
            item_copy["_collectionName"] = ""
            item_copy["_schema"] = schema
            item_copy["_isSouvenir"] = False
            item_copy["_category"] = infer_category(item, "goldPool")
            items.append(item_copy)
    
    return items


def build_item_index(json_files: list) -> dict:
    """Build comprehensive index of all items."""
    index = {
        "by_case": defaultdict(list),
        "by_collection": defaultdict(list),
        "by_base_item": defaultdict(list),
        "json_paths": {},
        "json_data": {},
        "collection_to_cases": defaultdict(list),
        "case_to_collection": {},
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
        
        souvenir_info = case_data.get("souvenir", {})
        collection_name = souvenir_info.get("collection", "")
        
        index["case_info"][case_id] = {
            "name": case_data.get("name", ""),
            "type": case_data.get("caseType", ""),
            "collection": collection_name,
            "is_souvenir": "souvenir" in case_data.get("caseType", "").lower(),
        }
        
        items = extract_items_from_json(data)
        index["by_case"][case_id].extend(items)
        
        if collection_name and collection_name.lower() != "multiple collections":
            index["collection_to_cases"][collection_name].append(case_id)
            index["case_to_collection"][case_id] = collection_name
            for item in items:
                index["by_collection"][collection_name].append(item)
        
        for item in items:
            item_id = item.get("itemId", "")
            base_normalized = normalize_text(strip_souvenir_prefix(item_id))
            if base_normalized:
                index["by_base_item"][base_normalized].append(item)
            
            weapon = item.get("weapon", "")
            skin = item.get("skin", "")
            if weapon and skin:
                weapon_skin = normalize_text(f"{weapon} {skin}")
                index["by_base_item"][weapon_skin].append(item)
    
    return index


# =============================================================================
# ASSET DISCOVERY
# =============================================================================

def discover_all_folders(cases_root: Path) -> list:
    """Discover all case folders."""
    if not cases_root.exists():
        return []
    folders = []
    for item in sorted(cases_root.iterdir()):
        if item.is_dir() and not item.name.startswith('.') and "_remove" not in item.name:
            folders.append(item)
    return folders


def discover_collection_folders(collections_root: Path) -> list:
    """Discover all collection folders."""
    if not collections_root.exists():
        return []
    folders = []
    for item in sorted(collections_root.iterdir()):
        if item.is_dir() and not item.name.startswith('.'):
            folders.append(item)
    return folders


def discover_png_files(folder: Path) -> list:
    """Find all PNGs in folder (recursive), excluding _remove folders."""
    pngs = []
    for p in folder.rglob("*.png"):
        if "_remove" not in str(p):
            pngs.append(p)
    return sorted(pngs)


def discover_collection_images(collections_root: Path) -> dict:
    """Build index of all images in collection folders."""
    images = {}
    if not collections_root.exists():
        return images
    
    for coll_folder in collections_root.iterdir():
        if not coll_folder.is_dir():
            continue
        for png in coll_folder.rglob("*.png"):
            if "_remove" not in str(png):
                norm_name, _, _ = normalize_filename_for_matching(png.name)
                images[norm_name] = {
                    "path": png,
                    "folder": coll_folder.name,
                    "original_name": png.name
                }
    return images


def discover_global_images(global_root: Path) -> dict:
    """Build index of all images in Global/Knives, Global/Gloves, Global/Weapons folders."""
    images = {
        "knives": {},      # normalized_name -> {path, original_name, all_variants}
        "gloves": {},
        "weapons": {},
        "by_first_word": {},  # weapon + first word of skin -> path (for truncated names)
    }
    
    # Discover knives (organized in subfolders by knife type)
    knives_folder = global_root / "Knives"
    if knives_folder.exists():
        for type_folder in knives_folder.iterdir():
            if not type_folder.is_dir():
                continue
            for png in type_folder.glob("*.png"):
                norm_name, variant, is_icon = normalize_filename_for_matching(png.name)
                if is_icon:
                    continue  # Skip icon versions, prefer full size
                if norm_name not in images["knives"]:
                    images["knives"][norm_name] = {
                        "path": png,
                        "original_name": png.name,
                        "variants": [png]
                    }
                else:
                    images["knives"][norm_name]["variants"].append(png)
    
    # Discover gloves (organized in subfolders by glove type)
    gloves_folder = global_root / "Gloves"
    if gloves_folder.exists():
        for type_folder in gloves_folder.iterdir():
            if not type_folder.is_dir():
                continue
            for png in type_folder.glob("*.png"):
                norm_name, variant, is_icon = normalize_filename_for_matching(png.name)
                if is_icon:
                    continue
                if norm_name not in images["gloves"]:
                    images["gloves"][norm_name] = {
                        "path": png,
                        "original_name": png.name,
                        "variants": [png]
                    }
                else:
                    images["gloves"][norm_name]["variants"].append(png)
    
    # Discover weapons (organized in subfolders by weapon type)
    weapons_folder = global_root / "Weapons"
    if weapons_folder.exists():
        for type_folder in weapons_folder.iterdir():
            if not type_folder.is_dir():
                continue
            weapon_type = to_kebab_case(type_folder.name)
            for png in type_folder.glob("*.png"):
                norm_name, variant, is_icon = normalize_filename_for_matching(png.name)
                if is_icon:
                    continue
                if norm_name not in images["weapons"]:
                    images["weapons"][norm_name] = {
                        "path": png,
                        "original_name": png.name,
                        "variants": [png],
                        "weapon_type": weapon_type
                    }
                else:
                    images["weapons"][norm_name]["variants"].append(png)
                
                # Also index by weapon + first word for truncated matching
                # e.g., "ak-47-aquamarine" should match "ak-47-aquamarine-revenge"
                images["by_first_word"][norm_name] = {
                    "path": png,
                    "original_name": png.name,
                    "weapon_type": weapon_type
                }
    
    return images


def discover_icons(global_root: Path) -> dict:
    """Build index of all icons."""
    icons = {}
    icons_folder = global_root / "Icons"
    if not icons_folder.exists():
        return icons
    
    for png in icons_folder.glob("*.png"):
        name = png.stem
        norm = normalize_text(name)
        icons[norm] = png
    return icons


def map_folder(folder_path: Path, item_index: dict) -> dict:
    """Map a folder to case(s) or collection."""
    folder_name = folder_path.name
    folder_norm = to_kebab_case(folder_name)
    folder_no_hyphen = folder_norm.replace("-", "")
    is_collection_folder = "Collections" in str(folder_path)
    
    result = {
        "folder_path": folder_path,
        "folder_name": folder_name,
        "is_collection": is_collection_folder,
        "matched_cases": [],
        "matched_collection": None,
        "match_type": "none"
    }
    
    if is_collection_folder:
        for coll_name in item_index["by_collection"].keys():
            coll_norm = to_kebab_case(coll_name)
            coll_no_hyphen = coll_norm.replace("-", "")
            
            if coll_norm == folder_norm or coll_no_hyphen == folder_no_hyphen:
                result["matched_collection"] = coll_name
                result["matched_cases"] = item_index["collection_to_cases"].get(coll_name, [])
                result["match_type"] = "collection_direct"
                return result
            
            if folder_norm in coll_norm or coll_norm in folder_norm:
                result["matched_collection"] = coll_name
                result["matched_cases"] = item_index["collection_to_cases"].get(coll_name, [])
                result["match_type"] = "collection_partial"
                return result
    
    # Match against case IDs
    for case_id in item_index["by_case"].keys():
        case_norm = to_kebab_case(case_id)
        case_no_hyphen = case_norm.replace("-", "")
        
        if case_norm == folder_norm or case_no_hyphen == folder_no_hyphen:
            matched = [case_id]
            for aliased_case in get_aliased_cases(case_id):
                if aliased_case in item_index["by_case"]:
                    matched.append(aliased_case)
            result["matched_cases"] = matched
            coll = item_index["case_to_collection"].get(case_id)
            if coll:
                result["matched_collection"] = coll
            result["match_type"] = "case_direct"
            return result
    
    # Partial match for cases
    best_case = None
    best_score = 0
    for case_id in item_index["by_case"].keys():
        case_norm = to_kebab_case(case_id)
        case_no_hyphen = case_norm.replace("-", "")
        
        if folder_norm in case_norm or case_norm in folder_norm:
            score = min(len(folder_norm), len(case_norm))
            if score > best_score:
                best_case = case_id
                best_score = score
        elif folder_no_hyphen in case_no_hyphen or case_no_hyphen in folder_no_hyphen:
            score = min(len(folder_no_hyphen), len(case_no_hyphen)) * 0.9
            if score > best_score:
                best_case = case_id
                best_score = score
    
    if best_case and best_score >= 6:
        matched = [best_case]
        for aliased_case in get_aliased_cases(best_case):
            if aliased_case in item_index["by_case"]:
                matched.append(aliased_case)
        result["matched_cases"] = matched
        coll = item_index["case_to_collection"].get(best_case)
        if coll:
            result["matched_collection"] = coll
        result["match_type"] = "case_partial"
    
    return result


# =============================================================================
# MATCHING LOGIC
# =============================================================================

def match_png_to_item(png_path: Path, folder_mapping: dict, item_index: dict) -> Optional[dict]:
    """Match a PNG to an item."""
    filename = png_path.name
    norm_filename, variant_suffix, _ = normalize_filename_for_matching(filename)
    
    candidates = []
    if folder_mapping["is_collection"] and folder_mapping["matched_collection"]:
        coll = folder_mapping["matched_collection"]
        candidates = item_index["by_collection"].get(coll, [])
    elif folder_mapping["matched_cases"]:
        for case_id in folder_mapping["matched_cases"]:
            candidates.extend(item_index["by_case"].get(case_id, []))
    
    if not candidates:
        return None
    
    best_match = None
    best_confidence = 0
    best_method = "none"
    
    for item in candidates:
        item_id = item.get("itemId", "")
        display_name = item.get("displayName", "")
        weapon = item.get("weapon", "")
        skin = item.get("skin", "")
        
        norm_item_id = normalize_text(strip_souvenir_prefix(item_id))
        norm_display = normalize_text(strip_souvenir_prefix(display_name))
        weapon_skin = normalize_text(f"{weapon} {skin}")
        
        if norm_filename == norm_item_id:
            return {"item": item, "confidence": 100, "method": "exact_itemId", "variant": variant_suffix}
        
        if norm_display and norm_filename == norm_display:
            if best_confidence < 98:
                best_match, best_confidence, best_method = item, 98, "exact_displayName"
        
        if weapon_skin and norm_filename == weapon_skin:
            if best_confidence < 96:
                best_match, best_confidence, best_method = item, 96, "exact_weapon_skin"
        
        if "doppler" in norm_item_id and "doppler" in norm_filename:
            base_id = re.sub(r'-phase-\d+$', '', norm_item_id)
            base_id = re.sub(r'-(ruby|sapphire|black-pearl|emerald)$', '', base_id)
            if norm_filename == base_id and best_confidence < 88:
                best_match, best_confidence, best_method = item, 88, "doppler_base"
        
        if norm_item_id and (norm_item_id in norm_filename or norm_filename in norm_item_id):
            ratio = min(len(norm_item_id), len(norm_filename)) / max(len(norm_item_id), len(norm_filename), 1)
            score = ratio * 82
            if score > best_confidence:
                best_match, best_confidence, best_method = item, score, "partial_itemId"
        
        if weapon_skin and (weapon_skin in norm_filename or norm_filename in weapon_skin):
            ratio = min(len(weapon_skin), len(norm_filename)) / max(len(weapon_skin), len(norm_filename), 1)
            score = ratio * 78
            if score > best_confidence:
                best_match, best_confidence, best_method = item, score, "partial_weapon_skin"
    
    if best_match and best_confidence >= 50:
        return {"item": best_match, "confidence": int(best_confidence), "method": best_method, "variant": variant_suffix}
    
    return None


def match_item_to_collection_image(item: dict, collection_images: dict) -> Optional[dict]:
    """Try to find a collection image for an item."""
    item_id = item.get("itemId", "")
    weapon = item.get("weapon", "")
    skin = item.get("skin", "")
    
    searches = [
        normalize_text(strip_souvenir_prefix(item_id)),
        normalize_text(f"{weapon} {skin}"),
    ]
    
    for search in searches:
        if search and search in collection_images:
            return collection_images[search]
    
    return None


def match_item_to_global_image(item: dict, global_images: dict) -> Optional[dict]:
    """Try to find a global knife, glove, or weapon image for an item."""
    item_id = item.get("itemId", "")
    display_name = item.get("displayName", "")
    weapon = item.get("weapon", "")
    skin = item.get("skin", "")
    category = item.get("_category", "")
    
    # Determine which global folder to search
    if category == "knife":
        search_dict = global_images.get("knives", {})
        source = "global_knives"
    elif category == "glove":
        search_dict = global_images.get("gloves", {})
        source = "global_gloves"
    else:
        search_dict = global_images.get("weapons", {})
        source = "global_weapons"
    
    # Build search terms
    norm_item_id = normalize_text(strip_souvenir_prefix(item_id))
    norm_display = normalize_text(strip_souvenir_prefix(display_name))
    norm_weapon_skin = normalize_text(f"{weapon} {skin}") if weapon and skin else ""
    
    # Handle vanilla items (no skin, just the base item)
    is_vanilla = "vanilla" in norm_item_id or (not skin or skin.lower() in ["vanilla", "none", ""])
    
    # For vanilla items, also try just the weapon name
    weapon_only = normalize_text(weapon) if weapon else ""
    
    # Try exact matches first
    searches = [norm_item_id, norm_display, norm_weapon_skin]
    if is_vanilla and weapon_only:
        searches.append(weapon_only)
    
    for search in searches:
        if search and search in search_dict:
            info = search_dict[search]
            return {
                "path": info["path"],
                "original_name": info["original_name"],
                "source": source
            }
    
    # Try without "vanilla" or "none" suffix
    for search in searches:
        if not search:
            continue
        search_clean = search.replace("-vanilla", "").replace("-none", "")
        search_clean = re.sub(r'-none$', '', search_clean)
        if search_clean and search_clean in search_dict:
            info = search_dict[search_clean]
            return {
                "path": info["path"],
                "original_name": info["original_name"],
                "source": source
            }
    
    # Try matching by first word of skin (files in Global may be truncated)
    # e.g., "m9-bayonet-blue-steel" -> try "m9-bayonet-blue"
    # e.g., "ak-47-aquamarine-revenge" -> try "ak-47-aquamarine"
    if weapon and skin:
        first_word = get_first_word_of_skin(skin)
        if first_word:
            weapon_norm = to_kebab_case(weapon)
            truncated_key = f"{weapon_norm}-{first_word}"
            
            # Try in the category-specific dict first
            if truncated_key in search_dict:
                info = search_dict[truncated_key]
                return {
                    "path": info["path"],
                    "original_name": info["original_name"],
                    "source": source
                }
            
            # Try in the by_first_word dict (for weapons)
            by_first = global_images.get("by_first_word", {})
            if truncated_key in by_first:
                info = by_first[truncated_key]
                return {
                    "path": info["path"],
                    "original_name": info["original_name"],
                    "source": source
                }
    
    # Try partial matching for knives/gloves with slight name variations
    for search in searches:
        if not search:
            continue
        for key, info in search_dict.items():
            # Handle variations like "shadow-daggers-none-vanilla" -> "shadow-daggers-vanilla"
            search_clean = search.replace("-none", "")
            key_clean = key.replace("-none", "")
            if search_clean == key_clean:
                return {
                    "path": info["path"],
                    "original_name": info["original_name"],
                    "source": source
                }
            # Handle "original" vs without original
            if search.replace("-original", "") == key or key.replace("-original", "") == search:
                return {
                    "path": info["path"],
                    "original_name": info["original_name"],
                    "source": source
                }
    
    return None


# =============================================================================
# PLAN GENERATION
# =============================================================================

def make_filename(case_id: str, rarity: str, item_id: str, variant: str = None) -> str:
    """Generate canonical filename."""
    case_k = to_kebab_case(case_id)
    rarity_k = to_kebab_case(rarity)
    item_k = to_kebab_case(strip_souvenir_prefix(item_id))
    
    base = f"{case_k}--{rarity_k}--{item_k}"
    if variant:
        num = re.sub(r'\D', '', variant)
        if num:
            base = f"{base}-{int(num):02d}"
    return f"{base}.png"


def get_category_folder(category: str) -> str:
    return CATEGORY_FOLDERS.get(category.lower(), "Weapons")


def case_id_to_folder_name(case_id: str) -> str:
    """Convert case ID to a folder name format."""
    parts = case_id.split('-')
    return '-'.join(p.capitalize() for p in parts)


class PlanGenerator:
    def __init__(self, root: Path, assets_root: Path, item_index: dict):
        self.root = root
        self.assets_root = assets_root
        self.cases_root = assets_root / "Cases"
        self.collections_root = assets_root / "Collections"
        self.global_root = assets_root / "Global"
        self.item_index = item_index
        self.plan_rows = []
        self.unmatched = []
        self.missing_items = []
        self.used_filenames = defaultdict(set)
        self.matched_items = defaultdict(set)
        self.collection_images = discover_collection_images(self.collections_root)
        self.global_images = discover_global_images(self.global_root)
        self.icons = discover_icons(self.global_root)
        self.remove_counters = defaultdict(int)
        self.folders_to_create = set()
    
    def generate(self):
        """Generate the complete plan."""
        # Process case folders
        case_folders = discover_all_folders(self.cases_root)
        for folder in case_folders:
            mapping = map_folder(folder, self.item_index)
            pngs = discover_png_files(folder)
            for png in pngs:
                self._process_png(png, folder, mapping)
        
        # Process collection folders
        collection_folders = discover_collection_folders(self.collections_root)
        for folder in collection_folders:
            mapping = map_folder(folder, self.item_index)
            mapping["is_collection"] = True
            pngs = discover_png_files(folder)
            for png in pngs:
                self._process_png(png, folder, mapping)
        
        # Phase 2: Generate copy actions for souvenir packages from collection images
        self._generate_souvenir_copies()
        
        # Phase 2.5: Expand Doppler images to all phase variants
        self._expand_doppler_phases()
        
        # Phase 3: Generate copy actions for missing items from global folders
        self._generate_global_copies()
        
        # Phase 4: Find remaining missing items
        self._find_missing()
        
        # Sort for determinism
        self.plan_rows.sort(key=lambda x: (x["Action"], x["FullPath"]))

    def _process_png(self, png: Path, folder: Path, mapping: dict):
        """Process a single PNG file."""
        row = {
            "FullPath": str(png), "CaseId": "None", "CaseName": "None",
            "CollectionName": "None", "OriginalFolder": str(png.parent),
            "OriginalName": png.name, "NewFolder": "None", "NewName": "None",
            "Rarity": "None", "ItemId": "None", "Category": "None",
            "MatchedBy": "None", "Verified": "False", "Confidence": "0",
            "Rationale": "None", "Action": "unmatched", "CopiedFrom": "None"
        }
        
        match = match_png_to_item(png, mapping, self.item_index)
        
        if match:
            item = match["item"]
            case_id = item["_caseId"]
            case_name = item["_caseName"]
            coll_name = item.get("_collectionName", "")
            item_id = item.get("itemId", "")
            rarity = item["_rarity"]
            category = item["_category"]
            
            row["CaseId"] = case_id
            row["CaseName"] = case_name
            row["CollectionName"] = coll_name or "None"
            row["ItemId"] = item_id
            row["Rarity"] = rarity
            row["Category"] = category
            row["MatchedBy"] = match["method"]
            row["Confidence"] = str(match["confidence"])
            row["Verified"] = "True" if match["confidence"] >= 80 else "False"
            row["Rationale"] = f"Matched via {match['method']} ({match['confidence']}%)"
            
            cat_folder = get_category_folder(category)
            new_folder = folder / cat_folder
            new_name = self._resolve_filename(folder.name, case_id, rarity, item_id, match["variant"])
            
            row["NewFolder"] = str(new_folder)
            row["NewName"] = new_name
            
            if png.parent.name == cat_folder and png.name == new_name:
                row["Action"] = "skip"
            elif png.parent.name != cat_folder:
                row["Action"] = "move+rename"
            else:
                row["Action"] = "rename"
            
            norm_item = normalize_text(strip_souvenir_prefix(item_id))
            self.matched_items[case_id].add(norm_item)
        else:
            remove_folder = folder.parent / f"{folder.name}_remove"
            self.remove_counters[folder.name] += 1
            counter = self.remove_counters[folder.name]
            new_name = f"remove-{counter:03d}--{to_kebab_case(png.stem)}.png"
            
            row["NewFolder"] = str(remove_folder)
            row["NewName"] = new_name
            row["Action"] = "remove"
            row["Rationale"] = f"No match (folder: {mapping['match_type']})"
            
            self.unmatched.append({
                "FullPath": str(png), "Reason": "No match",
                "FolderMatchType": mapping["match_type"],
                "MatchedCases": ",".join(mapping["matched_cases"]) or "None"
            })
        
        self.plan_rows.append(row)


    def _generate_souvenir_copies(self):
        """Generate copy actions for souvenir packages from collection images."""
        for case_id, case_info in self.item_index["case_info"].items():
            if not case_info["is_souvenir"]:
                continue
            
            case_name = case_info["name"]
            items = self.item_index["by_case"].get(case_id, [])
            matched = self.matched_items.get(case_id, set())
            target_folder = self._find_or_create_case_folder(case_id)
            
            for item in items:
                item_id = item.get("itemId", "")
                norm_item = normalize_text(strip_souvenir_prefix(item_id))
                
                if norm_item in matched:
                    continue
                
                img_info = match_item_to_collection_image(item, self.collection_images)
                
                if img_info:
                    rarity = item["_rarity"]
                    category = item["_category"]
                    cat_folder = get_category_folder(category)
                    new_folder = target_folder / cat_folder
                    new_name = self._resolve_filename(target_folder.name, case_id, rarity, item_id, None)
                    
                    row = {
                        "FullPath": "COPY",
                        "CaseId": case_id, "CaseName": case_name,
                        "CollectionName": img_info["folder"],
                        "OriginalFolder": str(img_info["path"].parent),
                        "OriginalName": img_info["original_name"],
                        "NewFolder": str(new_folder), "NewName": new_name,
                        "Rarity": rarity, "ItemId": item_id,
                        "Category": category, "MatchedBy": "collection_copy",
                        "Verified": "True", "Confidence": "100",
                        "Rationale": f"Copied from {img_info['folder']}",
                        "Action": "copy", "CopiedFrom": str(img_info["path"])
                    }
                    self.plan_rows.append(row)
                    self.matched_items[case_id].add(norm_item)
                    self.folders_to_create.add(target_folder)

    def _generate_global_copies(self):
        """Generate copy actions for missing knives/gloves/weapons from global folders."""
        for case_id, items in self.item_index["by_case"].items():
            matched = self.matched_items.get(case_id, set())
            case_info = self.item_index["case_info"].get(case_id, {})
            case_name = case_info.get("name", "")
            target_folder = self._find_or_create_case_folder(case_id)
            
            for item in items:
                item_id = item.get("itemId", "")
                category = item.get("_category", "")
                norm_item = normalize_text(strip_souvenir_prefix(item_id))
                
                if norm_item in matched:
                    continue
                
                # Try to find this item in global images (knives, gloves, or weapons)
                img_info = match_item_to_global_image(item, self.global_images)
                
                if img_info:
                    rarity = item["_rarity"]
                    cat_folder = get_category_folder(category)
                    new_folder = target_folder / cat_folder
                    new_name = self._resolve_filename(target_folder.name, case_id, rarity, item_id, None)
                    
                    row = {
                        "FullPath": "COPY",
                        "CaseId": case_id, "CaseName": case_name,
                        "CollectionName": "None",
                        "OriginalFolder": str(img_info["path"].parent),
                        "OriginalName": img_info["original_name"],
                        "NewFolder": str(new_folder), "NewName": new_name,
                        "Rarity": rarity, "ItemId": item_id,
                        "Category": category, "MatchedBy": f"{img_info['source']}_copy",
                        "Verified": "True", "Confidence": "100",
                        "Rationale": f"Copied from {img_info['source']}",
                        "Action": "copy", "CopiedFrom": str(img_info["path"])
                    }
                    self.plan_rows.append(row)
                    self.matched_items[case_id].add(norm_item)
                    self.folders_to_create.add(target_folder)

    def _expand_doppler_phases(self):
        """Expand Doppler images to cover all phase variants."""
        doppler_sources = {}
        
        for row in self.plan_rows:
            if row["Action"] in ["skip", "unmatched", "remove"]:
                continue
            
            item_id = row.get("ItemId", "")
            if not item_id or "doppler" not in item_id.lower():
                continue
            
            case_id = row.get("CaseId", "")
            if not case_id:
                continue
            
            is_gamma_doppler = "gamma-doppler" in item_id.lower()
            base_item = item_id
            matched_phase = None
            
            if item_id.endswith("-none"):
                base_item = item_id[:-len("-none")]
                matched_phase = "none"
            elif is_gamma_doppler:
                for phase in GAMMA_DOPPLER_PHASES:
                    if item_id.endswith(f"-{phase}"):
                        base_item = item_id[:-len(f"-{phase}")]
                        matched_phase = phase
                        break
            else:
                for phase in DOPPLER_PHASES:
                    if item_id.endswith(f"-{phase}"):
                        base_item = item_id[:-len(f"-{phase}")]
                        matched_phase = phase
                        break
            
            if not matched_phase:
                continue
            
            key = (case_id, base_item)
            if key not in doppler_sources:
                doppler_sources[key] = {}
            
            source_path = row.get("CopiedFrom") if row["Action"] == "copy" else row.get("FullPath")
            doppler_sources[key][matched_phase] = {
                "source_path": source_path,
                "case_name": row.get("CaseName", ""),
                "rarity": row.get("Rarity", ""),
                "category": row.get("Category", ""),
                "new_folder": row.get("NewFolder", ""),
            }
        
        for (case_id, base_item), phases_found in doppler_sources.items():
            is_gamma = "gamma-doppler" in base_item
            all_phases = GAMMA_DOPPLER_PHASES if is_gamma else DOPPLER_PHASES
            
            source_phase = None
            source_info = None
            
            if "none" in phases_found:
                source_phase = "none"
                source_info = phases_found["none"]
            else:
                for phase in all_phases:
                    if phase in phases_found:
                        source_phase = phase
                        source_info = phases_found[phase]
                        break
            
            if not source_info:
                continue
            
            case_items = self.item_index["by_case"].get(case_id, [])
            
            for phase in all_phases:
                if phase in phases_found:
                    continue
                
                phase_item_id = f"{base_item}-{phase}"
                
                matching_item = None
                for item in case_items:
                    if item.get("itemId", "") == phase_item_id:
                        matching_item = item
                        break
                
                if not matching_item:
                    continue
                
                norm_item = normalize_text(strip_souvenir_prefix(phase_item_id))
                if norm_item in self.matched_items.get(case_id, set()):
                    continue
                
                rarity = matching_item.get("_rarity", source_info["rarity"])
                category = matching_item.get("_category", source_info["category"])
                new_folder = source_info["new_folder"]
                new_name = self._resolve_filename(
                    Path(new_folder).parent.name, case_id, rarity, phase_item_id, None
                )
                
                row = {
                    "FullPath": "COPY",
                    "CaseId": case_id,
                    "CaseName": source_info["case_name"],
                    "CollectionName": "None",
                    "OriginalFolder": str(Path(source_info["source_path"]).parent) if source_info["source_path"] else "None",
                    "OriginalName": Path(source_info["source_path"]).name if source_info["source_path"] else "None",
                    "NewFolder": new_folder,
                    "NewName": new_name,
                    "Rarity": rarity,
                    "ItemId": phase_item_id,
                    "Category": category,
                    "MatchedBy": "doppler_phase_expansion",
                    "Verified": "True",
                    "Confidence": "95",
                    "Rationale": f"Expanded from {source_phase} image",
                    "Action": "copy",
                    "CopiedFrom": source_info["source_path"] or "None"
                }
                self.plan_rows.append(row)
                self.matched_items[case_id].add(norm_item)


    def _find_or_create_case_folder(self, case_id: str) -> Path:
        """Find existing folder for case or determine new folder path."""
        case_norm = to_kebab_case(case_id)
        case_no_hyphen = case_norm.replace("-", "")
        
        if self.cases_root.exists():
            for item in self.cases_root.iterdir():
                if not item.is_dir():
                    continue
                folder_norm = to_kebab_case(item.name)
                folder_no_hyphen = folder_norm.replace("-", "")
                
                if folder_norm == case_norm or folder_no_hyphen == case_no_hyphen:
                    return item
                if case_norm in folder_norm or folder_norm in case_norm:
                    return item
        
        folder_name = case_id_to_folder_name(case_id)
        return self.cases_root / folder_name

    def _find_missing(self):
        """Find expected items without images."""
        for case_id, items in self.item_index["by_case"].items():
            matched = self.matched_items.get(case_id, set())
            
            canonical_case = CASE_ALIAS_MAP.get(case_id)
            if canonical_case:
                canonical_matched = self.matched_items.get(canonical_case, set())
                matched = matched.union(canonical_matched)
            
            for item in items:
                item_id = item.get("itemId", "")
                norm_item = normalize_text(strip_souvenir_prefix(item_id))
                
                if norm_item not in matched:
                    self.missing_items.append({
                        "CaseId": case_id,
                        "Rarity": item.get("_rarity", "None"),
                        "ItemId": item_id,
                        "DisplayName": item.get("displayName", "None"),
                        "Category": item.get("_category", "None"),
                        "ResolvedBy": "None",
                        "SourcePath": "None"
                    })
    
    def _resolve_filename(self, container: str, case_id: str, rarity: str, item_id: str, variant: str) -> str:
        """Resolve filename, handling duplicates."""
        base = make_filename(case_id, rarity, item_id, None)
        
        if variant:
            var_name = make_filename(case_id, rarity, item_id, variant)
            if var_name not in self.used_filenames[container]:
                self.used_filenames[container].add(var_name)
                return var_name
        
        if base not in self.used_filenames[container]:
            self.used_filenames[container].add(base)
            return base
        
        counter = 1
        while True:
            suf_name = make_filename(case_id, rarity, item_id, f"-{counter:02d}")
            if suf_name not in self.used_filenames[container]:
                self.used_filenames[container].add(suf_name)
                return suf_name
            counter += 1
    
    def get_icon_mappings(self) -> dict:
        """Get mappings of case_id -> icon relative path."""
        mappings = {}
        for case_id in self.item_index["by_case"].keys():
            case_info = self.item_index["case_info"].get(case_id, {})
            case_name = case_info.get("name", "")
            
            case_norm = normalize_text(case_name)
            if case_norm in self.icons:
                icon_path = self.icons[case_norm]
                try:
                    rel = icon_path.relative_to(self.root)
                    mappings[case_id] = str(rel).replace("\\", "/")
                except ValueError:
                    pass
        return mappings


# =============================================================================
# PLAN EXECUTION
# =============================================================================

class PlanExecutor:
    def __init__(self, root: Path, assets_root: Path, plan_path: Path, item_index: dict, icon_mappings: dict):
        self.root = root
        self.assets_root = assets_root
        self.plan_path = plan_path
        self.item_index = item_index
        self.icon_mappings = icon_mappings
        self.results = []
    
    def execute(self):
        rows = self._load_plan()
        
        folders_created = set()
        for row in rows:
            if row["Action"] in ["copy", "move+rename"]:
                folder = Path(row["NewFolder"])
                if folder not in folders_created and not folder.exists():
                    folder.mkdir(parents=True, exist_ok=True)
                    folders_created.add(folder)
        
        for row in rows:
            result = dict(row)
            result["Applied"] = "False"
            result["Error"] = "None"
            
            try:
                action = row["Action"]
                
                if action == "skip":
                    result["Applied"] = "True"
                elif action == "rename":
                    self._do_rename(row)
                    result["Applied"] = "True"
                elif action == "move+rename":
                    self._do_move(row)
                    result["Applied"] = "True"
                elif action == "remove":
                    self._do_move(row)
                    result["Applied"] = "True"
                elif action == "copy":
                    self._do_copy(row)
                    result["Applied"] = "True"
                elif action == "unmatched":
                    result["Applied"] = "True"
            except Exception as e:
                result["Error"] = str(e)
            
            self.results.append(result)
        
        self._patch_jsons()
    
    def _load_plan(self) -> list:
        rows = []
        with open(self.plan_path, 'r', encoding='utf-8', newline='') as f:
            for row in csv.DictReader(f):
                rows.append(row)
        return rows
    
    def _do_rename(self, row):
        src = Path(row["FullPath"])
        dst = src.parent / row["NewName"]
        if dst.exists():
            raise FileExistsError(f"Target exists: {dst}")
        src.rename(dst)
    
    def _do_move(self, row):
        src = Path(row["FullPath"])
        dst_folder = Path(row["NewFolder"])
        dst = dst_folder / row["NewName"]
        if dst.exists():
            raise FileExistsError(f"Target exists: {dst}")
        dst_folder.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
    
    def _do_copy(self, row):
        src = Path(row["CopiedFrom"])
        dst_folder = Path(row["NewFolder"])
        dst = dst_folder / row["NewName"]
        if dst.exists():
            raise FileExistsError(f"Target exists: {dst}")
        dst_folder.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(src), str(dst))

    def _patch_jsons(self):
        """Patch JSONs with icon and image paths."""
        image_map = defaultdict(dict)
        
        for row in self.results:
            if row["Applied"] != "True" or row["Action"] in ["unmatched", "remove"]:
                continue
            
            case_id = row["CaseId"]
            item_id = row["ItemId"]
            if case_id == "None" or item_id == "None":
                continue
            
            norm = normalize_text(strip_souvenir_prefix(item_id))
            new_folder = row["NewFolder"]
            new_name = row["NewName"]
            
            if new_folder != "None" and new_name != "None":
                full_path = Path(new_folder) / new_name
                try:
                    rel = full_path.relative_to(self.root)
                    image_map[case_id][norm] = str(rel).replace("\\", "/")
                except ValueError:
                    pass
        
        for case_id, json_path in self.item_index["json_paths"].items():
            data = self.item_index["json_data"].get(case_id)
            if not data:
                continue
            
            case_images = image_map.get(case_id, {})
            modified = False
            case_data = data.get("case", {})
            
            if case_id in self.icon_mappings:
                icon_path = self.icon_mappings[case_id]
                if case_data.get("icon") != icon_path:
                    case_data["icon"] = icon_path
                    modified = True
            
            schema = data.get("schemaVersion", "")
            is_souv = "souvenir" in case_data.get("caseType", "").lower() or schema == SCHEMA_CONTAINER_EXPORT
            tier_keys = COLLECTION_TIER_KEYS if is_souv else CASE_TIER_KEYS
            
            tiers = case_data.get("tiers", {})
            for tk in tier_keys:
                for item in tiers.get(tk, []):
                    iid = item.get("itemId", "")
                    norm = normalize_text(strip_souvenir_prefix(iid))
                    if norm in case_images:
                        item["image"] = case_images[norm]
                        modified = True
                    elif "image" not in item:
                        item["image"] = "None"
                        modified = True
            
            if not is_souv:
                gold = case_data.get("goldPool", {})
                for item in gold.get("items", []):
                    iid = item.get("itemId", "")
                    norm = normalize_text(strip_souvenir_prefix(iid))
                    if norm in case_images:
                        item["image"] = case_images[norm]
                        modified = True
                    elif "image" not in item:
                        item["image"] = "None"
                        modified = True
            
            if modified:
                ordered_case = {}
                if "icon" in case_data:
                    ordered_case["icon"] = case_data.pop("icon")
                ordered_case.update(case_data)
                data["case"] = ordered_case
                
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)


# =============================================================================
# REPORTS
# =============================================================================

def write_plan_csv(path: Path, rows: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=PLAN_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def write_results_csv(path: Path, rows: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=RESULTS_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def write_unmatched_txt(path: Path, unmatched: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        for u in unmatched:
            f.write(f"{u['FullPath']} | {u['Reason']} | {u['FolderMatchType']} | {u['MatchedCases']}\n")


def write_missing_csv(path: Path, missing: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=MISSING_COLUMNS)
        w.writeheader()
        w.writerows(missing)


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="CS:GO/CS2 Asset Renaming Tool")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="Repository root")
    parser.add_argument("--assets-root", default=None, help="Assets root (default: <root>/Assets)")
    parser.add_argument("--reports-dir", default=None, help="Reports dir (default: <root>/tools/reports)")
    parser.add_argument("--plan-path", default=None, help="Plan file path")
    parser.add_argument("--plan-only", action="store_true", help="Generate plan only")
    parser.add_argument("--apply", action="store_true", help="Execute plan")
    args = parser.parse_args()
    
    root = Path(args.root)
    assets_root = Path(args.assets_root) if args.assets_root else root / "Assets"
    reports_dir = Path(args.reports_dir) if args.reports_dir else root / "tools" / "reports"
    plan_path = Path(args.plan_path) if args.plan_path else reports_dir / "rename-plan.csv"
    
    if not args.plan_only and not args.apply:
        args.plan_only = True
    
    if not root.exists():
        print(f"ERROR: Root not found: {root}")
        return
    
    if args.apply and not plan_path.exists():
        print(f"ERROR: Plan not found: {plan_path}")
        return
    
    print(f"Scanning JSONs in: {root}")
    jsons = find_all_jsons(root)
    print(f"Found {len(jsons)} JSON files")
    
    print("Building item index...")
    item_index = build_item_index(jsons)
    total_items = sum(len(v) for v in item_index["by_case"].values())
    print(f"Indexed {len(item_index['by_case'])} cases with {total_items} items")
    print(f"Found {len(item_index['by_collection'])} collections used by souvenirs")

    if args.plan_only:
        print(f"\nGenerating plan from: {assets_root}")
        gen = PlanGenerator(root, assets_root, item_index)
        gen.generate()
        
        icon_mappings = gen.get_icon_mappings()
        print(f"Found {len(icon_mappings)} icon mappings")
        
        # Print global image stats
        print(f"\nGlobal images discovered:")
        print(f"  Knives: {len(gen.global_images.get('knives', {}))} unique items")
        print(f"  Gloves: {len(gen.global_images.get('gloves', {}))} unique items")
        print(f"  Weapons: {len(gen.global_images.get('weapons', {}))} unique items")
        print(f"  By first word: {len(gen.global_images.get('by_first_word', {}))} entries")
        
        print(f"\nWriting reports to: {reports_dir}")
        write_plan_csv(plan_path, gen.plan_rows)
        print(f"  Plan: {plan_path} ({len(gen.plan_rows)} rows)")
        
        unmatched_path = reports_dir / "unmatched-files.txt"
        write_unmatched_txt(unmatched_path, gen.unmatched)
        print(f"  Unmatched: {unmatched_path} ({len(gen.unmatched)} files)")
        
        missing_path = reports_dir / "missing-expected-items.csv"
        write_missing_csv(missing_path, gen.missing_items)
        print(f"  Missing: {missing_path} ({len(gen.missing_items)} items)")
        
        icons_path = reports_dir / "icon-mappings.txt"
        with open(icons_path, 'w', encoding='utf-8') as f:
            for cid, path in sorted(icon_mappings.items()):
                f.write(f"{cid} -> {path}\n")
        print(f"  Icons: {icons_path} ({len(icon_mappings)} mappings)")
        
        # Summary
        actions = defaultdict(int)
        for r in gen.plan_rows:
            actions[r["Action"]] += 1
        
        print("\nPlan Summary:")
        for a, c in sorted(actions.items()):
            print(f"  {a}: {c}")
        
        print(f"\nFolders to create for copies: {len(gen.folders_to_create)}")
        for f in sorted(gen.folders_to_create)[:10]:
            print(f"  {f.name}")
        if len(gen.folders_to_create) > 10:
            print(f"  ... and {len(gen.folders_to_create) - 10} more")
        
        print("\nRun with --apply to execute.")
    
    elif args.apply:
        print(f"\nExecuting plan: {plan_path}")
        
        gen = PlanGenerator(root, assets_root, item_index)
        gen.generate()
        icon_mappings = gen.get_icon_mappings()
        
        exe = PlanExecutor(root, assets_root, plan_path, item_index, icon_mappings)
        exe.execute()
        
        results_path = reports_dir / "rename-results.csv"
        write_results_csv(results_path, exe.results)
        print(f"Results: {results_path}")
        
        applied = sum(1 for r in exe.results if r["Applied"] == "True")
        errors = sum(1 for r in exe.results if r["Error"] != "None")
        
        print(f"\nApplied: {applied}, Errors: {errors}")
        
        if errors > 0:
            print("\nErrors:")
            for r in exe.results:
                if r["Error"] != "None":
                    print(f"  {r['OriginalName']}: {r['Error']}")


if __name__ == "__main__":
    main()
