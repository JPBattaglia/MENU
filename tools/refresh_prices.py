#!/usr/bin/env python3
"""Refresh the prices written into menu-made.com's pages, and nothing else (Nov 6, 2026).

Every price on the site is a <span class="mm-price" data-price-for="CODE" ...>$29/mo</span>. site-catalog.js
fills it live in the browser; this script rewrites only the text inside those spans from
tools/catalog-snapshot.json, so a price shows even before the live call answers.

It replaces the old daily `python3 tools/site_pages.py` step, which rebuilt whole pages from its own templates
and so undid every change made directly to the pages (the Google Ads tag, the Nov 5 navigation, the website
preview form). The pages are now edited directly; never rebuild them with site_pages.py.

Run from the repo root:  python3 tools/refresh_prices.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_snapshot():
    path = ROOT / "tools" / "catalog-snapshot.json"
    return {o["code"]: o for o in json.loads(path.read_text()).get("offers", [])}


def money(cents):
    value = cents / 100
    return f"${value:,.2f}" if value % 1 else f"${value:,.0f}"


def price_text(snapshot, code, interval, bare):
    """Same result as site-catalog.js label() / priceOf(). None if unknown (the span is left as it is)."""
    offer = snapshot.get(code)
    if not offer:
        return None
    pkg = offer.get("menu_package")
    if pkg:
        cents = pkg["setup_cents"] + pkg["hosting_first_year_cents"]
    elif offer.get("prices") is not None:
        cents = offer["prices"].get(interval or "month")
    else:
        cents = offer.get("price_cents")
    if cents is None:
        return None
    if bare or offer.get("prices") is None:
        return money(cents)
    return money(cents) + ("/yr" if interval == "year" else "/mo")


SPAN = re.compile(r'(<span class="mm-price"([^>]*)>)([^<]*)(</span>)')


def refresh(text, snapshot):
    def sub(m):
        attrs = m.group(2)
        code = re.search(r'data-price-for="([A-Z0-9_]+)"', attrs)
        if not code:
            return m.group(0)
        interval = re.search(r'data-price-interval="(month|year)"', attrs)
        value = price_text(snapshot, code.group(1), interval.group(1) if interval else None, "data-price-bare" in attrs)
        return m.group(0) if value is None else f"{m.group(1)}{value}{m.group(4)}"
    return SPAN.sub(sub, text)


def main():
    snapshot = load_snapshot()
    changed = []
    for path in sorted(ROOT.glob("*.html")):
        text = path.read_text()
        new = refresh(text, snapshot)
        if new != text:
            path.write_text(new)
            changed.append(path.name)
    print("prices changed in:", ", ".join(changed) if changed else "nothing")


if __name__ == "__main__":
    main()
