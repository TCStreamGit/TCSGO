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
from typing import Any, Dict, Optional, Tuple, List

try:
    import brotli  # type: ignore
    _HAS_BROTLI = True
except Exception:
    brotli = None  # type: ignore
    _HAS_BROTLI = False


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


def validate_prices_schema(prices: Any) -> bool:
    if not isinstance(prices, dict):
        return False
    for k in ("cases", "keys", "items"):
        if k not in prices or not isinstance(prices.get(k), dict):
            return False
    return True


def load_skipped(path: str) -> Dict[str, Dict[str, Dict[str, Any]]]:
    if not path or not os.path.isfile(path):
        return {"cases": {}, "keys": {}, "items": {}}
    try:
        data = read_json(path)
    except Exception:
        return {"cases": {}, "keys": {}, "items": {}}
    if not isinstance(data, dict):
        return {"cases": {}, "keys": {}, "items": {}}
    out: Dict[str, Dict[str, Dict[str, Any]]] = {"cases": {}, "keys": {}, "items": {}}
    for k in ("cases", "keys", "items"):
        v = data.get(k, {})
        if isinstance(v, dict):
            out[k] = {str(kk): vv for kk, vv in v.items() if isinstance(kk, str) and isinstance(vv, dict)}
    return out


def save_skipped(path: str, skipped: Dict[str, Dict[str, Dict[str, Any]]]) -> None:
    write_json_atomic(path, skipped)


def record_skip(
    skipped: Dict[str, Dict[str, Dict[str, Any]]],
    bucket: str,
    key: str,
    reason: str,
) -> None:
    entry = skipped.setdefault(bucket, {}).get(key)
    if not isinstance(entry, dict):
        entry = {"count": 0}
    entry["reason"] = reason
    entry["lastAttemptUtc"] = utc_now_iso()
    entry["count"] = int(entry.get("count", 0)) + 1
    skipped[bucket][key] = entry


def clear_skip(skipped: Dict[str, Dict[str, Dict[str, Any]]], bucket: str, key: str) -> None:
    b = skipped.get(bucket)
    if isinstance(b, dict) and key in b:
        del b[key]


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


def http_get_raw(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        raw = resp.read()
        return status, raw


def http_get_json_brotli(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> Tuple[int, Any]:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        raw = resp.read()
        encoding = (resp.headers.get("Content-Encoding") or "").lower()
        if encoding == "br":
            if not _HAS_BROTLI:
                raise RuntimeError("Brotli Not Installed")
            raw = brotli.decompress(raw)  # type: ignore
        charset = resp.headers.get_content_charset() or "utf-8"
        text = raw.decode(charset, errors="replace")
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


def is_cache_stale(path: str, max_age_hours: float) -> bool:
    if not os.path.isfile(path):
        return True
    try:
        age_seconds = time.time() - os.path.getmtime(path)
    except Exception:
        return True
    return age_seconds >= max(0.0, max_age_hours) * 3600.0


def parse_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except Exception:
            return None
    return None


def aggregate_prices(prices: List[float], method: str) -> Optional[float]:
    if not prices:
        return None
    if method == "median":
        s = sorted(prices)
        mid = len(s) // 2
        if len(s) % 2 == 0:
            return (s[mid - 1] + s[mid]) / 2.0
        return s[mid]
    return sum(prices) / float(len(prices))


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

class SkinportProvider:
    """
    Uses Skinport Bulk Cache (CAD) For Pricing.
    Loads /v1/items And Optional /v1/sales/history Once Per Run.
    """
    def __init__(
        self,
        base_url: str,
        appid: int,
        currency: str,
        tradable: int,
        use_sales_history: bool,
        history_window: str,
        history_field: str,
        timeout: int,
        user_agent: str,
        prices_are_usd: bool,
        usd_to_cad: Optional[float],
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.appid = appid
        self.currency = currency
        self.tradable = tradable
        self.use_sales_history = use_sales_history
        self.history_window = history_window
        self.history_field = history_field
        self.timeout = timeout
        self.user_agent = user_agent
        self.prices_are_usd = prices_are_usd
        self.usd_to_cad = usd_to_cad
        self.items_cache: Dict[str, float] = {}
        self.history_cache: Dict[str, float] = {}

    def _headers(self) -> Dict[str, str]:
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json,text/plain,*/*",
        }
        if _HAS_BROTLI:
            headers["Accept-Encoding"] = "br"
        return headers

    def _parse_price(self, value: Any) -> Optional[float]:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except Exception:
                return None
        return None

    def _extract_item_price(self, item: Dict[str, Any]) -> Optional[float]:
        for key in ("min_price", "suggested_price", "mean_price", "median_price", "last_sale_price", "price"):
            if key in item:
                v = self._parse_price(item.get(key))
                if v is not None:
                    if self.prices_are_usd and self.usd_to_cad:
                        v = v * self.usd_to_cad
                    return v
        return None

    def load_bulk_cache(self, logger: logging.Logger) -> bool:
        if not _HAS_BROTLI:
            logger.warning("Skinport Disabled (Brotli Not Installed).")
            return False

        params = {
            "app_id": str(self.appid),
            "currency": str(self.currency),
            "tradable": str(self.tradable),
        }
        items_url = f"{self.base_url}/items?{urllib.parse.urlencode(params)}"
        logger.info("Loading Skinport Items Cache...")
        try:
            status, data = http_get_json_brotli(items_url, headers=self._headers(), timeout=self.timeout)
            if status != 200 or not isinstance(data, list):
                logger.warning("Skinport Items Cache Failed (Unexpected Response).")
                return False
            items_cache: Dict[str, float] = {}
            for it in data:
                if not isinstance(it, dict):
                    continue
                mh = it.get("market_hash_name")
                if not isinstance(mh, str) or not mh.strip():
                    continue
                price = self._extract_item_price(it)
                if price is None:
                    continue
                items_cache[mh] = money_round(price)
            if not items_cache:
                logger.warning("Skinport Items Cache Empty.")
                return False
            self.items_cache = items_cache
            logger.info(f"Skinport Items Cache Loaded: {len(items_cache)} entries.")
        except Exception as e:
            logger.warning(f"Skinport Items Cache Failed: {e}")
            return False

        if not self.use_sales_history:
            return True

        history_params = {
            "app_id": str(self.appid),
            "currency": str(self.currency),
            "tradable": str(self.tradable),
            "window": str(self.history_window),
        }
        history_url = f"{self.base_url}/sales/history?{urllib.parse.urlencode(history_params)}"
        logger.info("Loading Skinport Sales History Cache...")
        try:
            status, data = http_get_json_brotli(history_url, headers=self._headers(), timeout=self.timeout)
            if status != 200 or not isinstance(data, list):
                logger.warning("Skinport Sales History Cache Failed (Unexpected Response).")
                return True
            history_cache: Dict[str, float] = {}
            for it in data:
                if not isinstance(it, dict):
                    continue
                mh = it.get("market_hash_name")
                if not isinstance(mh, str) or not mh.strip():
                    continue
                v = self._parse_price(it.get(self.history_field))
                if v is None:
                    continue
                history_cache[mh] = money_round(v)
            if history_cache:
                self.history_cache = history_cache
                logger.info(f"Skinport Sales History Cache Loaded: {len(history_cache)} entries.")
        except Exception as e:
            logger.warning(f"Skinport Sales History Cache Failed: {e}")

        return True

    def fetch_cad(self, market_hash_name: str) -> Tuple[Optional[float], str]:
        if self.use_sales_history:
            v = self.history_cache.get(market_hash_name)
            if v is not None:
                return v, "ok"
        v = self.items_cache.get(market_hash_name)
        if v is not None:
            return v, "ok"
        return None, "no_price"


class WhiteMarketBulkProvider:
    def __init__(self, url: str, currency: str, cache_path: str, timeout: int, user_agent: str) -> None:
        self.url = url
        self.currency = currency.upper().strip()
        self.cache_path = cache_path
        self.timeout = timeout
        self.user_agent = user_agent

    def _headers(self) -> Dict[str, str]:
        return {"User-Agent": self.user_agent, "Accept": "application/json,text/plain,*/*"}

    def _load_from_cache(self) -> Optional[Any]:
        try:
            return read_json(self.cache_path)
        except Exception:
            return None

    def _save_cache(self, raw: bytes) -> None:
        ensure_dir(os.path.dirname(self.cache_path) or ".")
        with open(self.cache_path, "wb") as f:
            f.write(raw)

    def load_prices(self, logger: logging.Logger, max_age_hours: float, usd_to_cad: Optional[float]) -> Dict[str, float]:
        if self.currency == "USD" and usd_to_cad is None:
            logger.warning("White.Market Bulk Disabled (Missing USD->CAD FX Rate).")
            return {}
        data = None
        if is_cache_stale(self.cache_path, max_age_hours):
            logger.info("White.Market Bulk Cache Stale; Downloading...")
            try:
                status, raw = http_get_raw(self.url, headers=self._headers(), timeout=self.timeout)
                if status != 200:
                    logger.warning(f"White.Market Bulk Download Failed (Status={status}).")
                else:
                    self._save_cache(raw)
                    data = json.loads(raw.decode("utf-8", errors="replace"))
                    logger.info("White.Market Bulk Cache Updated.")
            except Exception as e:
                logger.warning(f"White.Market Bulk Download Failed: {e}")
        if data is None:
            logger.info("White.Market Bulk Cache Hit.")
            data = self._load_from_cache()
        if not data:
            return {}
        out: Dict[str, float] = {}
        if isinstance(data, list):
            for it in data:
                if not isinstance(it, dict):
                    continue
                mh = it.get("market_hash_name") or it.get("market_hash") or it.get("name")
                price = it.get("price") or it.get("price_usd") or it.get("avg") or it.get("avg_price")
                if isinstance(mh, str):
                    v = parse_float(price)
                    if v is None:
                        continue
                    if self.currency == "USD" and usd_to_cad:
                        v = v * usd_to_cad
                    out[mh] = money_round(v)
        elif isinstance(data, dict):
            items = data.get("items", data)
            if isinstance(items, list):
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    mh = it.get("market_hash_name") or it.get("market_hash") or it.get("name")
                    price = it.get("price") or it.get("price_usd") or it.get("avg") or it.get("avg_price")
                    if isinstance(mh, str):
                        v = parse_float(price)
                        if v is None:
                            continue
                        if self.currency == "USD" and usd_to_cad:
                            v = v * usd_to_cad
                        out[mh] = money_round(v)
            elif isinstance(items, dict):
                for mh, price in items.items():
                    if not isinstance(mh, str):
                        continue
                    v = parse_float(price)
                    if v is None:
                        continue
                    if self.currency == "USD" and usd_to_cad:
                        v = v * usd_to_cad
                    out[mh] = money_round(v)
        return out


class MarketCsgoBulkProvider:
    def __init__(
        self,
        url_prices: str,
        url_class_instance: str,
        mode: str,
        price_field: str,
        currency: str,
        cache_path: str,
        timeout: int,
        user_agent: str,
        api_key: str = "",
    ) -> None:
        self.url_prices = url_prices
        self.url_class_instance = url_class_instance
        self.mode = mode.lower().strip()
        self.price_field = price_field
        self.currency = currency.upper().strip()
        self.cache_path = cache_path
        self.timeout = timeout
        self.user_agent = user_agent
        self.api_key = api_key.strip()

    def _headers(self) -> Dict[str, str]:
        headers = {"User-Agent": self.user_agent, "Accept": "application/json,text/plain,*/*"}
        if self.api_key:
            headers["Authorization"] = self.api_key
        return headers

    def _load_from_cache(self) -> Optional[Any]:
        try:
            return read_json(self.cache_path)
        except Exception:
            return None

    def _save_cache(self, raw: bytes) -> None:
        ensure_dir(os.path.dirname(self.cache_path) or ".")
        with open(self.cache_path, "wb") as f:
            f.write(raw)

    def _select_url(self) -> str:
        if self.mode == "class_instance":
            return self.url_class_instance
        return self.url_prices

    def load_prices(self, logger: logging.Logger, max_age_hours: float, usd_to_cad: Optional[float]) -> Dict[str, float]:
        if self.currency == "USD" and usd_to_cad is None:
            logger.warning("Market.CSGO Bulk Disabled (Missing USD->CAD FX Rate).")
            return {}
        data = None
        if is_cache_stale(self.cache_path, max_age_hours):
            logger.info("Market.CSGO Bulk Cache Stale; Downloading...")
            try:
                status, raw = http_get_raw(self._select_url(), headers=self._headers(), timeout=self.timeout)
                if status != 200:
                    logger.warning(f"Market.CSGO Bulk Download Failed (Status={status}).")
                else:
                    self._save_cache(raw)
                    data = json.loads(raw.decode("utf-8", errors="replace"))
                    logger.info("Market.CSGO Bulk Cache Updated.")
            except Exception as e:
                logger.warning(f"Market.CSGO Bulk Download Failed: {e}")
        if data is None:
            logger.info("Market.CSGO Bulk Cache Hit.")
            data = self._load_from_cache()
        if not data:
            return {}
        out: Dict[str, float] = {}
        items = data.get("items") if isinstance(data, dict) else None
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                mh = it.get("market_hash_name") or it.get("market_hash") or it.get("name")
                price = it.get(self.price_field) or it.get("avg_price") or it.get("price")
                if isinstance(mh, str):
                    v = parse_float(price)
                    if v is None:
                        continue
                    if self.currency == "USD" and usd_to_cad:
                        v = v * usd_to_cad
                    out[mh] = money_round(v)
        elif isinstance(items, dict):
            for mh, it in items.items():
                if not isinstance(mh, str):
                    continue
                if isinstance(it, dict):
                    price = it.get(self.price_field) or it.get("avg_price") or it.get("price")
                else:
                    price = it
                v = parse_float(price)
                if v is None:
                    continue
                if self.currency == "USD" and usd_to_cad:
                    v = v * usd_to_cad
                out[mh] = money_round(v)
        return out


class CsgotraderBulkProvider:
    def __init__(self, url: str, currency: str, cache_path: str, timeout: int, user_agent: str) -> None:
        self.url = url
        self.currency = currency.upper().strip()
        self.cache_path = cache_path
        self.timeout = timeout
        self.user_agent = user_agent

    def _headers(self) -> Dict[str, str]:
        return {"User-Agent": self.user_agent, "Accept": "application/json,text/plain,*/*"}

    def _load_from_cache(self) -> Optional[Any]:
        try:
            return read_json(self.cache_path)
        except Exception:
            return None

    def _save_cache(self, raw: bytes) -> None:
        ensure_dir(os.path.dirname(self.cache_path) or ".")
        with open(self.cache_path, "wb") as f:
            f.write(raw)

    def load_prices(self, logger: logging.Logger, max_age_hours: float, usd_to_cad: Optional[float]) -> Dict[str, float]:
        if self.currency == "USD" and usd_to_cad is None:
            logger.warning("CSGOTrader Bulk Disabled (Missing USD->CAD FX Rate).")
            return {}
        data = None
        if is_cache_stale(self.cache_path, max_age_hours):
            logger.info("CSGOTrader Bulk Cache Stale; Downloading...")
            try:
                status, raw = http_get_raw(self.url, headers=self._headers(), timeout=self.timeout)
                if status != 200:
                    logger.warning(f"CSGOTrader Bulk Download Failed (Status={status}).")
                else:
                    self._save_cache(raw)
                    data = json.loads(raw.decode("utf-8", errors="replace"))
                    logger.info("CSGOTrader Bulk Cache Updated.")
            except Exception as e:
                logger.warning(f"CSGOTrader Bulk Download Failed: {e}")
        if data is None:
            logger.info("CSGOTrader Bulk Cache Hit.")
            data = self._load_from_cache()
        if not data:
            return {}
        out: Dict[str, float] = {}
        items = data.get("items") if isinstance(data, dict) else None
        if isinstance(items, dict):
            for mh, price in items.items():
                if not isinstance(mh, str):
                    continue
                v = parse_float(price)
                if v is None:
                    continue
                if self.currency == "USD" and usd_to_cad:
                    v = v * usd_to_cad
                out[mh] = money_round(v)
        elif isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                mh = it.get("market_hash_name") or it.get("market_hash") or it.get("name")
                price = it.get("price") or it.get("avg_price") or it.get("median")
                if isinstance(mh, str):
                    v = parse_float(price)
                    if v is None:
                        continue
                    if self.currency == "USD" and usd_to_cad:
                        v = v * usd_to_cad
                    out[mh] = money_round(v)
        elif isinstance(data, dict):
            for mh, price in data.items():
                if not isinstance(mh, str):
                    continue
                v = parse_float(price)
                if v is None:
                    continue
                if self.currency == "USD" and usd_to_cad:
                    v = v * usd_to_cad
                out[mh] = money_round(v)
        return out


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
    skip_rounds_remaining: int = 0

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

    def should_skip_round(self) -> bool:
        if self.skip_rounds_remaining > 0:
            self.skip_rounds_remaining -= 1
            return True
        return False

    def record_failure(self, skip_rounds: int) -> None:
        self.skip_rounds_remaining = max(self.skip_rounds_remaining, max(0, skip_rounds))

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

def should_refresh(
    updated_at_iso: Optional[str],
    max_age_hours: float,
    force: bool,
    existing_price: Optional[float] = None,
    force_price_threshold: Optional[float] = None,
) -> bool:
    if force:
        return True
    if force_price_threshold is not None and existing_price is not None:
        if existing_price <= force_price_threshold:
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
    skipped_path = os.path.join(base, config["paths"].get("skippedJson", "services\\price-refresher-skipped.json"))
    bulk_cfg = config.get("providers", {}).get("bulkCache", {})
    bulk_dir = os.path.join(base, str(bulk_cfg.get("dir", "services\\bulk-cache")))

    ensure_dir(os.path.dirname(prices_path))
    ensure_dir(case_odds_dir)
    ensure_dir(logs_dir)
    ensure_dir(os.path.dirname(skipped_path) or ".")
    ensure_dir(bulk_dir)

    lock = SingleInstanceLock(lock_path)
    lock.acquire()
    try:
        # Load Inputs
        prices = read_json(prices_path)
        if not validate_prices_schema(prices):
            logger.error("prices.json Schema Invalid (Missing cases/keys/items). Aborting To Avoid Data Loss.")
            return 2

        overrides = load_overrides(overrides_path)
        skipped = load_skipped(skipped_path)

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

        bulk_cache_max_age = float(bulk_cfg.get("maxAgeHours", 12))
        bulk_timeout = int(bulk_cfg.get("timeoutSeconds", 120))
        bulk_stagger_min = float(bulk_cfg.get("staggerDelaySecondsMin", 2.0))
        bulk_stagger_max = float(bulk_cfg.get("staggerDelaySecondsMax", 6.0))
        if bulk_stagger_max < bulk_stagger_min:
            bulk_stagger_min, bulk_stagger_max = bulk_stagger_max, bulk_stagger_min

        def bulk_sleep() -> None:
            time.sleep(random.uniform(bulk_stagger_min, bulk_stagger_max))

        bulk_sources: List[Tuple[str, Dict[str, float]]] = []
        bulk_source_counts: Dict[str, int] = {}
        white_cfg = config.get("providers", {}).get("white_market", {})
        if bool(white_cfg.get("enabled", False)):
            white_cache = os.path.join(bulk_dir, "white-market-730.json")
            white = WhiteMarketBulkProvider(
                url=str(white_cfg.get("url", "")),
                currency=str(white_cfg.get("currency", "USD")),
                cache_path=white_cache,
                timeout=bulk_timeout,
                user_agent=user_agent,
            )
            bulk_prices = white.load_prices(logger, bulk_cache_max_age, usd_to_cad)
            if bulk_prices:
                bulk_sources.append(("white_market", bulk_prices))
                bulk_source_counts["white_market"] = len(bulk_prices)
            bulk_sleep()

        market_cfg = config.get("providers", {}).get("market_csgo", {})
        market_api_key = ""
        if isinstance(market_cfg, dict):
            env_var = str(market_cfg.get("apiKeyEnvVar", "MARKET_CSGO_API_KEY")).strip() or "MARKET_CSGO_API_KEY"
            market_api_key = str(market_cfg.get("apiKey", "")).strip()
            if not market_api_key:
                v = os.environ.get(env_var, "")
                if isinstance(v, str) and v.strip():
                    market_api_key = v.strip()
        if bool(market_cfg.get("enabled", False)):
            market_cache = os.path.join(bulk_dir, "market-csgo-usd.json")
            market = MarketCsgoBulkProvider(
                url_prices=str(market_cfg.get("urlPrices", "")),
                url_class_instance=str(market_cfg.get("urlClassInstance", "")),
                mode=str(market_cfg.get("mode", "class_instance")),
                price_field=str(market_cfg.get("priceField", "avg_price")),
                currency=str(market_cfg.get("currency", "USD")),
                cache_path=market_cache,
                timeout=bulk_timeout,
                user_agent=user_agent,
                api_key=market_api_key,
            )
            bulk_prices = market.load_prices(logger, bulk_cache_max_age, usd_to_cad)
            if bulk_prices:
                bulk_sources.append(("market_csgo", bulk_prices))
                bulk_source_counts["market_csgo"] = len(bulk_prices)
            bulk_sleep()

        csgotrader_cfg = config.get("providers", {}).get("csgotrader", {})
        if bool(csgotrader_cfg.get("enabled", False)):
            csgotrader_cache = os.path.join(bulk_dir, "csgotrader.json")
            csgotrader = CsgotraderBulkProvider(
                url=str(csgotrader_cfg.get("url", "")),
                currency=str(csgotrader_cfg.get("currency", "USD")),
                cache_path=csgotrader_cache,
                timeout=bulk_timeout,
                user_agent=user_agent,
            )
            bulk_prices = csgotrader.load_prices(logger, bulk_cache_max_age, usd_to_cad)
            if bulk_prices:
                bulk_sources.append(("csgotrader", bulk_prices))
                bulk_source_counts["csgotrader"] = len(bulk_prices)
            bulk_sleep()

        skinport_cfg = config["providers"].get("skinport", {})
        skinport_enabled = bool(skinport_cfg.get("enabled", False))
        skinport_bulk_enabled = bool(skinport_cfg.get("bulkEnabled", False))
        skinport = None
        if skinport_enabled:
            skinport_prices_are_usd = bool(skinport_cfg.get("pricesAreUsd", False))
            if skinport_prices_are_usd and usd_to_cad is None:
                logger.warning("Skinport USD Conversion Enabled But FX Rate Missing.")
            skinport = SkinportProvider(
                base_url=str(skinport_cfg.get("baseUrl", "https://api.skinport.com/v1")),
                appid=int(skinport_cfg.get("appid", 730)),
                currency=str(skinport_cfg.get("currency", "CAD")),
                tradable=int(skinport_cfg.get("tradable", 0)),
                use_sales_history=bool(skinport_cfg.get("useSalesHistory", False)),
                history_window=str(skinport_cfg.get("historyWindow", "last_7_days")),
                history_field=str(skinport_cfg.get("historyField", "median")),
                timeout=int(skinport_cfg.get("timeoutSeconds", 180)),
                user_agent=user_agent,
                prices_are_usd=skinport_prices_are_usd,
                usd_to_cad=usd_to_cad,
            )
            skinport_enabled = skinport.load_bulk_cache(logger)
            if skinport_enabled and skinport_bulk_enabled:
                skinport_bulk = dict(skinport.items_cache)
                if skinport.use_sales_history and skinport.history_cache:
                    skinport_bulk.update(skinport.history_cache)
                if skinport_bulk:
                    bulk_sources.append(("skinport", skinport_bulk))
                    bulk_source_counts["skinport"] = len(skinport_bulk)

        if bulk_source_counts:
            logger.info(
                "Bulk Sources Loaded | "
                + " | ".join(f"{k}={v}" for k, v in bulk_source_counts.items())
            )
        else:
            logger.warning("Bulk Sources Loaded | None (Will Use Per-Item Providers).")

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
                logger.info("CSFloat API Key Loaded From Secrets.")

        if not api_key:
            v = os.environ.get(env_var, "")
            if isinstance(v, str) and v.strip():
                api_key = v.strip()
                logger.info(f"CSFloat API Key Loaded From Env: {env_var}.")

        cfg_key = str(csf_cfg.get("apiKey", "")).strip()
        if cfg_key:
            logger.warning("CSFloat Api Key Is Present In Config. Move It To Secrets Or Env To Avoid Git Leaks.")
            if not api_key:
                api_key = cfg_key
                logger.info("CSFloat API Key Loaded From Config.")

        if api_key:
            logger.info("CSFloat API Key Loaded.")
        else:
            logger.warning("CSFloat API Key Missing (Public Access Only).")

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
        rotation_mode = str(config.get("providers", {}).get("rotationMode", "round_robin")).strip().lower()
        fallback_on_failure = bool(config.get("providers", {}).get("fallbackOnFailure", True))
        skip_rounds_on_failure = int(config.get("providers", {}).get("skipRoundsOnFailure", 10))
        skip_rounds_on_failure = max(0, skip_rounds_on_failure)
        item_delay_min = float(config.get("providers", {}).get("itemDelaySecondsMin", 3.0))
        item_delay_max = float(config.get("providers", {}).get("itemDelaySecondsMax", 5.0))
        if item_delay_max < item_delay_min:
            item_delay_min, item_delay_max = item_delay_max, item_delay_min

        csfloat_use_cases = bool(csf_cfg.get("useForCases", False))
        csfloat_use_keys = bool(csf_cfg.get("useForKeys", False))
        csfloat_use_items = bool(csf_cfg.get("useForItems", True))

        skinport_state = ProviderState(name="Skinport", enabled=skinport_enabled)
        steam_state = ProviderState(name="Steam", enabled=steam_enabled)
        csfloat_state = ProviderState(name="CSFloat", enabled=csfloat_enabled)
        hard_fail_reasons = {"rate_limited", "http_error", "network_error", "unauthorized"}
        provider_order = []
        if skinport_enabled:
            provider_order.append("skinport")
        if steam_enabled:
            provider_order.append("steam")
        if csfloat_enabled:
            provider_order.append("csfloat")
        rr_index = 0

        retries = int(config["api"]["retries"]["maxAttempts"])
        backoff = float(config["api"]["retries"]["backoffSeconds"])
        max_age_days = config.get("cache", {}).get("maxAgeDays", None)
        if max_age_days is not None:
            max_age_hours = float(max_age_days) * 24.0
        else:
            max_age_hours = float(config["cache"]["maxAgeHours"])
        max_age_hours = max(0.0, max_age_hours)
        force = bool(args.force) or bool(config["cache"].get("forceRefresh", False))
        checkpoint_every_items = int(config["cache"].get("checkpointEveryItems", 250))
        checkpoint_every_items = max(0, checkpoint_every_items)
        force_price_threshold = config.get("cache", {}).get("alwaysRefreshPriceAtOrBelow", None)
        if force_price_threshold is not None:
            force_price_threshold = float(force_price_threshold)

        updated_at = get_updated_at_bucket(prices)

        stats = {
            "cases_total": 0, "cases_updated": 0, "cases_skipped": 0,
            "keys_total": 0, "keys_updated": 0, "keys_skipped": 0,
            "items_total": 0, "items_updated": 0, "items_skipped": 0,
            "cases_unchanged": 0, "keys_unchanged": 0, "items_unchanged": 0,
            "bulk_used_cases": 0, "bulk_used_keys": 0, "bulk_used_items": 0,
            "bulk_missing_cases": 0, "bulk_missing_keys": 0, "bulk_missing_items": 0,
            "skinport_ok": 0, "skinport_fail": 0,
            "steam_ok": 0, "steam_fail": 0,
            "csfloat_ok": 0, "csfloat_fail": 0,
        }

        agg_cfg = config.get("providers", {}).get("aggregator", {})
        agg_method = str(agg_cfg.get("method", "mean")).strip().lower()
        agg_min_sources = int(agg_cfg.get("minSources", 2))
        agg_min_sources = max(1, agg_min_sources)
        agg_clamp_min = float(agg_cfg.get("outlierClampCadMin", 0.01))
        agg_clamp_max = float(agg_cfg.get("outlierClampCadMax", 99999.99))

        variant_cfg = config.get("providers", {}).get("variantHandling", {})
        allow_souvenir_auto = bool(variant_cfg.get("allowSouvenirAuto", True))
        souvenir_prefix = str(variant_cfg.get("souvenirPrefix", "Souvenir "))

        def bulk_price_for(market_hash: str) -> Tuple[Optional[float], int]:
            vals = []
            for _, source_prices in bulk_sources:
                v = source_prices.get(market_hash)
                if isinstance(v, (int, float)):
                    vals.append(float(v))
            if len(vals) < agg_min_sources:
                return None, len(vals)
            agg = aggregate_prices(vals, agg_method)
            if agg is None:
                return None, len(vals)
            agg = clamp(agg, agg_clamp_min, agg_clamp_max)
            return money_round(agg), len(vals)

        retry_skipped_only = bool(getattr(args, "retry_skipped", False))
        if retry_skipped_only:
            total_skipped = (
                len(skipped.get("cases", {}))
                + len(skipped.get("keys", {}))
                + len(skipped.get("items", {}))
            )
            if total_skipped == 0:
                logger.info("Retry-Skipped Mode: No Skipped Entries Found.")
                return 0

        def fetch_with_fallback(
            market_hash: str,
            item_type: str,
            preferred_order: Optional[List[str]] = None,
        ) -> Tuple[Optional[float], Optional[str], Optional[str]]:
            nonlocal rr_index
            if not provider_order:
                return None, None, "no_provider"

            if preferred_order:
                ordered = [p for p in preferred_order if p in provider_order]
            else:
                if rotation_mode == "fixed":
                    start = 0
                else:
                    start = rr_index % len(provider_order)
                    rr_index = (rr_index + 1) % len(provider_order)
                ordered = provider_order[start:] + provider_order[:start]
                if not fallback_on_failure:
                    ordered = ordered[:1]

            attempts_per_provider = 1 if len(ordered) > 1 else retries
            last_reason = None
            for provider in ordered:
                now_ts = time.time()
                if provider == "skinport":
                    if not skinport_state.is_available(now_ts, logger):
                        last_reason = "skinport_unavailable"
                        continue
                    if skinport_state.should_skip_round():
                        last_reason = "skinport_skipped"
                        continue
                    if not skinport_enabled or skinport is None:
                        last_reason = "skinport_disabled"
                        continue
                    v, reason = skinport.fetch_cad(market_hash)
                    if v is not None:
                        stats["skinport_ok"] += 1
                        return v, "Skinport", "ok"
                    stats["skinport_fail"] += 1
                    skinport_state.record_failure(skip_rounds_on_failure)
                    last_reason = f"skinport_{reason}"
                    continue
                if provider == "steam":
                    if not steam_state.is_available(now_ts, logger):
                        last_reason = "steam_unavailable"
                        continue
                    if steam_state.should_skip_round():
                        last_reason = "steam_skipped"
                        continue
                    v, reason = steam.fetch_cad(market_hash, retries=attempts_per_provider, backoff_seconds=backoff)
                    if v is not None:
                        steam_state.record_success()
                        stats["steam_ok"] += 1
                        return v, "Steam", "ok"
                    stats["steam_fail"] += 1
                    steam_state.record_failure(skip_rounds_on_failure)
                    if reason in hard_fail_reasons:
                        steam_state.record_hard_failure(now_ts, fail_threshold, cooldown_seconds, logger)
                    last_reason = f"steam_{reason}"
                    continue

                if provider == "csfloat":
                    if not csfloat_state.is_available(now_ts, logger):
                        last_reason = "csfloat_unavailable"
                        continue
                    if csfloat_state.should_skip_round():
                        last_reason = "csfloat_skipped"
                        continue
                    if not csfloat_enabled or usd_to_cad is None:
                        last_reason = "csfloat_disabled"
                        continue
                    if item_type == "cases" and not csfloat_use_cases:
                        last_reason = "csfloat_disabled_cases"
                        continue
                    if item_type == "keys" and not csfloat_use_keys:
                        last_reason = "csfloat_disabled_keys"
                        continue
                    if item_type == "items" and not csfloat_use_items:
                        last_reason = "csfloat_disabled_items"
                        continue
                    usd, reason = csfloat.fetch_usd_lowest(market_hash, retries=attempts_per_provider, backoff_seconds=backoff)
                    if usd is None:
                        stats["csfloat_fail"] += 1
                        if reason == "no_price":
                            logger.info("CSFloat No Price For Item; Falling Back.")
                        csfloat_state.record_failure(skip_rounds_on_failure)
                        if reason in hard_fail_reasons:
                            csfloat_state.record_hard_failure(now_ts, fail_threshold, cooldown_seconds, logger)
                        last_reason = f"csfloat_{reason}"
                        continue
                    csfloat_state.record_success()
                    stats["csfloat_ok"] += 1
                    return money_round(usd * usd_to_cad), "CSFloat", "ok"

            return None, None, last_reason or "no_provider"

        # Refresh Cases
        cases = prices.get("cases", {})
        if isinstance(cases, dict):
            case_ids = list(cases.keys())
            if retry_skipped_only:
                case_ids = list(skipped.get("cases", {}).keys())
            case_fallback: List[Tuple[str, str]] = []
            total = len(case_ids)
            if total:
                logger.info(f"Refreshing Cases | Total={total}")
            for cid in case_ids:
                stats["cases_total"] += 1
                existing = cases.get(cid)
                if not isinstance(existing, (int, float)):
                    record_skip(skipped, "cases", cid, "missing_in_prices")
                    continue

                updated_iso = updated_at["cases"].get(cid)
                if not retry_skipped_only and not should_refresh(
                    updated_iso,
                    max_age_hours,
                    force,
                    existing_price=float(existing),
                    force_price_threshold=force_price_threshold,
                ):
                    stats["cases_skipped"] += 1
                    continue

                market_hash = overrides["cases"].get(cid) or id_to_case_name.get(cid)
                if not market_hash:
                    logger.warning(f"Case Market Hash Missing: {cid}")
                    record_skip(skipped, "cases", cid, "missing_market_hash")
                    stats["cases_skipped"] += 1
                    continue

                bulk_price, bulk_count = bulk_price_for(market_hash)
                if bulk_price is not None:
                    logger.info(f"Bulk Price Used | {cid} | Sources={bulk_count} | Price={bulk_price:.2f}")
                    stats["bulk_used_cases"] += 1
                    new_price = bulk_price
                    used_provider = f"Bulk[{bulk_count}]"
                    reason = "ok"
                else:
                    logger.info(f"Bulk Missing | {cid} | Sources={bulk_count} | Falling Back")
                    stats["bulk_missing_cases"] += 1
                    case_fallback.append((cid, market_hash))
                    continue
                if new_price is None:
                    record_skip(skipped, "cases", cid, reason or "provider_failed")
                    stats["cases_skipped"] += 1
                    continue
                clear_skip(skipped, "cases", cid)

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Case Price Changed | {cid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    cases[cid] = new_price
                    updated_at["cases"][cid] = utc_now_iso()
                    stats["cases_updated"] += 1
                else:
                    updated_at["cases"][cid] = utc_now_iso()
                    stats["cases_unchanged"] += 1
                    stats["cases_skipped"] += 1
                if stats["cases_total"] % 5 == 0 or stats["cases_total"] == total:
                    logger.info(
                        f"Progress | Cases {stats['cases_total']}/{total} | "
                        f"Updated={stats['cases_updated']} | Skipped={stats['cases_skipped']} | "
                        f"Providers S/Sf/Cf {stats['skinport_ok']}/{stats['skinport_fail']} "
                        f"{stats['steam_ok']}/{stats['steam_fail']} {stats['csfloat_ok']}/{stats['csfloat_fail']}"
                    )
            if case_fallback:
                total_fb = len(case_fallback)
                logger.info(f"Fallback Pass | Cases {total_fb}")
                for idx, (cid, market_hash) in enumerate(case_fallback, start=1):
                    existing = cases.get(cid)
                    if not isinstance(existing, (int, float)):
                        record_skip(skipped, "cases", cid, "missing_in_prices")
                        stats["cases_skipped"] += 1
                        continue
                    time.sleep(random.uniform(item_delay_min, item_delay_max))
                    new_price, used_provider, reason = fetch_with_fallback(
                        market_hash,
                        "cases",
                        preferred_order=["skinport", "csfloat", "steam"],
                    )
                    if new_price is None:
                        record_skip(skipped, "cases", cid, reason or "provider_failed")
                        stats["cases_skipped"] += 1
                        continue
                    clear_skip(skipped, "cases", cid)
                    if abs(float(existing) - new_price) >= 0.01:
                        provider_tag = f" | Provider={used_provider}" if used_provider else ""
                        logger.info(f"Case Price Changed | {cid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                        cases[cid] = new_price
                        updated_at["cases"][cid] = utc_now_iso()
                        stats["cases_updated"] += 1
                    else:
                        updated_at["cases"][cid] = utc_now_iso()
                        stats["cases_unchanged"] += 1
                        stats["cases_skipped"] += 1
                    if idx % 5 == 0 or idx == total_fb:
                        logger.info(
                            f"Fallback Progress | Cases {idx}/{total_fb} | "
                            f"Updated={stats['cases_updated']} | Skipped={stats['cases_skipped']}"
                        )
        else:
            logger.warning("prices.cases Is Not An Object; Skipping Cases.")

        # Refresh Keys
        keys = prices.get("keys", {})
        if isinstance(keys, dict):
            key_ids = list(keys.keys())
            if retry_skipped_only:
                key_ids = list(skipped.get("keys", {}).keys())
            key_fallback: List[Tuple[str, str]] = []
            total = len(key_ids)
            if total:
                logger.info(f"Refreshing Keys | Total={total}")
            for kid in key_ids:
                stats["keys_total"] += 1
                existing = keys.get(kid)
                if not isinstance(existing, (int, float)):
                    record_skip(skipped, "keys", kid, "missing_in_prices")
                    continue

                updated_iso = updated_at["keys"].get(kid)
                if not retry_skipped_only and not should_refresh(
                    updated_iso,
                    max_age_hours,
                    force,
                    existing_price=float(existing),
                    force_price_threshold=force_price_threshold,
                ):
                    stats["keys_skipped"] += 1
                    continue

                # Prefer Overrides, Then Explicit Config Mapping
                market_hash = overrides["keys"].get(kid) or config["providers"]["steam"]["keyMarketHashNames"].get(kid)
                if not market_hash:
                    logger.warning(f"Key Market Hash Missing: {kid}")
                    record_skip(skipped, "keys", kid, "missing_market_hash")
                    stats["keys_skipped"] += 1
                    continue

                bulk_price, bulk_count = bulk_price_for(market_hash)
                if bulk_price is not None:
                    logger.info(f"Bulk Price Used | {kid} | Sources={bulk_count} | Price={bulk_price:.2f}")
                    stats["bulk_used_keys"] += 1
                    new_price = bulk_price
                    used_provider = f"Bulk[{bulk_count}]"
                    reason = "ok"
                else:
                    logger.info(f"Bulk Missing | {kid} | Sources={bulk_count} | Falling Back")
                    stats["bulk_missing_keys"] += 1
                    key_fallback.append((kid, market_hash))
                    continue
                if new_price is None:
                    record_skip(skipped, "keys", kid, reason or "provider_failed")
                    stats["keys_skipped"] += 1
                    continue
                clear_skip(skipped, "keys", kid)

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Key Price Changed | {kid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    keys[kid] = new_price
                    updated_at["keys"][kid] = utc_now_iso()
                    stats["keys_updated"] += 1
                else:
                    updated_at["keys"][kid] = utc_now_iso()
                    stats["keys_unchanged"] += 1
                    stats["keys_skipped"] += 1
                if stats["keys_total"] % 5 == 0 or stats["keys_total"] == total:
                    logger.info(
                        f"Progress | Keys {stats['keys_total']}/{total} | "
                        f"Updated={stats['keys_updated']} | Skipped={stats['keys_skipped']} | "
                        f"Providers S/Sf/Cf {stats['skinport_ok']}/{stats['skinport_fail']} "
                        f"{stats['steam_ok']}/{stats['steam_fail']} {stats['csfloat_ok']}/{stats['csfloat_fail']}"
                    )
            if key_fallback:
                total_fb = len(key_fallback)
                logger.info(f"Fallback Pass | Keys {total_fb}")
                for idx, (kid, market_hash) in enumerate(key_fallback, start=1):
                    existing = keys.get(kid)
                    if not isinstance(existing, (int, float)):
                        record_skip(skipped, "keys", kid, "missing_in_prices")
                        stats["keys_skipped"] += 1
                        continue
                    time.sleep(random.uniform(item_delay_min, item_delay_max))
                    new_price, used_provider, reason = fetch_with_fallback(
                        market_hash,
                        "keys",
                        preferred_order=["skinport", "csfloat", "steam"],
                    )
                    if new_price is None:
                        record_skip(skipped, "keys", kid, reason or "provider_failed")
                        stats["keys_skipped"] += 1
                        continue
                    clear_skip(skipped, "keys", kid)
                    if abs(float(existing) - new_price) >= 0.01:
                        provider_tag = f" | Provider={used_provider}" if used_provider else ""
                        logger.info(f"Key Price Changed | {kid} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                        keys[kid] = new_price
                        updated_at["keys"][kid] = utc_now_iso()
                        stats["keys_updated"] += 1
                    else:
                        updated_at["keys"][kid] = utc_now_iso()
                        stats["keys_unchanged"] += 1
                        stats["keys_skipped"] += 1
                    if idx % 5 == 0 or idx == total_fb:
                        logger.info(
                            f"Fallback Progress | Keys {idx}/{total_fb} | "
                            f"Updated={stats['keys_updated']} | Skipped={stats['keys_skipped']}"
                        )
        else:
            logger.warning("prices.keys Is Not An Object; Skipping Keys.")

        # Refresh Items
        items = prices.get("items", {})
        if isinstance(items, dict):
            item_keys = list(items.keys())
            if retry_skipped_only:
                item_keys = list(skipped.get("items", {}).keys())

            if args.max_items is not None:
                item_keys = item_keys[: max(0, int(args.max_items))]

            items_fallback: List[Tuple[str, str]] = []
            total = len(item_keys)
            if total:
                logger.info(f"Refreshing Items | Total={total}")
            for i, ik in enumerate(item_keys, start=1):
                stats["items_total"] += 1
                existing = items.get(ik)
                if not isinstance(existing, (int, float)):
                    record_skip(skipped, "items", ik, "missing_in_prices")
                    continue

                updated_iso = updated_at["items"].get(ik)
                if not retry_skipped_only and not should_refresh(
                    updated_iso,
                    max_age_hours,
                    force,
                    existing_price=float(existing),
                    force_price_threshold=force_price_threshold,
                ):
                    stats["items_skipped"] += 1
                    continue

                # Variant Handling:
                # If Variant != "None", We Require An Override For Correct Steam Market Hash Naming.
                parsed = parse_item_key(ik)
                if not parsed:
                    logger.warning(f"Invalid Item Key Format: {ik}")
                    record_skip(skipped, "items", ik, "invalid_item_key")
                    stats["items_skipped"] += 1
                    continue

                item_id, wear, is_st, variant = parsed
                override_mh = overrides["items"].get(ik)
                variant_norm = variant.lower()
                auto_variant_prefix = ""
                if variant and variant_norm not in ("none", "na", "n/a") and not override_mh:
                    if allow_souvenir_auto and variant_norm == "souvenir":
                        auto_variant_prefix = souvenir_prefix
                    else:
                        logger.warning(f"Variant Requires Override | {ik} | Variant={variant}")
                        record_skip(skipped, "items", ik, "variant_requires_override")
                        stats["items_skipped"] += 1
                        continue

                display = item_id_to_display.get(item_id)
                if not display and not override_mh:
                    logger.warning(f"Unknown ItemId (No displayName Found): {item_id}")
                    record_skip(skipped, "items", ik, "unknown_item_id")
                    stats["items_skipped"] += 1
                    continue

                market_hash = override_mh or build_item_market_hash(display, wear, is_st)
                if auto_variant_prefix:
                    if not market_hash.lower().startswith(auto_variant_prefix.lower()):
                        market_hash = f"{auto_variant_prefix}{market_hash}"
                bulk_price, bulk_count = bulk_price_for(market_hash)
                if bulk_price is not None:
                    logger.info(f"Bulk Price Used | {ik} | Sources={bulk_count} | Price={bulk_price:.2f}")
                    stats["bulk_used_items"] += 1
                    new_price = bulk_price
                    used_provider = f"Bulk[{bulk_count}]"
                    reason = "ok"
                else:
                    logger.info(f"Bulk Missing | {ik} | Sources={bulk_count} | Falling Back")
                    stats["bulk_missing_items"] += 1
                    items_fallback.append((ik, market_hash))
                    continue
                if new_price is None:
                    record_skip(skipped, "items", ik, reason or "provider_failed")
                    stats["items_skipped"] += 1
                    continue
                clear_skip(skipped, "items", ik)

                if abs(float(existing) - new_price) >= 0.01:
                    provider_tag = f" | Provider={used_provider}" if used_provider else ""
                    logger.info(f"Item Price Changed | {ik} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                    items[ik] = new_price
                    updated_at["items"][ik] = utc_now_iso()
                    stats["items_updated"] += 1
                else:
                    updated_at["items"][ik] = utc_now_iso()
                    stats["items_unchanged"] += 1
                    stats["items_skipped"] += 1

                if i % 25 == 0 or i == total:
                    logger.info(
                        f"Progress | Items {i}/{total} | Updated={stats['items_updated']} | "
                        f"Skipped={stats['items_skipped']} | Providers S/Sf/Cf "
                        f"{stats['skinport_ok']}/{stats['skinport_fail']} "
                        f"{stats['steam_ok']}/{stats['steam_fail']} {stats['csfloat_ok']}/{stats['csfloat_fail']}"
                    )
                if checkpoint_every_items and (i % checkpoint_every_items == 0):
                    checkpoint_save(prices_path, prices, logger)
            if items_fallback:
                total_fb = len(items_fallback)
                logger.info(f"Fallback Pass | Items {total_fb}")
                for idx, (ik, market_hash) in enumerate(items_fallback, start=1):
                    existing = items.get(ik)
                    if not isinstance(existing, (int, float)):
                        record_skip(skipped, "items", ik, "missing_in_prices")
                        stats["items_skipped"] += 1
                        continue
                    time.sleep(random.uniform(item_delay_min, item_delay_max))
                    new_price, used_provider, reason = fetch_with_fallback(
                        market_hash,
                        "items",
                        preferred_order=["skinport", "csfloat", "steam"],
                    )
                    if new_price is None:
                        record_skip(skipped, "items", ik, reason or "provider_failed")
                        stats["items_skipped"] += 1
                        continue
                    clear_skip(skipped, "items", ik)
                    if abs(float(existing) - new_price) >= 0.01:
                        provider_tag = f" | Provider={used_provider}" if used_provider else ""
                        logger.info(f"Item Price Changed | {ik} | {existing:.2f} -> {new_price:.2f}{provider_tag}")
                        items[ik] = new_price
                        updated_at["items"][ik] = utc_now_iso()
                        stats["items_updated"] += 1
                    else:
                        updated_at["items"][ik] = utc_now_iso()
                        stats["items_unchanged"] += 1
                        stats["items_skipped"] += 1
                    if idx % 25 == 0 or idx == total_fb:
                        logger.info(
                            f"Fallback Progress | Items {idx}/{total_fb} | Updated={stats['items_updated']} | "
                            f"Skipped={stats['items_skipped']}"
                        )
                    if checkpoint_every_items and (idx % checkpoint_every_items == 0):
                        checkpoint_save(prices_path, prices, logger)
        else:
            logger.warning("prices.items Is Not An Object; Skipping Items.")

        # Save Or Dry Run
        logger.info(
            "Summary | "
            f"Cases {stats['cases_updated']}/{stats['cases_total']} Updated | "
            f"Keys {stats['keys_updated']}/{stats['keys_total']} Updated | "
            f"Items {stats['items_updated']}/{stats['items_total']} Updated | "
            f"Unchanged C/K/I {stats['cases_unchanged']}/{stats['keys_unchanged']}/{stats['items_unchanged']} | "
            f"Bulk Used C/K/I {stats['bulk_used_cases']}/{stats['bulk_used_keys']}/{stats['bulk_used_items']} | "
            f"Bulk Missing C/K/I {stats['bulk_missing_cases']}/{stats['bulk_missing_keys']}/{stats['bulk_missing_items']} | "
            f"Skinport Ok/Fail {stats['skinport_ok']}/{stats['skinport_fail']} | "
            f"Steam Ok/Fail {stats['steam_ok']}/{stats['steam_fail']} | "
            f"CSFloat Ok/Fail {stats['csfloat_ok']}/{stats['csfloat_fail']}"
        )

        if args.dry_run:
            logger.info("Dry Run Enabled; No Files Were Written.")
            return 0

        save_skipped(skipped_path, skipped)
        logger.info(f"Skipped Log Updated: {skipped_path}")

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
    ap.add_argument("--retry-skipped", action="store_true", help="Only Retry Entries In The Skipped Log")
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
