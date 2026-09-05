# Subnet Radar

**Subnet Radar** is a Flask-based network analysis and diagnostics platform that brings together local network discovery, wireless auditing, Bluetooth scanning, internet reconnaissance tools, speed testing, topology visualization, and hotspot monitoring — all in a single, unified web interface with a modular architecture and light/dark theme support.

This project was developed as part of a summer internship at **TÜBİTAK BİLGEM**.

---

## Overview

Subnet Radar started as a simple ARP-based network scanner and evolved into an eight-module diagnostic suite. Each module is self-contained (its own backend service, HTML template, CSS, and JS file) and plugs into a shared Flask app shell with a common navigation, theming system, and design language.

---

## Modules

### 🔴 IP Radar
Deep subnet scanning and device fingerprinting.
- ARP sweep (via Scapy) to discover all active devices on the local subnet
- Multi-threaded TCP connect scanning against common ports (21, 22, 23, 139, 445, 3389, etc.)
- MAC vendor lookup (IEEE OUI database) with local cache fallback
- Heuristic device classification (Windows / Android / iOS / router / printer / camera / VM / IoT) based on hostname, vendor, and TTL
- Per-device latency measurement
- Multi-field live filtering (IP, hostname, MAC, vendor, security status, device type)
- PDF report export (jsPDF + AutoTable)

### 🟢 Wi-Fi Radar
Over-the-air wireless network auditing.
- Nearby Wi-Fi network scanning via `pywifi` (bypasses `netsh`/Location Services restrictions on locked-down Windows machines)
- SSID decoding with multi-codec fallback (UTF-8 → cp1254 → Latin-1) to fix Turkish character corruption
- Security protocol detection (Open, WPA/WPA2 Personal & Enterprise, WPA3/Unknown) from AKM data
- Frequency → channel/band resolution (2.4 GHz / 5 GHz / 6 GHz)
- Automatic grouping of multiple access points sharing the same SSID, with expandable/collapsible rows
- Async data loading via Fetch API, on-demand PDF export

### 🔵 Bluetooth Radar
BLE (Bluetooth Low Energy) device discovery.
- Async BLE advertisement scanning via `bleak`
- RSSI-based distance categorization (threshold model)
- Manufacturer identification from Bluetooth SIG company IDs
- Device type inference from advertised GATT service UUIDs, with special-case parsing of Apple Continuity protocol packets (AirPods, AirTag, iPhone/iPad, iBeacon)
- Every field is explicitly tagged as **known** (reported by the device) or **inferred** (best-effort guess) so real data is never confused with a heuristic
- On-demand PDF export

### 🟣 Internet Tools
Domain and IP reconnaissance, no API key required.
- **WHOIS** — raw port-43 WHOIS query with automatic RDAP fallback for TLDs/registrars that don't respond
- **DNS Lookup** — resolves A, AAAA, MX, NS, TXT, CNAME, SOA, SRV, CAA, and PTR records; falls back from the system resolver to public resolvers (Cloudflare 1.1.1.1, Google 8.8.8.8) to work around restrictive corporate DNS
- **IP Geolocation** — country, city, ISP/ASN, and coordinates via a multi-provider fallback chain (ip-api.com → ipwho.is), with automatic system proxy detection
- **SSL Checker** — TLS handshake inspection: certificate expiry, issuer/CA, and Subject Alternative Names

### 🟠 Speed Test
Connection performance benchmarking.
- Download/upload throughput and ping via `speedtest-cli`, with automatic best-server selection
- Real jitter calculation from consecutive HTTP round-trip measurements (mean absolute deviation), rather than an estimated/simulated value
- Animated gauge rendered on HTML5 Canvas
- Persistent test history (JSON-backed, last 50 runs) for run-over-run comparison

### 🟦 Network Topology
Visual network mapping.
- Reuses IP Radar's ARP scan results (no duplicate scanning) to build a star-topology graph
- Gateway/router auto-detected as the central node
- Canvas-based radar-style rendering of nodes and connections

### 🟡 Hotspot Radar
Monitoring clients connected to the host machine's Mobile Hotspot / ICS.
- Detects the active hotspot interface (`192.168.137.0/24`)
- Active ping sweep to force devices into the ARP cache, followed by ARP table parsing
- Filters out broadcast/multicast noise (`.255` addresses, `224.0.0.0/4`–`239.255.255.255` range, `FF:FF:FF:FF:FF:FF`, `01:00:5E` multicast MAC prefix) so only real clients are listed

### 🏠 Main Menu
Landing page with module cards, live system status (hostname/IP), and unified navigation.

---

## Cross-Cutting Features

- **Light / Dark theme** — CSS custom properties with `localStorage` persistence and a flash-of-unstyled-content prevention script
- **Consistent module identity** — each module has its own accent color (IP red, Wi-Fi green, Bluetooth cyan, Internet Tools purple, Speed Test orange, Topology indigo, Hotspot amber, Main Menu fuchsia)
- **PDF reporting** — IP Radar, Wi-Fi Radar, and Bluetooth Radar all support exporting scan results as styled PDF reports (jsPDF + AutoTable), loaded on demand to avoid slowing down initial page load
- **Corporate-network resilience** — WHOIS/DNS/geolocation/SSL tools all include fallback chains specifically designed to keep working behind restrictive institutional firewalls, proxies, and SSL-inspection middleboxes

---

## Tech Stack

**Backend:** Python, Flask, Scapy, `pywifi`, `bleak`, `speedtest-cli`, `dnspython`, `mac-vendor-lookup`, `psutil`, `netifaces`

**Frontend:** HTML5, Bootstrap 5, vanilla JavaScript (Fetch API), HTML5 Canvas, jsPDF + jsPDF-AutoTable, Font Awesome

---

## Project Structure

```
network-platform/
├── app.py                     # Minimal Flask entry point
├── routes.py                  # Route registration for all modules
├── config.py                  # Shared configuration (ports, timeouts, worker counts)
├── requirements.txt            # Python package dependencies
├── speed_history.json         # Persisted Speed Test history
├── utils/
│   ├── __init__.py
│   ├── scanner.py              # IP Radar: ARP sweep, port scan, classification
│   ├── network.py              # Shared networking helpers (vendor lookup, hostname resolution)
│   ├── classifier.py           # Device type / OS fingerprint heuristics
│   ├── wifi_scanner.py         # Wi-Fi Radar
│   ├── bluetooth_scanner.py    # Bluetooth Radar
│   ├── internet_tools.py       # WHOIS / DNS / Geolocation / SSL
│   ├── speed_test.py           # Speed Test
│   ├── topology.py             # Network Topology
│   ├── hotspot_scanner.py      # Hotspot Radar
│   └── packet_capture.py       # Live packet capture / passive OS fingerprinting
├── templates/
│   ├── index.html
│   ├── ip_scan.html
│   ├── wifi_scan.html
│   ├── bluetooth.html
│   ├── internet_tools.html
│   ├── speed_test.html
│   ├── topology.html
│   └── hotspot_radar.html
└── static/
    ├── css/                    # base.css (shared/theme) + one file per module
    ├── js/                     # One file per module
    └── favicons/               # Per-module favicons
```

---

## Getting Started

### Prerequisites
- Python 3.10+
- Windows (some modules — Wi-Fi Radar, Hotspot Radar — rely on Windows-specific APIs: `netsh`/`pywifi`, `arp -a`, mobile hotspot detection)
- [Npcap](https://npcap.com/) installed (required by Scapy for packet capture and ARP scanning)

### Installation
```bash
git clone <repository-url>
cd network-platform
pip install -r requirements.txt
python app.py
```

The app will be available at `http://localhost:5000`.

> **Note:** ARP scanning, packet capture, and some Bluetooth/Wi-Fi operations require running with administrator/elevated privileges.

---

## Disclaimer

This tool is intended for use on networks you own or have explicit authorization to analyze. Scanning networks without permission may violate local laws and regulations.

---

## Acknowledgments

Developed during a summer internship at **TÜBİTAK BİLGEM**.
