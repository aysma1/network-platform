# 🛡️ Advanced Network Deep Diagnostic & Audit Radar

This project is a **Multi-threaded Cybersecurity and Network Analysis Platform** that discovers all active devices within a local subnet, verifies hardware manufacturers, scans critical ports, and provides interactive network diagnostic tools (Ping, Telnet) via a responsive web dashboard.

---

## 🚀 Core Features

* **Live Network Topology Mapping (Scapy Engine):** Utilizes Layer 2 ARP packet injection via Scapy to immediately capture active hosts, even those behind stealthy firewalls.
* **High-Performance Multi-Threading:** Resolves device names, MAC addresses, and vendor lookups simultaneously using 25 asynchronous parallel threads (`ThreadPoolExecutor`), eliminating front-end freezing.
* **Smart Device & OS Classification:** Analyzes MAC address prefixes (OUI) and NetBIOS signatures to dynamically classify nodes by brand (Apple, Intel, HP, Samsung, Xiaomi, etc.) and category (PC, Mobile, Router, Printer) with custom UI icons.
* **Automated Port Sweep (Mini-Nmap):** Automatically checks the 8 most critical cybersecurity doors behind every discovered node (`21-FTP, 22-SSH, 23-Telnet, 80-HTTP, 139-NetBIOS, 443-HTTPS, 445-SMB, 3389-RDP`).
* **Instant Filtering & Live Node Counter:** Features a real-time search engine to instantly filter nodes by IP or Device Type, alongside a prominent badge counting the total active nodes.
* **Optimized Auto-Radar Sequence (120s):** Counts down smoothly for 2 minutes (120 seconds) before performing a silent background refresh to keep the grid updated without interrupting the user experience.
* **Interactive Dual Matrix Terminals:**
  * **Interactive Ping Engine:** Triggers the host operating system's native command line (`cmd.exe`) via Python to pipe live ICMP transmission outputs into a Matrix-green terminal window.
  * **Remote Telnet Handshake:** Attempts direct TCP connections on user-specified ports, printing precise debug strings and socket codes (`WinError` mappings) to test port availability.

---

## 🛠️ Architecture & Tech Stack

### Backend
* **Python 3.x** & **Flask Framework** (API Endpoint deployment and lightweight server)
* **Scapy** (Raw packet manipulation and layer-2 sniffing)
* **Concurrent.futures (ThreadPoolExecutor)** (Asynchronous multi-threaded worker pooling)
* **Socket & Subprocess** (OS-level low-level networking and CLI piping)

### Frontend
* **HTML5 / CSS3 (Dark Cyberpunk Theme)**
* **Bootstrap 5** (Responsive layout adjustments and UI components)
* **FontAwesome 6** (Dynamic security and infrastructure iconography)
* **Vanilla JavaScript** (Asynchronous Fetch API, countdown scheduling, and DOM manipulation)

---

## 📦 Installation & Setup Guide

### 1. Prerequisites
To allow Scapy to listen to raw network interface layers, your machine must have **Npcap** or **WinPcap** installed. (If you already have Wireshark installed, this is already taken care of).

Install the necessary Python dependencies via your terminal:
```bash
pip install flask scapy
