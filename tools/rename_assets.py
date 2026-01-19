#!/usr/bin/env python3
"""
rename_assets.py - CS:GO/CS2 Asset Renaming and Organization Tool

A deterministic 2-phase tool for scanning, renaming, organizing PNG images
for CS:GO/CS2 cases/souvenir packages, and updating case-export JSON files.

KEY CONCEPTS:
- Uses item's actual "rarity" field for filenames (mil-spec, restricted, etc.)
- Souvenirs reference collections; images from collection folders are copied to each souvenir folder
- Each souvenir package gets its own copy of collection images
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

# Tier keys in JSONs (these are bucket names, NOT the rarity values for filenames)
CASE_TIER_KEYS = ["blue", "purple", "pink", "red"]
COLLECTION_TIER_KEYS = ["consumer", "industrial", "milspec", "restricted", "classified", "covert"]
GOLD_KEY = "gold"

CATEGORY_FOLDERS = {
    "weapon": "Weapons", "knife": "Knives", "glove": "Gloves",
    "rifle": "Weapons", "smg": "Weapons", "pistol": "Weapons",
    "shotgun": "Weapons", "machinegun": "Weapons", "sniper": "Weapons",
}

GLOVE_TOKENS = [
    "bloodhound gloves", "driver gloves", "hand wraps", "hydra gloves",
    "moto gloves", "specialist gloves", "sport gloves", "broken fang gloves",
]

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


def normalize_rarity_for_filename(rarity: str) -> str:
    """Normalize rarity for use in filename."""
    r = rarity.lower().strip()
    # Keep the actual rarity names as-is (mil-spec, restricted, classified, covert, extraordinary)
    # Also handle consumer, industrial, milspec for collections
    return r.replace("_", "-")


def strip_souvenir_prefix(text: str) -> str:
    """Remove 'souvenir-' or 'Souvenir ' prefix."""
    if text.lower().startswith("souvenir-"):
        return text[9:]
    if text.lower().startswith("souvenir "):
        return text[9:]
    return text


def normalize_filename_for_matching(filename: str) -> tuple:
    """Normalize filename for matching. Returns (normalized_name, variant_suffix)."""
    name = Path(filename).stem
    
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
    
    return normalize_text(name), variant_suffix


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
    
    # Determine tier keys based on type
    is_souvenir = "souvenir" in case_type.lower() or schema == SCHEMA_CONTAINER_EXPORT
    tier_keys = COLLECTION_TIER_KEYS if is_souvenir else CASE_TIER_KEYS
    
    tiers = case_data.get("tiers", {})
    for tier_key in tier_keys:
        for item in tiers.get(tier_key, []):
            item_copy = dict(item)
            # USE THE ITEM'S ACTUAL RARITY FIELD - this is the key fix
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
        "by_item_normalized": defaultdict(list),
        "by_base_item": defaultdict(list),  # weapon+skin without souvenir prefix
        "json_paths": {},
        "json_data": {},
        "collection_to_cases": defaultdict(list),
        "case_to_collection": {},
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
        
        items = extract_items_from_json(data)
        index["by_case"][case_id].extend(items)
        
        # Track collection relationships
        souvenir_info = case_data.get("souvenir", {})
        collection_name = souvenir_info.get("collection", "")
        if collection_name:
            index["collection_to_cases"][collection_name].append(case_id)
            index["case_to_collection"][case_id] = collection_name
            for item in items:
                index["by_collection"][collection_name].append(item)
        
        for item in items:
            item_id = item.get("itemId", "")
            normalized = normalize_text(item_id)
            if normalized:
                index["by_item_normalized"][normalized].append(item)
            
            # Also index by base item (without souvenir prefix) for cross-matching
            base_normalized = normalize_text(strip_souvenir_prefix(item_id))
            if base_normalized:
                index["by_base_item"][base_normalized].append(item)
            
            # Index by weapon+skin combo
            weapon = item.get("weapon", "")
            skin = item.get("skin", "")
            if weapon and skin:
                weapon_skin = normalize_text(f"{weapon} {skin}")
                index["by_base_item"][weapon_skin].append(item)
    
    return index


# =============================================================================
# ASSET DISCOVERY
# =============================================================================

def discover_all_folders(assets_root: Path) -> list:
    """Discover all asset container folders including Collections subfolders."""
    if not assets_root.exists():
        return []
    
    folders = []
    for item in sorted(assets_root.iterdir()):
        if item.is_dir() and not item.name.startswith('.') and "_remove" not in item.name:
            if item.name == "Collections":
                # Add each collection subfolder
                for sub in sorted(item.iterdir()):
                    if sub.is_dir():
                        folders.append(sub)
            else:
                folders.append(item)
    return folders


def discover_png_files(folder: Path) -> list:
    """Find all PNGs in folder (recursive), excluding _remove folders."""
    pngs = []
    for p in folder.rglob("*.png"):
        if "_remove" not in str(p):
            pngs.append(p)
    return sorted(pngs)


def map_folder(folder_path: Path, item_index: dict) -> dict:
    """Map a folder to case(s) or collection. Returns mapping info."""
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
        # Match against collection names
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
            result["matched_cases"] = [case_id]
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
        result["matched_cases"] = [best_case]
        coll = item_index["case_to_collection"].get(best_case)
        if coll:
            result["matched_collection"] = coll
        result["match_type"] = "case_partial"
    
    return result


# =============================================================================
# MATCHING LOGIC
# =============================================================================

def match_png_to_item(png_path: Path, folder_mapping: dict, item_index: dict) -> Optional[dict]:
    """Match a PNG to an item. Works for both case folders and collection folders."""
    filename = png_path.name
    norm_filename, variant_suffix = normalize_filename_for_matching(filename)
    
    # Get candidate items based on folder mapping
    candidates = []
    
    if folder_mapping["is_collection"] and folder_mapping["matched_collection"]:
        # Collection folder: get items from all cases using this collection
        coll = folder_mapping["matched_collection"]
        candidates = item_index["by_collection"].get(coll, [])
    elif folder_mapping["matched_cases"]:
        # Case folder: get items from the matched case
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
        
        # Normalize item identifiers, stripping souvenir prefix
        norm_item_id = normalize_text(strip_souvenir_prefix(item_id))
        norm_display = normalize_text(strip_souvenir_prefix(display_name))
        weapon_skin = normalize_text(f"{weapon} {skin}")
        
        # Exact matches
        if norm_filename == norm_item_id:
            return {"item": item, "confidence": 100, "method": "exact_itemId", "variant": variant_suffix}
        
        if norm_display and norm_filename == norm_display:
            if best_confidence < 98:
                best_match, best_confidence, best_method = item, 98, "exact_displayName"
        
        if weapon_skin and norm_filename == weapon_skin:
            if best_confidence < 96:
                best_match, best_confidence, best_method = item, 96, "exact_weapon_skin"
        
        # Doppler handling
        if "doppler" in norm_item_id and "doppler" in norm_filename:
            base_id = re.sub(r'-phase-\d+$', '', norm_item_id)
            base_id = re.sub(r'-(ruby|sapphire|black-pearl|emerald)$', '', base_id)
            if norm_filename == base_id and best_confidence < 88:
                best_match, best_confidence, best_method = item, 88, "doppler_base"
        
        # Partial matches
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


class PlanGenerator:
    def __init__(self, root: Path, assets_root: Path, item_index: dict):
        self.root = root
        self.assets_root = assets_root
        self.item_index = item_index
        self.plan_rows = []
        self.unmatched = []
        self.missing_items = []
        self.used_filenames = defaultdict(set)  # container -> set of filenames
        self.matched_items = defaultdict(set)   # case_id -> set of norm_item_ids
        self.collection_images = defaultdict(dict)  # collection -> {norm_item_id -> png_info}
        self.remove_counters = defaultdict(int)
    
    def generate(self):
        """Generate the complete plan."""
        folders = discover_all_folders(self.assets_root)
        
        # Phase 1: Process all folders and match PNGs
        for folder in folders:
            mapping = map_folder(folder, self.item_index)
            pngs = discover_png_files(folder)
            
            for png in pngs:
                self._process_png(png, folder, mapping)
        
        # Phase 2: For collection folders, generate copy actions for souvenir packages
        self._generate_souvenir_copies()
        
        # Phase 3: Find missing items
        self._find_missing()
        
        # Sort for determinism
        self.plan_rows.sort(key=lambda x: x["FullPath"])

    def _process_png(self, png: Path, folder: Path, mapping: dict):
        """Process a single PNG file."""
        row = {
            "FullPath": str(png),
            "CaseId": "None", "CaseName": "None", "CollectionName": "None",
            "OriginalFolder": str(png.parent), "OriginalName": png.name,
            "NewFolder": "None", "NewName": "None",
            "Rarity": "None", "ItemId": "None", "Category": "None",
            "MatchedBy": "None", "Verified": "False", "Confidence": "0",
            "Rationale": "None", "Action": "unmatched", "CopiedFrom": "None"
        }
        
        match = match_png_to_item(png, mapping, self.item_index)
        
        if match:
            item = match["item"]
            confidence = match["confidence"]
            method = match["method"]
            variant = match["variant"]
            
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
            row["MatchedBy"] = method
            row["Confidence"] = str(confidence)
            row["Verified"] = "True" if confidence >= 80 else "False"
            row["Rationale"] = f"Matched via {method} ({confidence}%)"
            
            # Determine new location
            cat_folder = get_category_folder(category)
            new_folder = folder / cat_folder
            new_name = self._resolve_filename(folder.name, case_id, rarity, item_id, variant)
            
            row["NewFolder"] = str(new_folder)
            row["NewName"] = new_name
            
            # Determine action
            if png.parent.name == cat_folder and png.name == new_name:
                row["Action"] = "skip"
            elif png.parent.name != cat_folder:
                row["Action"] = "move+rename"
            else:
                row["Action"] = "rename"
            
            # Track matched items
            norm_item = normalize_text(strip_souvenir_prefix(item_id))
            self.matched_items[case_id].add(norm_item)
            
            # Track for souvenir copy resolution
            if mapping["is_collection"] and mapping["matched_collection"]:
                coll = mapping["matched_collection"]
                self.collection_images[coll][norm_item] = {
                    "path": png, "rarity": rarity, "category": category,
                    "new_folder": new_folder, "new_name": new_name,
                    "item_id": item_id
                }
        else:
            # Unmatched - move to _remove folder
            remove_folder = folder.parent / f"{folder.name}_remove"
            self.remove_counters[folder.name] += 1
            counter = self.remove_counters[folder.name]
            new_name = f"remove-{counter:03d}--{to_kebab_case(png.stem)}.png"
            
            row["NewFolder"] = str(remove_folder)
            row["NewName"] = new_name
            row["Action"] = "remove"
            row["Rationale"] = f"No match found (folder type: {mapping['match_type']})"
            
            self.unmatched.append({
                "FullPath": str(png), "Reason": "No match",
                "FolderMatchType": mapping["match_type"],
                "MatchedCases": ",".join(mapping["matched_cases"]) or "None"
            })
        
        self.plan_rows.append(row)

    def _generate_souvenir_copies(self):
        """Generate copy actions for souvenir packages from collection images."""
        for coll_name, images in self.collection_images.items():
            # Get all souvenir packages using this collection
            souvenir_cases = self.item_index["collection_to_cases"].get(coll_name, [])
            
            for case_id in souvenir_cases:
                case_items = self.item_index["by_case"].get(case_id, [])
                case_data = self.item_index["json_data"].get(case_id, {})
                case_info = case_data.get("case", {})
                case_name = case_info.get("name", "")
                
                # Find the asset folder for this souvenir package
                target_folder = self._find_case_folder(case_id)
                if not target_folder:
                    continue
                
                # For each item in this souvenir, check if we have the image from collection
                for item in case_items:
                    item_id = item.get("itemId", "")
                    norm_item = normalize_text(strip_souvenir_prefix(item_id))
                    
                    # Skip if already matched directly in this case folder
                    if norm_item in self.matched_items.get(case_id, set()):
                        continue
                    
                    # Check if collection has this image
                    if norm_item in images:
                        src = images[norm_item]
                        rarity = item["_rarity"]
                        category = item["_category"]
                        
                        cat_folder = get_category_folder(category)
                        new_folder = target_folder / cat_folder
                        new_name = self._resolve_filename(target_folder.name, case_id, rarity, item_id, None)
                        
                        row = {
                            "FullPath": "COPY",
                            "CaseId": case_id, "CaseName": case_name,
                            "CollectionName": coll_name,
                            "OriginalFolder": str(src["path"].parent),
                            "OriginalName": src["path"].name,
                            "NewFolder": str(new_folder), "NewName": new_name,
                            "Rarity": rarity, "ItemId": item_id,
                            "Category": category, "MatchedBy": "collection_copy",
                            "Verified": "True", "Confidence": "100",
                            "Rationale": f"Copied from collection {coll_name}",
                            "Action": "copy", "CopiedFrom": str(src["path"])
                        }
                        self.plan_rows.append(row)
                        self.matched_items[case_id].add(norm_item)
    
    def _find_case_folder(self, case_id: str) -> Optional[Path]:
        """Find the asset folder for a case."""
        case_norm = to_kebab_case(case_id)
        case_no_hyphen = case_norm.replace("-", "")
        
        for item in self.assets_root.iterdir():
            if not item.is_dir() or item.name == "Collections":
                continue
            folder_norm = to_kebab_case(item.name)
            folder_no_hyphen = folder_norm.replace("-", "")
            
            if folder_norm == case_norm or folder_no_hyphen == case_no_hyphen:
                return item
            if case_norm in folder_norm or folder_norm in case_norm:
                return item
        return None

    def _find_missing(self):
        """Find expected items without images."""
        for case_id, items in self.item_index["by_case"].items():
            matched = self.matched_items.get(case_id, set())
            
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
        
        # Add sequential suffix
        counter = 1
        while True:
            suf_name = make_filename(case_id, rarity, item_id, f"-{counter:02d}")
            if suf_name not in self.used_filenames[container]:
                self.used_filenames[container].add(suf_name)
                return suf_name
            counter += 1


# =============================================================================
# PLAN EXECUTION
# =============================================================================

class PlanExecutor:
    def __init__(self, root: Path, assets_root: Path, plan_path: Path, item_index: dict):
        self.root = root
        self.assets_root = assets_root
        self.plan_path = plan_path
        self.item_index = item_index
        self.results = []
    
    def execute(self):
        rows = self._load_plan()
        
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
        """Patch JSONs with image paths."""
        # Build map of (case_id, norm_item) -> relative_path
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
        
        # Patch each JSON
        for case_id, json_path in self.item_index["json_paths"].items():
            data = self.item_index["json_data"].get(case_id)
            if not data:
                continue
            
            case_images = image_map.get(case_id, {})
            modified = False
            case_data = data.get("case", {})
            
            # Get tier keys
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
            
            # Gold pool
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
        
        print(f"\nWriting reports to: {reports_dir}")
        write_plan_csv(plan_path, gen.plan_rows)
        print(f"  Plan: {plan_path} ({len(gen.plan_rows)} rows)")
        
        unmatched_path = reports_dir / "unmatched-files.txt"
        write_unmatched_txt(unmatched_path, gen.unmatched)
        print(f"  Unmatched: {unmatched_path} ({len(gen.unmatched)} files)")
        
        missing_path = reports_dir / "missing-expected-items.csv"
        write_missing_csv(missing_path, gen.missing_items)
        print(f"  Missing: {missing_path} ({len(gen.missing_items)} items)")
        
        # Summary
        actions = defaultdict(int)
        for r in gen.plan_rows:
            actions[r["Action"]] += 1
        
        print("\nPlan Summary:")
        for a, c in sorted(actions.items()):
            print(f"  {a}: {c}")
        
        print("\nRun with --apply to execute.")
    
    elif args.apply:
        print(f"\nExecuting plan: {plan_path}")
        exe = PlanExecutor(root, assets_root, plan_path, item_index)
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
