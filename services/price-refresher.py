#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
TCSGO Price Refresher
- Primary: Steam Community Market priceoverview (CAD)
- Fallback: CSFloat Listings Lowest Buy-Now (USD -> CAD via Bank Of Canada FXUSDCAD)
- Safe Rate Limiting + Retries + Locking + Backups + Rotating Logs
"""

from __future__ import annotations

import argparse
import datetime as _dt
import errno
import json
import logging
import logging.handlers
import os
import random
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple


# ---------------------------
# Utilities
# ---------------------------

def utc_now_iso() -> str:
    tz = getattr(_dt, "UTC", _dt.timezone.utc)
    return _dt.datetime.now(tz).replace(microsecond=0).isoformat().replace("+00:00", "Z")



def local_now() -> _dt.datetime:
    return _dt.datetime.now()


def parse_iso_dt(s: str) -> Optional[_dt.datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1]
        return _dt.datetime.fromisoformat(s)
    except Exception:
        return None


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


def checkpoint_save(path: str, data: Any, logger: logging.Logger) -> None:
    try:
        write_json_atomic(path, data)
        logger.info("Checkpoint Saved: prices.json")
    except Exception as e:
        logger.warning(f"Checkpoint Save Failed: {e}")


def safe_copy(src: str, dst: str) -> None:
    shutil.copy2(src, dst)


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def money_round(v: float) -> float:
    # Keep 2 decimals For CAD
    return float(f"{v:.2f}")


def jitter(seconds: float, pct: float = 0.15) -> float:
    # +/- pct jitter
    delta = seconds * pct
    return max(0.0, seconds + random.uniform(-delta, delta))


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> Tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        raw = resp.read()
        encoding = resp.headers.get_content_charset() or "utf-8"
        text = raw.decode(encoding, errors="replace")
        return status, json.loads(text)


def run_cmd(cmd: list[str], cwd: Optional[str] = None) -> Tuple[int, str]:
    p = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        shell=False,
    )
    out, _ = p.communicate()
    return p.returncode, out or ""


# ---------------------------
# Cross-Platform File Lock
# ---------------------------

class SingleInstanceLock:
    def __init__(self, lock_path: str) -> None:
        self.lock_path = lock_path
        self.fp = None

    def acquire(self) -> None:
        ensure_dir(os.path.dirname(self.lock_path) or ".")
        self.fp = open(self.lock_path, "a+", encoding="utf-8")

        # Ensure The Lock Region Is Always At Offset 0 On Windows
        self.fp.seek(0)
        try:
            self.fp.write("0")
            self.fp.flush()
        except Exception:
            pass
        self.fp.seek(0)

        try:
            if os.name == "nt":
                import msvcrt  # type: ignore
                msvcrt.locking(self.fp.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl  # type: ignore
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            raise RuntimeError("Another Instance Is Already Running (Lock Held).")

        self.fp.seek(0)
        self.fp.truncate(0)
        self.fp.write(f"LockedAtUtc={utc_now_iso()}\nPid={os.getpid()}\n")
        self.fp.flush()


    def release(self) -> None:
        fp = self.fp
        if not fp:
            return

        try:
            # Windows Unlock Must Target The Same Region (Offset 0, Length 1)
            try:
                fp.seek(0)
            except Exception:
                pass

            if os.name == "nt":
                import msvcrt  # type: ignore
                try:
                    msvcrt.locking(fp.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    # If Already Unlocked Or Region Moved, Don’t Crash The Whole Run
                    pass
            else:
                import fcntl  # type: ignore
                try:
                    fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
        finally:
            try:
                fp.close()
            except Exception:
                pass
            self.fp = None



# ---------------------------
# Price Parsing
# ---------------------------

_PRICE_RE = re.compile(r"([-+]?\d[\d\s,.\u00A0]*)")

def parse_price_text_to_float(price_text: str) -> Optional[float]:
    """
    Steam Often Returns Strings Like:
    "$8.50 CAD", "$7.90", "39,58 kr"
    This Extracts The First Number And Handles Commas/Spaces.
    """
    if not price_text or not isinstance(price_text, str):
        return None

    m = _PRICE_RE.search(price_text)
    if not m:
        return None

    num = m.group(1)
    num = num.replace("\u00A0", " ").strip()
    num = num.replace(" ", "")

    # If It Has Both ',' And '.', Assume ',' Is Thousands Separator
    if "," in num and "." in num:
        num = num.replace(",", "")
    # If It Has Only ',', Assume ',' Is Decimal Separator
    elif "," in num and "." not in num:
        num = num.replace(",", ".")

    try:
        return float(num)
    except Exception:
        return None


# ---------------------------
# Providers
# ---------------------------

class SteamProvider:
    def __init__(self, appid: int, currency: int, delay_seconds: float, timeout: int, user_agent: str) -> None:
        self.appid = appid
        self.currency = currency
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self.user_agent = user_agent
        self._last_call_ts = 0.0

    def _rate_limit(self) -> None:
        now = time.time()
        elapsed = now - self._last_call_ts
        wait_for = self.delay_seconds - elapsed
        if wait_for > 0:
            time.sleep(jitter(wait_for))
        self._last_call_ts = time.time()

    def fetch_cad(self, market_hash_name: str, retries: int, backoff_seconds: float) -> Tuple[Optional[float], str]:
        base = "https://steamcommunity.com/market/priceoverview/"
        params = {
            "appid": str(self.appid),
            "currency": str(self.currency),
            "market_hash_name": market_hash_name,
            "format": "json",
        }
        url = base + "?" + urllib.parse.urlencode(params, safe="|()™★:+-_%")

        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json,text/plain,*/*",
        }

        attempt = 0
        last_error = "unknown"
        while attempt < max(1, retries):
            attempt += 1
            self._rate_limit()
            try:
                status, data = http_get_json(url, headers=headers, timeout=self.timeout)
                if status == 429:
                    last_error = "rate_limited"
                    sleep_for = backoff_seconds * attempt
                    time.sleep(jitter(sleep_for))
                    continue

                if not isinstance(data, dict) or not data.get("success", False):
                    # Steam Can Return {"success":false}
                    last_error = "no_price"
                    time.sleep(jitter(backoff_seconds * attempt))
                    continue

                # Prefer Median As "Average" When Present
                median = data.get("median_price")
                lowest = data.get("lowest_price")

                v = None
                if isinstance(median, str):
                    v = parse_price_text_to_float(median)
                if v is None and isinstance(lowest, str):
                    v = parse_price_text_to_float(lowest)

                if v is None:
                    last_error = "no_price"
                    return None, last_error
                return money_round(v), "ok"
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    last_error = "rate_limited"
                    time.sleep(jitter(backoff_seconds * attempt))
                    continue
                last_error = "http_error"
                time.sleep(jitter(backoff_seconds * attempt))
            except Exception:
                last_error = "network_error"
                time.sleep(jitter(backoff_seconds * attempt))

        return None, last_error


class BankOfCanadaFx:
    """
    Uses BoC Valet Group Endpoint For Daily Exchange Rates.
    Pulls Latest FXUSDCAD (1 USD In CAD).
    """
    def __init__(self, timeout: int, user_agent: str) -> None:
        self.timeout = timeout
        self.user_agent = user_agent

    def fetch_usd_to_cad(self) -> Optional[float]:
        url = "https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1"
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}
        try:
            status, data = http_get_json(url, headers=headers, timeout=self.timeout)
            if status != 200 or not isinstance(data, dict):
                return None
            obs = data.get("observations")
            if not isinstance(obs, list) or not obs:
                return None
            latest = obs[-1]
            fx = latest.get("FXUSDCAD", {})
            if not isinstance(fx, dict):
                return None
            v = fx.get("v")
            if not isinstance(v, str):
                return None
            rate = float(v)
            # Reasonable Bound Guard
            return clamp(rate, 0.5, 5.0)
        except Exception:
            return None


class CSFloatProvider:
    """
    Uses CSFloat Public Listings Endpoint With Filters.
    Gets Lowest Buy-Now Listing Price In Cents (Assumed USD) And Converts To CAD Via BoC.
    """
    def __init__(self, delay_seconds: float, timeout: int, user_agent: str, api_key: str = "") -> None:
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self.user_agent = user_agent
        self.api_key = api_key.strip()
        self._last_call_ts = 0.0

    def _rate_limit(self) -> None:
        now = time.time()
        elapsed = now - self._last_call_ts
        wait_for = self.delay_seconds - elapsed
        if wait_for > 0:
            time.sleep(jitter(wait_for))
        self._last_call_ts = time.time()

    def fetch_usd_lowest(self, market_hash_name: str, retries: int, backoff_seconds: float) -> Tuple[Optional[float], str]:
        base = "https://csfloat.com/api/v1/listings"
        params = {
            "market_hash_name": market_hash_name,
            "sort_by": "lowest_price",
            "limit": "1",
            "type": "buy_now",
        }
        url = base + "?" + urllib.parse.urlencode(params, safe="|()™★:+-_%")

        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json,text/plain,*/*",
        }
        if self.api_key:
            headers["Authorization"] = self.api_key

        attempt = 0
        last_error = "unknown"
        while attempt < max(1, retries):
            attempt += 1
            self._rate_limit()
            try:
                status, data = http_get_json(url, headers=headers, timeout=self.timeout)
                if status == 429:
                    last_error = "rate_limited"
                    time.sleep(jitter(backoff_seconds * attempt))
                    continue
                if status in (401, 403):
                    # Missing/Invalid Key Or Not Allowed
                    last_error = "unauthorized"
                    return None, last_error
                if status != 200 or not isinstance(data, list) or not data:
                    last_error = "no_price"
                    time.sleep(jitter(backoff_seconds * attempt))
                    continue

                listing = data[0]
                if not isinstance(listing, dict):
                    last_error = "no_price"
                    return None, last_error
                cents = listing.get("price")
                if not isinstance(cents, int):
                    last_error = "no_price"
                    return None, last_error
                if cents <= 0:
                    last_error = "no_price"
                    return None, last_error
                return cents / 100.0, "ok"
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    last_error = "rate_limited"
                    time.sleep(jitter(backoff_seconds * attempt))
                    continue
                last_error = "http_error"
                time.sleep(jitter(backoff_seconds * attempt))
            except Exception:
                last_error = "network_error"
                time.sleep(jitter(backoff_seconds * attempt))

        return None, last_error


@dataclass
class ProviderState:
    name: str
    enabled: bool
    cooldown_until: float = 0.0
    consecutive_hard_failures: int = 0

    def is_available(self, now_ts: float, logger: logging.Logger) -> bool:
        if not self.enabled:
            return False
        if self.cooldown_until <= 0.0:
            return True
        if now_ts >= self.cooldown_until:
            self.cooldown_until = 0.0
            self.consecutive_hard_failures = 0
            logger.info(f"Provider {self.name} back online; resuming.")
            return True
        return False

    def record_success(self) -> None:
        self.consecutive_hard_failures = 0

    def record_hard_failure(
        self,
        now_ts: float,
        fail_threshold: int,
        cooldown_seconds: float,
        logger: logging.Logger,
    ) -> None:
        self.consecutive_hard_failures += 1
        if self.consecutive_hard_failures >= fail_threshold:
            self.cooldown_until = now_ts + cooldown_seconds
            self.consecutive_hard_failures = 0
            logger.warning(
                f"Provider {self.name} paused for {int(cooldown_seconds)}s after {fail_threshold} failures."
            )


# ---------------------------
# Market Hash Name Building
# ---------------------------

def build_item_market_hash(display_name: str, wear: str, is_stattrak: bool) -> str:
    prefix = "StatTrak™ " if is_stattrak else ""
    # Wear Is Usually Required For Skins/Gloves/Knives
    if wear and wear.lower() not in ("none", "na", "n/a"):
        return f"{prefix}{display_name} ({wear})"
    return f"{prefix}{display_name}"


def parse_item_key(item_key: str) -> Optional[Tuple[str, str, bool, str]]:
    """
    <itemId>|<wear>|<statTrak01>|<variant>
    Returns (ItemId, Wear, IsStatTrak, Variant)
    """
    if not item_key or not isinstance(item_key, str):
        return None
    parts = item_key.split("|")
    if len(parts) != 4:
        return None
    item_id = parts[0].strip()
    wear = parts[1].strip()
    st = parts[2].strip().lower()
    variant = parts[3].strip()
    is_st = st in ("1", "true", "yes", "y")
    return item_id, wear, is_st, variant


# ---------------------------
# Case Odds Loading
# ---------------------------

def load_case_index(case_odds_dir: str) -> Dict[str, str]:
    out: Dict[str, str] = {}

    # Prefer index.json If Present
    idx_path = os.path.join(case_odds_dir, "index.json")
    if os.path.isfile(idx_path):
        try:
            idx = read_json(idx_path)
            cases = idx.get("cases", []) if isinstance(idx, dict) else []
            if isinstance(cases, list):
                for c in cases:
                    if not isinstance(c, dict):
                        continue
                    cid = c.get("id") or c.get("Id") or c.get("ID")
                    name = c.get("name") or c.get("Name")
                    if isinstance(cid, str) and isinstance(name, str):
                        out[cid] = name
        except Exception:
            pass

    if out:
        return out

    # Fallback: Scan All Case JSON Files (Supports 3.0-case-export Layout)
    try:
        for fn in os.listdir(case_odds_dir):
            if not fn.lower().endswith(".json"):
                continue
            if fn.lower() == "index.json":
                continue
            fp = os.path.join(case_odds_dir, fn)
            if not os.path.isfile(fp):
                continue
            try:
                data = read_json(fp)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            c = data.get("case")
            if not isinstance(c, dict):
                continue
            cid = c.get("id")
            name = c.get("name")
            if isinstance(cid, str) and isinstance(name, str):
                out[cid] = name
    except Exception:
        pass

    return out



def load_item_id_to_display_name(case_odds_dir: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}

    # Build File List From index.json If Present, Else Scan Directory
    files: list[str] = []
    idx_path = os.path.join(case_odds_dir, "index.json")
    if os.path.isfile(idx_path):
        try:
            idx = read_json(idx_path)
            cases = idx.get("cases", []) if isinstance(idx, dict) else []
            if isinstance(cases, list):
                for c in cases:
                    if not isinstance(c, dict):
                        continue
                    filename = c.get("filename") or c.get("Filename")
                    if isinstance(filename, str) and filename.lower().endswith(".json"):
                        files.append(os.path.join(case_odds_dir, filename))
        except Exception:
            files = []

    if not files:
        try:
            for fn in os.listdir(case_odds_dir):
                if not fn.lower().endswith(".json"):
                    continue
                if fn.lower() == "index.json":
                    continue
                files.append(os.path.join(case_odds_dir, fn))
        except Exception:
            pass

    def add_from_items(items: Any) -> None:
        if not isinstance(items, list):
            return
        for it in items:
            if not isinstance(it, dict):
                continue
            item_id = it.get("itemId")
            display = it.get("displayName")
            if isinstance(item_id, str) and isinstance(display, str) and item_id not in mapping:
                mapping[item_id] = display

    for fp in files:
        if not os.path.isfile(fp):
            continue
        try:
            data = read_json(fp)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue

        # Support Both Layouts:
        # - Older: { "tiers": { ... } }
        # - Newer: { "case": { "tiers": { ... }, "goldPool": { "items": [...] } } }
        tiers = data.get("tiers")
        case_obj = data.get("case") if isinstance(data.get("case"), dict) else None
        if not isinstance(tiers, dict) and isinstance(case_obj, dict):
            tiers = case_obj.get("tiers")

        if isinstance(tiers, dict):
            for _, items in tiers.items():
                add_from_items(items)

        gold_pool = None
        if isinstance(data.get("goldPool"), dict):
            gold_pool = data.get("goldPool")
        if isinstance(case_obj, dict) and isinstance(case_obj.get("goldPool"), dict):
            gold_pool = case_obj.get("goldPool")

        if isinstance(gold_pool, dict):
            add_from_items(gold_pool.get("items"))

    return mapping

    idx_path = os.path.join(case_odds_dir, "index.json")
    idx = read_json(idx_path)
    cases = idx.get("cases", []) if isinstance(idx, dict) else []
    mapping: Dict[str, str] = {}

    if not isinstance(cases, list):
        return mapping

    for c in cases:
        if not isinstance(c, dict):
            continue
        filename = c.get("filename")
        if not isinstance(filename, str):
            continue
        fp = os.path.join(case_odds_dir, filename)
        if not os.path.isfile(fp):
            continue
        try:
            data = read_json(fp)
        except Exception:
            continue
        tiers = data.get("tiers") if isinstance(data, dict) else None
        if not isinstance(tiers, dict):
            continue
        for _, items in tiers.items():
            if not isinstance(items, list):
                continue
            for it in items:
                if not isinstance(it, dict):
                    continue
                item_id = it.get("itemId")
                display = it.get("displayName")
                if isinstance(item_id, str) and isinstance(display, str) and item_id not in mapping:
                    mapping[item_id] = display
    return mapping


# ---------------------------
# Core Refresh Logic
# ---------------------------

def should_refresh(updated_at_iso: Optional[str], max_age_hours: float, force: bool) -> bool:
    if force:
        return True
    if not updated_at_iso:
        return True
    dt = parse_iso_dt(updated_at_iso)
    if not dt:
        return True
    tz = getattr(_dt, "UTC", _dt.timezone.utc)
    tz = getattr(_dt, "UTC", _dt.timezone.utc)
    now_utc = _dt.datetime.now(tz)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    age = (now_utc - dt).total_seconds() / 3600.0
    return age >= max_age_hours


def get_updated_at_bucket(prices: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    bucket = prices.get("priceUpdatedAtUtc")
    if not isinstance(bucket, dict):
        bucket = {}
        prices["priceUpdatedAtUtc"] = bucket
    for k in ("cases", "keys", "items"):
        if not isinstance(bucket.get(k), dict):
            bucket[k] = {}
    return bucket  # type: ignore


def load_overrides(path: str) -> Dict[str, Dict[str, str]]:
    if not path or not os.path.isfile(path):
        return {"cases": {}, "keys": {}, "items": {}}
    try:
        data = read_json(path)
        if not isinstance(data, dict):
            return {"cases": {}, "keys": {}, "items": {}}
        out: Dict[str, Dict[str, str]] = {"cases": {}, "keys": {}, "items": {}}
        for k in ("cases", "keys", "items"):
            v = data.get(k, {})
            if isinstance(v, dict):
                out[k] = {str(kk): str(vv) for kk, vv in v.items() if isinstance(kk, str) and isinstance(vv, str)}
        return out
    except Exception:
        return {"cases": {}, "keys": {}, "items": {}}


def configure_logging(log_dir: str, level: str, keep_days: int, max_files: int) -> logging.Logger:
    ensure_dir(log_dir)
    logger = logging.getLogger("price_refresher")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    file_path = os.path.join(log_dir, "price-refresher.log")
    fh = logging.handlers.TimedRotatingFileHandler(
        file_path,
        when="midnight",
        interval=1,
        backupCount=max(keep_days, max_files),
        encoding="utf-8",
        utc=False,
    )
    fh.setFormatter(fmt)
    fh.setLevel(logger.level)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    sh.setLevel(logger.level)

    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def refresh_once(config: Dict[str, Any], args: argparse.Namespace, logger: logging.Logger) -> int:
    base = config["paths"]["base"]
    prices_path = os.path.join(base, config["paths"]["pricesJson"])
    case_odds_dir = os.path.join(base, config["paths"]["caseOddsDir"])
    logs_dir = os.path.join(base, config["paths"]["logsDir"])
    overrides_path = os.path.join(base, config["paths"]["overridesJson"])
    lock_path = os.path.join(base, config["paths"]["lockFile"])

    ensure_dir(os.path.dirname(prices_path))
    ensure_dir(case_odds_dir)
    ensure_dir(logs_dir)

    lock = SingleInstanceLock(lock_path)
    lock.acquire()
    try:
        # Load Inputs
        prices = read_json(prices_path)
        if not isinstance(prices, dict):
            logger.error("prices.json Is Not A JSON Object.")
            return 2

        overrides = load_overrides(overrides_path)

        id_to_case_name = load_case_index(case_odds_dir)
        item_id_to_display = load_item_id_to_display_name(case_odds_dir)

        user_agent = str(config["http"]["userAgent"])


        # Providers
        steam_cfg = config["providers"]["steam"]
        steam = SteamProvider(
            appid=int(steam_cfg["appid"]),
            currency=int(steam_cfg["currency"]),
            delay_seconds=float(steam_cfg["delaySeconds"]),
            timeout=int(steam_cfg["timeoutSeconds"]),
            user_agent = str(config["http"]["userAgent"]),
        )

        fx = BankOfCanadaFx(
            timeout=int(config["providers"]["fx"]["timeoutSeconds"]),
            user_agent = str(config["http"]["userAgent"]),
        )
        usd_to_cad = fx.fetch_usd_to_cad()
        if usd_to_cad is None:
            logger.warning("USD->CAD FX Rate Unavailable; USD Fallbacks Will Be Skipped.")
        else:
            logger.info(f"USD->CAD FXUSDCAD={usd_to_cad:.6f}")

        csf_cfg = config["providers"]["csfloat"]

        # Prefer Secrets File, Then Env Var, Then Config (Config Is Discouraged To Avoid Leaks)
        secrets_path = ""
        if isinstance(config.get("paths", {}), dict):
            secrets_rel = str(config["paths"].get("secretsJson", "")).strip()
            if secrets_rel:
                secrets_path = os.path.join(base, secrets_rel)

        secrets = {}
        if secrets_path and os.path.isfile(secrets_path):
            try:
                secrets = read_json(secrets_path)
            except Exception:
                secrets = {}

        env_var = str(csf_cfg.get("apiKeyEnvVar", "CSFLOAT_API_KEY")).strip() or "CSFLOAT_API_KEY"
        api_key = ""

        if isinstance(secrets, dict):
            v = secrets.get("csfloatApiKey")
            if isinstance(v, str) and v.strip():
                api_key = v.strip()

        if not api_key:
            v = os.environ.get(env_var, "")
            if isinstance(v, str) and v.strip():
                api_key = v.strip()

        cfg_key = str(csf_cfg.get("apiKey", "")).strip()
        if cfg_key:
            logger.warning("CSFloat Api Key Is Present In Config. Move It To Secrets Or Env To Avoid Git Leaks.")
            if not api_key:
                api_key = cfg_key

        csfloat = CSFloatProvider(
            delay_seconds=float(csf_cfg["delaySeconds"]),
            timeout=int(csf_cfg["timeoutSeconds"]),
            user_agent=user_agent,
            api_key=api_key,
        )

        steam_enabled = bool(steam_cfg.get("enabled", True))
        csfloat_enabled = bool(csf_cfg.get("enabled", True)) and (usd_to_cad is not None)
        if bool(csf_cfg.get("enabled", True)) and usd_to_cad is None:
            logger.warning("CSFloat Disabled For This Run (Missing USD->CAD FX Rate).")

        failover_cfg = config.get("providers", {}).get("failover", {})
        fail_threshold = int(failover_cfg.get("consecutiveHardFailures", 1))
        cooldown_seconds = float(failover_cfg.get("cooldownSeconds", 120.0))
        fail_threshold = max(1, fail_threshold)
        cooldown_seconds = max(10.0, cooldown_seconds)

        steam_state = ProviderState(name="Steam", enabled=steam_enabled)
        csfloat_state = ProviderState(name="CSFloat", enabled=csfloat_enabled)
        hard_fail_reasons = {"rate_limited", "http_error", "network_error", "unauthorized"}
        provider_order = []
        if steam_enabled:
            provider_order.append("steam")
        if csfloat_enabled:
            provider_order.append("csfloat")
        rr_index = 0

        retries = int(config["api"]["retries"]["maxAttempts"])
        backoff = float(config["api"]["retries"]["backoffSeconds"])
        max_age_hours = float(config["cache"]["maxAgeHours"])
        force = bool(args.force) or bool(config["cache"].get("forceRefresh", False))
        checkpoint_every_items = int(config["cache"].get("checkpointEveryItems", 250))
        checkpoint_every_items = max(0, checkpoint_every_items)

        updated_at = get_updated_at_bucket(prices)

        stats = {
            "cases_total": 0, "cases_updated": 0, "cases_skipped": 0,
            "keys_total": 0, "keys_updated": 0, "keys_skipped": 0,
            "items_total": 0, "items_updated": 0, "items_skipped": 0,
            "steam_ok": 0, "steam_fail": 0,
            "csfloat_ok": 0, "csfloat_fail": 0,
        }

        def fetch_with_fallback(market_hash: str) -> Tuple[Optional[float], Optional[str]]:
            nonlocal rr_index
            if not provider_order:
                return None, None

            start = rr_index % len(provider_order)
            rr_index = (rr_index + 1) % len(provider_order)

            ordered = provider_order[start:] + provider_order[:start]
            for provider in ordered:
                now_ts = time.time()
                if provider == "steam":
                    if not steam_state.is_available(now_ts, logger):
                        continue
                    v, reason = steam.fetch_cad(market_hash, retries=retries, backoff_seconds=backoff)
                    if v is not None:
                        steam_state.record_success()
                        stats["steam_ok"] += 1
                        return v, "Steam"
                    stats["steam_fail"] += 1
                    if reason in hard_fail_reasons:
                        steam_state.record_hard_failure(now_ts, fail_threshold, cooldown_seconds, logger)
                    continue

                if provider == "csfloat":
                    if not csfloat_state.is_available(now_ts, logger):
                        continue
                    if not csfloat_enabled or usd_to_cad is None:
                        continue
                    usd, reason = csfloat.fetch_usd_lowest(market_hash, retries=retries, backoff_seconds=backoff)
                    if usd is None:
                        stats["csfloat_fail"] += 1
                        if reason in hard_fail_reasons:
                            csfloat_state.record_hard_failure(now_ts, fail_threshold, cooldown_seconds, logger)
                        continue
                    csfloat_state.record_success()
                    stats["csfloat_ok"] += 1
                    return money_round(usd * usd_to_cad), "CSFloat"

            return None, None

        # Refresh Cases
        cases = prices.get("cases", {})
        if isinstance(cases, dict):
            total = len(cases)
            if total:
                logger.info(f"Refreshing Cases | Total={total}")
            for cid in list(cases.keys()):
                stats["cases_total"] += 1
                existing = cases.get(cid)
                if not isinstance(existing, (int, float)):
                    continue

                updated_iso = updated_at["cases"].get(cid)
                if not should_refresh(updated_iso, max_age_hours, force):
                    stats["cases_skipped"] += 1
                    continue

                market_hash = overrides["cases"].get(cid) or id_to_case_name.get(cid)
                if not market_hash:
                    logger.warning(f"Case Market Hash Missing: {cid}")
                    stats["cases_skipped"] += 1
                    continue

                new_price, used_provider = fetch_with_fallback(market_hash)
                if new_price is None:
                    stats["cases_skipped"] += 1
                    continue

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Case Price Changed | {cid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    cases[cid] = new_price
                    updated_at["cases"][cid] = utc_now_iso()
                    stats["cases_updated"] += 1
                else:
                    stats["cases_skipped"] += 1
                if stats["cases_total"] % 5 == 0 or stats["cases_total"] == total:
                    logger.info(
                        f"Progress | Cases {stats['cases_total']}/{total} | "
                        f"Updated={stats['cases_updated']} | Skipped={stats['cases_skipped']}"
                    )
        else:
            logger.warning("prices.cases Is Not An Object; Skipping Cases.")

        # Refresh Keys
        keys = prices.get("keys", {})
        if isinstance(keys, dict):
            total = len(keys)
            if total:
                logger.info(f"Refreshing Keys | Total={total}")
            for kid in list(keys.keys()):
                stats["keys_total"] += 1
                existing = keys.get(kid)
                if not isinstance(existing, (int, float)):
                    continue

                updated_iso = updated_at["keys"].get(kid)
                if not should_refresh(updated_iso, max_age_hours, force):
                    stats["keys_skipped"] += 1
                    continue

                # Prefer Overrides, Then Explicit Config Mapping
                market_hash = overrides["keys"].get(kid) or config["providers"]["steam"]["keyMarketHashNames"].get(kid)
                if not market_hash:
                    logger.warning(f"Key Market Hash Missing: {kid}")
                    stats["keys_skipped"] += 1
                    continue

                new_price, used_provider = fetch_with_fallback(market_hash)
                if new_price is None:
                    stats["keys_skipped"] += 1
                    continue

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Key Price Changed | {kid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    keys[kid] = new_price
                    updated_at["keys"][kid] = utc_now_iso()
                    stats["keys_updated"] += 1
                else:
                    stats["keys_skipped"] += 1
                if stats["keys_total"] % 5 == 0 or stats["keys_total"] == total:
                    logger.info(
                        f"Progress | Keys {stats['keys_total']}/{total} | "
                        f"Updated={stats['keys_updated']} | Skipped={stats['keys_skipped']}"
                    )
        else:
            logger.warning("prices.keys Is Not An Object; Skipping Keys.")

        # Refresh Items
        items = prices.get("items", {})
        if isinstance(items, dict):
            item_keys = list(items.keys())

            if args.max_items is not None:
                item_keys = item_keys[: max(0, int(args.max_items))]

            total = len(item_keys)
            if total:
                logger.info(f"Refreshing Items | Total={total}")
            for i, ik in enumerate(item_keys, start=1):
                stats["items_total"] += 1
                existing = items.get(ik)
                if not isinstance(existing, (int, float)):
                    continue

                updated_iso = updated_at["items"].get(ik)
                if not should_refresh(updated_iso, max_age_hours, force):
                    stats["items_skipped"] += 1
                    continue

                # Variant Handling:
                # If Variant != "None", We Require An Override For Correct Steam Market Hash Naming.
                parsed = parse_item_key(ik)
                if not parsed:
                    logger.warning(f"Invalid Item Key Format: {ik}")
                    stats["items_skipped"] += 1
                    continue

                item_id, wear, is_st, variant = parsed
                override_mh = overrides["items"].get(ik)

                if variant and variant.lower() not in ("none", "na", "n/a") and not override_mh:
                    logger.warning(f"Variant Requires Override | {ik} | Variant={variant}")
                    stats["items_skipped"] += 1
                    continue

                display = item_id_to_display.get(item_id)
                if not display and not override_mh:
                    logger.warning(f"Unknown ItemId (No displayName Found): {item_id}")
                    stats["items_skipped"] += 1
                    continue

                market_hash = override_mh or build_item_market_hash(display, wear, is_st)
                new_price, used_provider = fetch_with_fallback(market_hash)
                if new_price is None:
                    stats["items_skipped"] += 1
                    continue

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Item Price Changed | {ik} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    items[ik] = new_price
                    updated_at["items"][ik] = utc_now_iso()
                    stats["items_updated"] += 1
                else:
                    stats["items_skipped"] += 1

                if i % 25 == 0 or i == total:
                    logger.info(f"Progress | Items {i}/{total} | Updated={stats['items_updated']} | Skipped={stats['items_skipped']}")
                if checkpoint_every_items and (i % checkpoint_every_items == 0):
                    checkpoint_save(prices_path, prices, logger)
        else:
            logger.warning("prices.items Is Not An Object; Skipping Items.")

        # Save Or Dry Run
        logger.info(
            "Summary | "
            f"Cases {stats['cases_updated']}/{stats['cases_total']} Updated | "
            f"Keys {stats['keys_updated']}/{stats['keys_total']} Updated | "
            f"Items {stats['items_updated']}/{stats['items_total']} Updated | "
            f"Steam Ok/Fail {stats['steam_ok']}/{stats['steam_fail']} | "
            f"CSFloat Ok/Fail {stats['csfloat_ok']}/{stats['csfloat_fail']}"
        )

        if args.dry_run:
            logger.info("Dry Run Enabled; No Files Were Written.")
            return 0

        # Backup
        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = prices_path + f".backup.{ts}"
        safe_copy(prices_path, backup_path)
        logger.info(f"Backup Created: {backup_path}")

        # Write
        write_json_atomic(prices_path, prices)
        logger.info("prices.json Updated Successfully.")

        # Optional Git Commit
        if config.get("git", {}).get("enabled", False):
            repo_dir = base
            rc, out = run_cmd(["git", "status", "--porcelain"], cwd=repo_dir)
            if rc == 0 and out.strip():
                msg = f"Update Prices {ts}"
                rc2, out2 = run_cmd(["git", "add", config["paths"]["pricesJson"]], cwd=repo_dir)
                rc3, out3 = run_cmd(["git", "commit", "-m", msg], cwd=repo_dir)
                if rc2 == 0 and rc3 == 0:
                    logger.info("Git Commit Created.")
                else:
                    logger.warning("Git Commit Failed.")
                    logger.warning(out2.strip())
                    logger.warning(out3.strip())
            else:
                logger.info("No Git Changes Detected; Skipping Commit.")

        return 0

    except FileNotFoundError as e:
        logger.error(f"File Not Found: {e}")
        return 2
    except json.JSONDecodeError as e:
        logger.error(f"JSON Parse Error: {e}")
        return 2
    except Exception as e:
        logger.error(f"Unhandled Error: {e}")
        logger.error(traceback.format_exc())
        return 1
    finally:
        lock.release()


def daemon_loop(config: Dict[str, Any], args: argparse.Namespace, logger: logging.Logger) -> int:
    sched = config.get("schedule", {})
    enabled = bool(sched.get("enabled", True))
    boot_refresh = bool(sched.get("bootTimeRefresh", True))
    days = sched.get("daysOfWeek", ["sunday"])
    at_time = str(sched.get("time", "03:00"))
    check_every = float(sched.get("checkIntervalSeconds", 30.0))

    if isinstance(days, str):
        days = [days]
    days_norm = {str(d).strip().lower() for d in days if str(d).strip()}
    if not days_norm:
        days_norm = {"sunday"}

    def day_name(dt: _dt.datetime) -> str:
        return dt.strftime("%A").lower()

    last_run_date_key = "lastRunLocalDate"
    state_path = os.path.join(config["paths"]["base"], config["paths"]["daemonStateJson"])

    state = {}
    if os.path.isfile(state_path):
        try:
            state = read_json(state_path)
        except Exception:
            state = {}
    if not isinstance(state, dict):
        state = {}

    def save_state() -> None:
        ensure_dir(os.path.dirname(state_path) or ".")
        write_json_atomic(state_path, state)

    logger.info("Daemon Mode Started.")
    logger.info(f"Schedule Enabled={enabled} | Days={sorted(days_norm)} | Time={at_time} | Check={check_every}s")

    if boot_refresh:
        logger.info("Boot-Time Refresh Enabled; Running Once Now.")
        rc = refresh_once(config, args, logger)
        state[last_run_date_key] = local_now().date().isoformat()
        save_state()
        if rc != 0:
            logger.warning(f"Boot-Time Refresh Finished With ExitCode={rc}")

    if not enabled:
        logger.info("Schedule Disabled; Daemon Will Sleep Indefinitely.")
        while True:
            time.sleep(max(5.0, check_every))

    while True:
        now = local_now()
        dn = day_name(now)
        hhmm = now.strftime("%H:%M")

        should_run_today = dn in days_norm
        already_ran = state.get(last_run_date_key) == now.date().isoformat()

        if should_run_today and (hhmm == at_time) and (not already_ran):
            logger.info("Scheduled Time Matched; Running Refresh.")
            rc = refresh_once(config, args, logger)
            state[last_run_date_key] = now.date().isoformat()
            save_state()
            logger.info(f"Scheduled Refresh Finished With ExitCode={rc}")

        time.sleep(max(5.0, check_every))


def main() -> int:
    ap = argparse.ArgumentParser(description="TCSGO Price Refresh Service")
    ap.add_argument("--config", default="services/price-refresher-config.json", help="Path To Config JSON (Relative To Repo Root)")
    ap.add_argument("--dry-run", action="store_true", help="Fetch Prices But Do Not Write prices.json")
    ap.add_argument("--force", action="store_true", help="Ignore Cache Age And Refresh Everything")
    ap.add_argument("--daemon", action="store_true", help="Run Forever And Execute On Schedule From Config")
    ap.add_argument("--max-items", type=int, default=None, help="Limit Items Processed (Testing)")
    args = ap.parse_args()

    # Resolve Repo Root As Parent Of /services
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))
    cfg_path = os.path.join(repo_root, args.config)

    config = read_json(cfg_path)
    if not isinstance(config, dict):
        print("Config Must Be A JSON Object.", file=sys.stderr)
        return 2

    # Normalize Base Path
    if "paths" not in config or not isinstance(config["paths"], dict):
        print("Config Missing paths.", file=sys.stderr)
        return 2

    base = str(config["paths"].get("base", repo_root))
    config["paths"]["base"] = base

    log_dir = os.path.join(base, config["paths"]["logsDir"])
    logger = configure_logging(
        log_dir=log_dir,
        level=str(config["logging"]["level"]),
        keep_days=int(config["logging"]["rotateAfterDays"]),
        max_files=int(config["logging"]["maxLogFiles"]),
    )

    logger.info("Price Refresher Starting.")
    logger.info(f"Repo Base: {base}")

    # Daemon Or One-Shot
    if args.daemon:
        return daemon_loop(config, args, logger)

    return refresh_once(config, args, logger)


if __name__ == "__main__":
    raise SystemExit(main())
