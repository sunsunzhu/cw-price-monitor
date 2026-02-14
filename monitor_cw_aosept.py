#!/usr/bin/env python3
import json
import os
import re
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

PRODUCT_URL = "https://www.chemistwarehouse.co.nz/buy/141690/aosept-plus-hydraglyde-twin-pack-2-x-360ml"
STATE_FILE = "cw_aosept_price_state.json"
TIMEOUT_SECONDS = 20
MAX_RETRIES = 3
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def fetch_current_price() -> float:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-NZ,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.chemistwarehouse.co.nz/",
        }
    )

    response = None
    for attempt in range(1, MAX_RETRIES + 1):
        response = session.get(PRODUCT_URL, timeout=TIMEOUT_SECONDS)
        if response.status_code != 403:
            break
        if attempt < MAX_RETRIES:
            time.sleep(2 * attempt)

    if response is None:
        raise RuntimeError("No HTTP response received")
    if response.status_code == 403:
        raise RuntimeError(
            "Target site blocked this runtime IP (HTTP 403). "
            "This is common on cloud runners; use another host or browser-based fetching."
        )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    price_node = soup.select_one("span.product__price")
    if price_node is None:
        raise RuntimeError("Could not find price element: span.product__price")

    text = price_node.get_text(strip=True)
    match = re.search(r"([0-9]+(?:\.[0-9]{1,2})?)", text.replace(",", ""))
    if match is None:
        raise RuntimeError(f"Could not parse price from text: {text!r}")

    return float(match.group(1))


def load_state(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_state(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def notify_telegram(message: str) -> None:
    bot_token = os.getenv("TG_BOT_TOKEN")
    chat_id = os.getenv("TG_CHAT_ID")
    if not bot_token or not chat_id:
        print("[notify] TG_BOT_TOKEN or TG_CHAT_ID not set; skip Telegram notification")
        return

    api = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = requests.post(api, json={"chat_id": chat_id, "text": message}, timeout=10)
    resp.raise_for_status()


def main() -> None:
    current_price = fetch_current_price()
    state = load_state(STATE_FILE)
    last_price = state.get("last_price")

    print(f"Current price: NZD ${current_price:.2f}")
    print(f"Last price: {last_price}")

    now_iso = datetime.now(timezone.utc).isoformat()

    if last_price is not None and current_price < float(last_price):
        diff = float(last_price) - current_price
        message = (
            "Chemist Warehouse NZ price drop detected\n"
            f"Product: {PRODUCT_URL}\n"
            f"Previous: NZD ${float(last_price):.2f}\n"
            f"Current: NZD ${current_price:.2f}\n"
            f"Drop: NZD ${diff:.2f}"
        )
        notify_telegram(message)

    state["last_price"] = current_price
    state["updated_at_utc"] = now_iso
    save_state(STATE_FILE, state)


if __name__ == "__main__":
    main()
