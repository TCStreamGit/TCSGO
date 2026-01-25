#!/usr/bin/env python3
"""
migrate_inventories_1_to_2.py - Migrate data/inventories.json from schema 1.0 to 2.0.

Usage:
    python tools/migrate_inventories_1_to_2.py
    python tools/migrate_inventories_1_to_2.py --path data/inventories.json

Behavior:
- Reads schema 1.0 inventories and rewrites the file to schema 2.0 in place.
- Writes a backup next to the input file (inventories.json.bak).
- Refuses to run if the file already declares schema 2.0.
"""

import argparse
import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_INPUT_FILE = REPO_ROOT / "data" / "inventories.json"


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def select_created_at(items: list, fallback_iso: str) -> str:
    earliest_dt = None
    earliest_value = None
    for item in items:
        if not isinstance(item, dict):
            continue
        raw = item.get("acquiredAt")
        parsed = parse_iso_datetime(raw)
        if parsed is None:
            continue
        parsed = to_utc(parsed)
        if earliest_dt is None or parsed < earliest_dt:
            earliest_dt = parsed
            earliest_value = raw
    return earliest_value if earliest_value is not None else fallback_iso


def parse_identity(user_key: str, user_data: dict) -> Tuple[str, str]:
    platform = user_data.get("platform")
    username = user_data.get("username")
    if (not platform or not username) and isinstance(user_key, str) and ":" in user_key:
        name_part, platform_part = user_key.rsplit(":", 1)
        if not username:
            username = name_part
        if not platform:
            platform = platform_part
    if not platform or not username:
        raise ValueError(f"Missing platform/username for user key: {user_key}")
    platform = str(platform).strip()
    username = str(username).strip()
    if not platform or not username:
        raise ValueError(f"Blank platform/username for user key: {user_key}")
    return platform, username


def migrate(data: dict) -> dict:
    schema_version = data.get("schemaVersion")
    if isinstance(schema_version, str) and schema_version.startswith("2.0-"):
        raise RuntimeError("Inventories already at schema 2.0; no changes made.")
    if schema_version != "1.0-inventories":
        raise ValueError(f"Unsupported schemaVersion: {schema_version}")
    users = data.get("users")
    if not isinstance(users, dict):
        raise ValueError("Expected 'users' to be an object in schema 1.0 file.")

    now_iso = now_iso_utc()
    inventories_by_id = {}
    identity_index = {}

    for user_key, user_data in users.items():
        if not isinstance(user_data, dict):
            raise ValueError(f"User entry must be an object: {user_key}")

        platform, username = parse_identity(user_key, user_data)
        identity = f"{platform.lower()}:{username.lower()}"
        if identity in identity_index:
            raise ValueError(f"Duplicate identity detected: {identity}")

        inventory_id = f"inv_{uuid.uuid4()}"
        cases = user_data.get("cases", {})
        keys = user_data.get("keys", {})
        items = user_data.get("items", [])
        if not isinstance(items, list):
            raise ValueError(f"Items must be a list for user: {user_key}")

        created_at = select_created_at(items, now_iso)
        inventories_by_id[inventory_id] = {
            "createdAt": created_at,
            "cases": cases,
            "keys": keys,
            "items": items,
            "identities": [identity],
            "mergedInto": None,
            "mergedAt": None,
        }
        identity_index[identity] = inventory_id

    return {
        "schemaVersion": "2.0-inventories",
        "lastModified": now_iso,
        "inventoriesById": inventories_by_id,
        "identityIndex": identity_index,
        "discordIndex": {},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate inventories.json schema 1.0 to 2.0.")
    parser.add_argument(
        "--path",
        default=str(DEFAULT_INPUT_FILE),
        help="Path to inventories.json (default: repo/data/inventories.json).",
    )
    args = parser.parse_args()

    input_path = Path(args.path).expanduser().resolve()
    if not input_path.exists():
        print(f"File not found: {input_path}", file=sys.stderr)
        return 1

    try:
        with input_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON in {input_path}: {exc}", file=sys.stderr)
        return 1

    try:
        migrated = migrate(data)
    except RuntimeError as exc:
        print(str(exc))
        return 0
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    backup_path = input_path.with_suffix(input_path.suffix + ".bak")
    if backup_path.exists():
        print(f"Backup already exists: {backup_path}", file=sys.stderr)
        return 1

    shutil.copy2(input_path, backup_path)
    with input_path.open("w", encoding="utf-8") as handle:
        json.dump(migrated, handle, indent=2)
        handle.write("\n")

    print(f"Migrated inventories to schema 2.0: {input_path}")
    print(f"Backup written: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
