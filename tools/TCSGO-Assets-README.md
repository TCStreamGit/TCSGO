# TCSGO Asset Organization System

A comprehensive asset management system for CS:GO/CS2 case opening simulations with Lumia Stream overlay integration.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [JSON Schema](#json-schema)
- [Asset Organization](#asset-organization)
- [The Rename Script](#the-rename-script)
- [File Naming Conventions](#file-naming-conventions)
- [Reports](#reports)
- [Workflow](#workflow)
- [Troubleshooting](#troubleshooting)

---

## Overview

TCSGO is a CS:GO/CS2 case opening simulation system that manages thousands of weapon skin images and maps them to case definitions stored in JSON files. The system is designed for use with Twitch streaming overlays via Lumia Stream.

### Key Features

- **4,200+ weapon skins** organized across 100+ cases and collections
- **Automatic image matching** from a global asset library to case-specific folders
- **Aspect ratio preservation** during image resizing (max 512px on any side)
- **Multiple skin variations** support (Doppler phases, Factory New vs Battle-Scarred, etc.)
- **Case icon management** for overlay displays
- **JSON patching** to link images directly in case definitions

---

## Directory Structure

```
TCSGO/
├── Assets/
│   ├── Global/                    # Master image library (source of truth)
│   │   ├── Weapons/               # All weapon skins
│   │   │   ├── AK-47/
│   │   │   ├── AWP/
│   │   │   ├── M4A4/
│   │   │   └── ...
│   │   ├── Knives/                # All knife skins
│   │   │   ├── Karambit/
│   │   │   ├── Butterfly-Knife/
│   │   │   └── ...
│   │   ├── Gloves/                # All glove skins
│   │   │   ├── Sport-Gloves/
│   │   │   ├── Driver-Gloves/
│   │   │   └── ...
│   │   └── Icons/                 # Case/collection icons
│   │       ├── operation-bravo-case.png
│   │       ├── chroma-case.png
│   │       └── ...
│   │
│   ├── Cases/                     # Organized by case (generated)
│   │   ├── Operation-Bravo-Case/
│   │   │   ├── Icons/
│   │   │   │   └── operation-bravo-case--icon.png
│   │   │   ├── Weapons/
│   │   │   │   ├── operation-bravo-case--milspec--ak-47-jungle-spray.png
│   │   │   │   └── ...
│   │   │   └── Knives/
│   │   │       ├── operation-bravo-case--extraordinary--karambit-fade.png
│   │   │       └── ...
│   │   ├── Chroma-Case/
│   │   └── ...
│   │
│   └── Collections/               # Souvenir collections (if applicable)
│
├── case-odds/                     # JSON case definitions
│   ├── operation-bravo-case.json
│   ├── chroma-case.json
│   ├── dreams-nightmares-case.json
│   └── ...
│
├── tools/
│   ├── rename_assets.py           # Main asset organization script
│   └── reports/                   # Generated reports
│       ├── rename-plan.csv
│       ├── missing-items.csv
│       ├── unmatched-global.csv
│       └── global-assets-index.txt
│
└── README.md
```

---

## JSON Schema

The system supports two JSON schema versions for case definitions:

### Schema 3.0 (Case Export) - Standard Cases

```json
{
  "schemaVersion": "3.0-case-export",
  "case": {
    "id": "chroma-case",
    "name": "Chroma Case",
    "caseType": "case",
    "image": "Assets/Cases/Chroma-Case/Icons/chroma-case--icon.png",
    "tiers": {
      "blue": [
        {
          "itemId": "glock-18-catacombs",
          "displayName": "Glock-18 | Catacombs",
          "weapon": "Glock-18",
          "skin": "Catacombs",
          "rarity": "Mil-Spec Grade",
          "image": "Assets/Cases/Chroma-Case/Weapons/chroma-case--mil-spec-grade--glock-18-catacombs.png",
          "imageAlternates": []
        }
      ],
      "purple": [...],
      "pink": [...],
      "red": [...]
    },
    "goldPool": {
      "items": [
        {
          "itemId": "karambit-doppler-phase-2",
          "displayName": "★ Karambit | Doppler (Phase 2)",
          "weapon": "Karambit",
          "skin": "Doppler",
          "rarity": "Extraordinary",
          "image": "Assets/Cases/Chroma-Case/Knives/chroma-case--extraordinary--karambit-doppler.png",
          "imageAlternates": [
            "Assets/Cases/Chroma-Case/Knives/chroma-case--extraordinary--karambit-doppler--02.png"
          ]
        }
      ]
    }
  }
}
```

### Schema 3.1 (Container Export) - Souvenir Packages

```json
{
  "schemaVersion": "3.1-container-export",
  "case": {
    "id": "anubis-collection-package",
    "name": "Anubis Collection Package",
    "caseType": "souvenir-package",
    "tiers": {
      "consumer": [...],
      "industrial": [...],
      "milspec": [...],
      "restricted": [...],
      "classified": [...],
      "covert": [...]
    }
  }
}
```

### Tier Keys

| Case Type | Tier Keys (low → high rarity) |
|-----------|-------------------------------|
| Standard Cases | `blue`, `purple`, `pink`, `red` |
| Souvenir Packages | `consumer`, `industrial`, `milspec`, `restricted`, `classified`, `covert` |
| Gold Pool (Knives/Gloves) | Separate `goldPool.items` array |

### Item Fields

| Field | Description |
|-------|-------------|
| `itemId` | Unique identifier (e.g., `ak-47-redline`) |
| `displayName` | Human-readable name with weapon and skin |
| `weapon` | Weapon type (e.g., `AK-47`) |
| `skin` | Skin name (e.g., `Redline`) |
| `rarity` | Rarity tier name |
| `image` | **Primary image path** (set by script) |
| `imageAlternates` | **Array of alternate variation paths** (set by script) |

---

## Asset Organization

### Global Folder (Source)

The `Assets/Global/` folder is the **master image library**. Images are organized by category and weapon type:

```
Global/
├── Weapons/
│   └── AK-47/
│       ├── AK-47-Redline.png
│       ├── AK-47-Redline-1.png      # Variation
│       ├── AK-47-Asiimov.png
│       └── ...
├── Knives/
│   └── Karambit/
│       ├── Karambit-Doppler.png
│       ├── Karambit-Fade.png
│       └── ...
├── Gloves/
│   └── Sport-Gloves/
│       └── Sport-Gloves-Pandoras-Box.png
└── Icons/
    ├── chroma-case.png
    └── ...
```

### Cases Folder (Generated)

The `Assets/Cases/` folder contains **case-specific copies** of images, renamed with standardized filenames that include the case ID, rarity, and item ID:

```
Cases/
└── Chroma-Case/
    ├── Icons/
    │   └── chroma-case--icon.png
    ├── Weapons/
    │   ├── chroma-case--mil-spec-grade--glock-18-catacombs.png
    │   ├── chroma-case--restricted--m4a1-s-dark-water.png
    │   └── ...
    └── Knives/
        ├── chroma-case--extraordinary--karambit-doppler.png
        ├── chroma-case--extraordinary--karambit-doppler--02.png  # Alternate
        └── ...
```

### Why Copy Instead of Reference?

1. **Isolation**: Each case has its own complete set of images
2. **Overlay Performance**: Local paths are faster than lookups
3. **Customization**: Case-specific image edits won't affect other cases
4. **Portability**: Each case folder is self-contained

---

## The Rename Script

### Purpose

`rename_assets.py` automates the process of:

1. **Discovering** all images in `Global/` folder
2. **Matching** them to items defined in JSON case files
3. **Copying** images to case-specific folders with standardized names
4. **Updating** JSON files with image paths

### Features

- **Aspect Ratio Preservation**: Images are resized so the largest dimension is ≤512px while maintaining original proportions
- **Duplicate Detection**: MD5 hash-based deduplication
- **Variation Handling**: Supports multiple images per item (Doppler phases, wear levels, etc.)
- **Smart Matching**: Multiple matching strategies for item-to-image mapping
- **Case Icon Linking**: Automatically finds and links case icons
- **Non-Destructive**: Never deletes or modifies original images

### Usage

```bash
# Generate plan and reports (recommended first step)
python rename_assets.py --plan-only

# Review the generated reports in tools/reports/

# Execute the plan (copy files and update JSONs)
python rename_assets.py --apply

# Specify custom root directory
python rename_assets.py --root "D:\MyTCSGO" --apply
```

### Requirements

```bash
pip install Pillow
```

If Pillow is not installed, images will be copied without resizing.

### Matching Strategies

The script uses multiple strategies to match JSON items to Global images:

| Strategy | Example |
|----------|---------|
| **Exact Match** | `ak-47-redline` → `AK-47-Redline.png` |
| **Doppler Phase** | `karambit-doppler-phase-2` → `Karambit-Doppler.png` |
| **Gamma Doppler** | `karambit-gamma-doppler-phase-3` → `Karambit-Gamma-Doppler.png` |
| **Numbered Skin** | `mag-7-swag-7` → `MAG-7-Swag.png` |
| **Original/Vanilla** | `bayonet-original` → `Bayonet-Vanilla.png` |
| **Skin Aliases** | `p90-neon-queen` → `P90-Neoqueen.png` |
| **Partial Match** | Fuzzy matching with >55% similarity |

### Skin Aliases

Some skins have different names in JSON vs file names:

```python
SKIN_ALIASES = {
    "neon-queen": "neoqueen",
    # Add more as discovered
}
```

---

## File Naming Conventions

### Global Folder (Input)

```
{Weapon}-{Skin}.png
{Weapon}-{Skin}-{Variation}.png
{Weapon}-{Skin}--Icon.png
```

Examples:
- `AK-47-Redline.png`
- `Karambit-Doppler-1.png`
- `AWP-Dragon-Lore--Icon.png`

### Cases Folder (Output)

```
{case-id}--{rarity}--{item-id}.png
{case-id}--{rarity}--{item-id}--{variation}.png
```

Examples:
- `chroma-case--mil-spec-grade--glock-18-catacombs.png`
- `chroma-case--extraordinary--karambit-doppler.png`
- `chroma-case--extraordinary--karambit-doppler--02.png`

### Case Icons

```
{case-id}--icon.png
```

Example:
- `chroma-case--icon.png`

---

## Reports

The script generates four reports in `tools/reports/`:

### 1. rename-plan.csv

Complete plan of all copy operations:

| Column | Description |
|--------|-------------|
| Action | Always "copy" |
| SourcePath | Full path to Global image |
| SourceFile | Original filename |
| DestFolder | Target case folder |
| DestFile | New standardized filename |
| CaseId | Case identifier |
| ItemId | Item identifier |
| Rarity | Item rarity tier |
| IsMain | "Yes" for primary image |
| VarIndex | Variation index (0 = main) |
| MatchMethod | How the match was found |

### 2. missing-items.csv

JSON items that couldn't be matched to any Global image:

| Column | Description |
|--------|-------------|
| CaseId | Case containing the item |
| ItemId | Unmatched item ID |
| DisplayName | Human-readable name |
| Rarity | Expected rarity |
| Weapon | Weapon type |
| Skin | Skin name |

### 3. unmatched-global.csv

Global images that don't match any JSON item:

| Column | Description |
|--------|-------------|
| SourcePath | Path to unmatched image |
| Filename | Image filename |
| BaseName | Normalized name |
| Category | weapon/knife/glove |

### 4. global-assets-index.txt

Complete index of all Global assets with statistics:

- Total unique items
- Items by category
- List of all case icons
- Items with multiple variations

---

## Workflow

### Initial Setup

1. **Populate Global folder** with all weapon/knife/glove images
2. **Add case icons** to `Global/Icons/`
3. **Create JSON definitions** for each case in `case-odds/`

### Running the Script

```bash
# Step 1: Generate plan
python tools/rename_assets.py --plan-only

# Step 2: Review reports
# - Check missing-items.csv for items needing images
# - Check unmatched-global.csv for unused images

# Step 3: Fix any issues
# - Add missing images to Global/
# - Update SKIN_ALIASES if naming mismatches exist

# Step 4: Re-run plan until satisfied
python tools/rename_assets.py --plan-only

# Step 5: Apply the plan
python tools/rename_assets.py --apply
```

### Adding New Cases

1. Create JSON definition in `case-odds/`
2. Ensure all item images exist in `Global/`
3. Add case icon to `Global/Icons/` (named `{case-id}.png`)
4. Run `--plan-only` to verify
5. Run `--apply` to generate case folder

### Adding New Skins

1. Add image(s) to appropriate `Global/{Category}/{Weapon}/` folder
2. Run script to propagate to all cases using that skin

---

## Troubleshooting

### "Missing items" in report

**Cause**: JSON item doesn't match any Global image

**Solutions**:
1. Check if image exists with different naming
2. Add entry to `SKIN_ALIASES` dictionary
3. Rename image in Global folder to match expected pattern
4. Download missing image and add to Global folder

### "Unmatched files" in report

**Cause**: Global image doesn't match any JSON item

**Solutions**:
1. This is often fine - extra variations or unused skins
2. Check if the item exists in a JSON but with different naming
3. Remove if truly unused (but remember: never delete, just move)

### Images look squished

**Cause**: Old script version without aspect ratio preservation

**Solution**: Use v2.2+ which maintains aspect ratio:
```python
scale = min(max_dimension / orig_width, max_dimension / orig_height)
```

### Case icon not linking

**Cause**: Icon filename doesn't match case ID

**Solutions**:
1. Rename icon to match case ID exactly
2. Check `global-assets-index.txt` for available icons
3. The script tries: exact ID, case name, partial matches

### Pillow not installed

**Warning**: `Images will be copied without resizing`

**Solution**:
```bash
pip install Pillow
```

---

## Technical Details

### Image Processing

- **Max Dimension**: 512px (configurable via `MAX_IMAGE_DIMENSION`)
- **Resampling**: LANCZOS (highest quality downscaling)
- **Format**: PNG with optimization
- **Transparency**: Preserved (RGBA mode)

### Duplicate Detection

- MD5 hash of file contents (first 12 characters)
- Higher quality version kept when duplicates found
- Quality = width × height

### Variation Sorting

1. Non-icon images first
2. Sorted by quality (descending)
3. First image marked as "main"
4. Others become "alternates"

---

## Version History

| Version | Changes |
|---------|---------|
| 2.2 | Aspect ratio preservation, case icon linking |
| 2.1 | Plan & review workflow, comprehensive reports |
| 2.0 | Two-phase processing, variation support |
| 1.0 | Initial release |

---

## License

Internal project - not for distribution.

## Contact

For issues or questions about the asset organization system, refer to the project documentation or development team.
