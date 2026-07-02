import platform

# ── Zaman Aşımı & Tarama Ayarları ──────────────────────────
PORT_TIMEOUT = 0.15
ARP_TIMEOUT  = 2.0
MAX_WORKERS  = 40
IS_WINDOWS   = platform.system().lower() == "windows"

# ── Taranacak Portlar ───────────────────────────────────────
TARGET_PORTS = {
    21:   "FTP",
    22:   "SSH",
    23:   "Telnet",
    80:   "HTTP",
    139:  "NetBIOS",
    443:  "HTTPS",
    445:  "SMB",
    3389: "RDP",
    8080: "HTTP-ALT",
}

# Kırmızı alarm verecek kritik güvenlik portları
CRITICAL_PORTS = [21, 22, 23, 139, 445, 3389]
