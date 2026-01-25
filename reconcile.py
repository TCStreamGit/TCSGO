#!/usr/bin/env python3
"""
reconcile.py - Consolidate TCSGO inventories after stream end.

Usage:
  python reconcile.py
  python reconcile.py --inventories "Z:\\home\\nike\\Streaming\\TCSGO\\TCSGO\\data\\inventories.json" \
                      --links "Z:\\home\\nike\\Streaming\\TCSGO\\Linking\\user-links.json" \
                      --log "Z:\\home\\nike\\Streaming\\TCSGO\\State\\reconcile.log"

Behavior:
- Requires inventories schema 2.0.
- Merges linked identities into a canonical inventory per Discord user.
- Stubs merged inventories (does not delete).
- Updates discordIndex, identityIndex, and user-links.json inventoryId.
- Appends to reconcile.log.
"""

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


DEFAULT_INVENTORIES = r"Z:\home\nike\Streaming\TCSGO\TCSGO\data\inventories.json"
DEFAULT_LINKS = r"Z:\home\nike\Streaming\TCSGO\Linking\user-links.json"
DEFAULT_LOG = r"Z:\home\nike\Streaming\TCSGO\State\reconcile.log"

PLATFORMS = ("twitch", "youtube", "tiktok")


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        print(f"File not found: {path}", file=sys.stderr)
        raise
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON in {path}: {exc}", file=sys.stderr)
        raise


def save_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def append_log(path: Path, message: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(message.rstrip() + "\n")


def normalize_identity(platform: str, username: str) -> str:
    return f"{platform.strip().lower()}:{username.strip().lower()}"


def extract_identities(entry: Dict[str, Any]) -> List[str]:
    linked_accounts = entry.get("linkedAccounts")
    if not isinstance(linked_accounts, dict):
        raise ValueError("user-links entry linkedAccounts must be an object.")

    identities: List[str] = []
    for platform in PLATFORMS:
        account = linked_accounts.get(platform)
        if account is None:
            continue
        if not isinstance(account, dict):
            continue
        username_lower = account.get("usernameLower")
        if isinstance(username_lower, str) and username_lower.strip():
            identities.append(normalize_identity(platform, username_lower))

    return sorted(set(identities))


def ensure_schema_2(inv: Dict[str, Any]) -> None:
    schema = str(inv.get("schemaVersion") or "")
    if schema != "2.0-inventories":
        raise ValueError(f"Inventories schemaVersion must be 2.0-inventories (found: {schema}).")
    inv.setdefault("inventoriesById", {})
    inv.setdefault("identityIndex", {})
    inv.setdefault("discordIndex", {})


def create_empty_inventory(created_at: str) -> Dict[str, Any]:
    return {
        "createdAt": created_at,
        "cases": {},
        "keys": {},
        "items": [],
        "identities": [],
        "mergedInto": None,
        "mergedAt": None,
    }


def ensure_inventory_fields(inv: Dict[str, Any]) -> None:
    if not isinstance(inv.get("cases"), dict):
        inv["cases"] = {}
    if not isinstance(inv.get("keys"), dict):
        inv["keys"] = {}
    if not isinstance(inv.get("items"), list):
        inv["items"] = []
    if not isinstance(inv.get("identities"), list):
        inv["identities"] = []


def created_at_key(inv: Dict[str, Any]) -> str:
    created_at = inv.get("createdAt")
    if isinstance(created_at, str) and created_at.strip():
        return created_at
    return "9999-12-31T23:59:59.999Z"


def merge_counts(target: Dict[str, int], source: Dict[str, Any]) -> None:
    for key, value in source.items():
        try:
            count = int(value)
        except (TypeError, ValueError):
            continue
        if count:
            target[key] = int(target.get(key, 0)) + count


def merge_items(
    target_items: List[Any],
    source_items: Iterable[Any],
    existing_oids: set,
    log_lines: List[str],
    discord_id: str,
    source_id: str,
) -> None:
    for item in source_items:
        oid = item.get("oid") if isinstance(item, dict) else None
        if oid and oid in existing_oids:
            log_lines.append(
                f"DUPLICATE_OID discord={discord_id} source={source_id} oid={oid}"
            )
            continue
        if oid:
            existing_oids.add(oid)
        target_items.append(item)


def ensure_links_schema(links: Any) -> Dict[str, Any]:
    if not isinstance(links, dict):
        raise ValueError("user-links.json must be an object.")
    if links.get("schemaVersion") != "1.0-user-links":
        raise ValueError("user-links.json schemaVersion must be 1.0-user-links.")
    users = links.get("users")
    if not isinstance(users, dict):
        raise ValueError("user-links.json 'users' must be an object.")
    reverse = links.get("reverse")
    if not isinstance(reverse, dict):
        raise ValueError("user-links.json 'reverse' must be an object.")
    return users


def reconcile(inventories: Dict[str, Any], links: Any, log_path: Path) -> Tuple[Dict[str, Any], Any, List[str]]:
    ensure_schema_2(inventories)
    inv_by_id: Dict[str, Any] = inventories["inventoriesById"]
    identity_index: Dict[str, Any] = inventories["identityIndex"]
    discord_index: Dict[str, Any] = inventories["discordIndex"]

    users_map = ensure_links_schema(links)

    log_lines: List[str] = []
    now_iso = now_iso_utc()

    for discord_id, entry in users_map.items():
        if not isinstance(entry, dict):
            continue

        if "linkedAccounts" not in entry:
            raise ValueError(f"user-links entry missing linkedAccounts for discord user {discord_id}.")

        identities = extract_identities(entry)

        discord_inv_id = discord_index.get(discord_id)
        if not discord_inv_id:
            entry_inv_id = entry.get("inventoryId")
            if isinstance(entry_inv_id, str) and entry_inv_id in inv_by_id:
                discord_inv_id = entry_inv_id
                discord_index[discord_id] = discord_inv_id
                log_lines.append(
                    f"DISCORD_INDEX_FIXED discord={discord_id} inv={discord_inv_id}"
                )

        if not discord_inv_id or discord_inv_id not in inv_by_id:
            discord_inv_id = f"inv_{uuid.uuid4()}"
            discord_index[discord_id] = discord_inv_id
            inv_by_id[discord_inv_id] = create_empty_inventory(now_iso)
            log_lines.append(f"CREATED_DISCORD_INV discord={discord_id} inv={discord_inv_id}")

        candidates = {discord_inv_id}
        for identity in identities:
            candidate_id = identity_index.get(identity)
            if candidate_id:
                if candidate_id in inv_by_id:
                    candidates.add(candidate_id)
                else:
                    log_lines.append(
                        f"MISSING_INVENTORY identity={identity} inv={candidate_id}"
                    )

        canonical_id = min(
            candidates,
            key=lambda inv_id: (created_at_key(inv_by_id.get(inv_id, {})), inv_id),
        )
        canonical = inv_by_id[canonical_id]
        ensure_inventory_fields(canonical)

        existing_oids = {
            item.get("oid")
            for item in canonical["items"]
            if isinstance(item, dict) and item.get("oid")
        }

        for inv_id in sorted(candidates):
            if inv_id == canonical_id:
                continue
            source = inv_by_id.get(inv_id)
            if not isinstance(source, dict):
                continue
            ensure_inventory_fields(source)

            merge_counts(canonical["cases"], source["cases"])
            merge_counts(canonical["keys"], source["keys"])
            merge_items(
                canonical["items"],
                source["items"],
                existing_oids,
                log_lines,
                discord_id,
                inv_id,
            )
            for ident in source.get("identities", []):
                if isinstance(ident, str) and ident and ident not in canonical["identities"]:
                    canonical["identities"].append(ident)

            previous_merged_into = source.get("mergedInto")
            source["cases"] = {}
            source["keys"] = {}
            source["items"] = []
            source["identities"] = []
            source["mergedInto"] = canonical_id
            if source.get("mergedAt") is None or previous_merged_into != canonical_id:
                source["mergedAt"] = now_iso

        for ident in identities:
            if ident not in canonical["identities"]:
                canonical["identities"].append(ident)
            identity_index[ident] = canonical_id

        discord_index[discord_id] = canonical_id
        entry["inventoryId"] = canonical_id

        log_lines.append(
            f"RECONCILED discord={discord_id} canonical={canonical_id} candidates={len(candidates)}"
        )

    inventories["lastModified"] = now_iso
    links["lastModified"] = now_iso

    return inventories, links, log_lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile inventories after stream end.")
    parser.add_argument("--inventories", default=DEFAULT_INVENTORIES)
    parser.add_argument("--links", default=DEFAULT_LINKS)
    parser.add_argument("--log", default=DEFAULT_LOG)
    args = parser.parse_args()

    inv_path = Path(args.inventories)
    links_path = Path(args.links)
    log_path = Path(args.log)

    try:
        inventories = load_json(inv_path)
        links = load_json(links_path)
    except Exception:
        return 1

    try:
        updated_inventories, updated_links, log_lines = reconcile(inventories, links, log_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    for line in log_lines:
        append_log(log_path, f"{now_iso_utc()} {line}")

    save_json(inv_path, updated_inventories)
    save_json(links_path, updated_links)

    print(f"Reconcile complete. Log appended to {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
