# Subnet Radar

A Flask-based network analysis platform built during a TÜBİTAK BİLGEM internship. Started
as a single-file network scanner and grew into a modular suite of eight tools for
inspecting a local network from a browser.

## Modules

- **IP Radar** — ARP-based device discovery on the local subnet, with MAC vendor lookup
  against the IEEE OUI database.
- **Wi-Fi Radar** — scans nearby Wi-Fi networks via `pywifi`, grouped by SSID with
  expandable rows for individual access points.
- **Bluetooth Radar** — BLE device scanning via `bleak`, with GATT UUID normalization and
  inferred device types; clearly distinguishes reported vs. estimated data.
- **Internet Tools** — WHOIS, DNS lookup, IP geolocation, and SSL certificate checking,
  each with a multi-source fallback chain for reliability on restrictive networks.
- **Speed Test** — real-time ping / jitter / download / upload testing, streamed to the
  browser over Server-Sent Events (SSE) instead of a single blocking response.
- **Network Topology** — a canvas-based, D3-style node/edge graph of the local network.
- **Hotspot Radar** — detects devices connected to a phone/laptop hotspot, filtering out
  broadcast, multicast, and gateway addresses to isolate real clients.
- **Main Menu** — a landing page linking to all modules.

## Architecture

- Started as a monolithic `app.py` + single `index.html`; refactored into:
  - `routes.py` — registers all Flask routes, keeping `app.py` a minimal entry point
  - `utils/` — shared logic per module
  - `templates/` — one template per module
  - `static/css/`, `static/js/` — one stylesheet and script per module, plus a shared base
- A light/dark theme system using CSS custom properties (`:root[data-theme]`), persisted
  in `localStorage`, with an inline FOUC-prevention script so the page never flashes the
  wrong theme on load.

## Tech stack

**Backend:** Python, Flask, Server-Sent Events
**Network access:** `pywifi`, `bleak`, ARP scanning
**Frontend:** vanilla JavaScript, HTML, CSS (per-module, theme-aware)

## Running it

```bash
pip install -r requirements.txt
python app.py
```

Some modules (Wi-Fi/Bluetooth scanning) require running with appropriate OS permissions
for network interface access.

## Notes

- Built and tested primarily on Windows, including workarounds for corporate-device
  restrictions (e.g. disabled Location Services blocking `netsh`-based Wi-Fi scanning).
- `__pycache__/` is currently committed — adding a `.gitignore` would keep the repo clean.
