import threading
import time
from collections import defaultdict
from datetime import datetime

from scapy.all import sniff, IP, TCP, UDP, ICMP, ARP, DNS, DNSQR, Raw
from scapy.layers.http import HTTP, HTTPRequest, HTTPResponse

# ── Her IP için ayrı capture session tutulur ──────────────────
_sessions = {}   # { ip: CaptureSession }
_lock     = threading.Lock()


class CaptureSession:
    def __init__(self, target_ip: str):
        self.target_ip   = target_ip
        self.running     = False
        self.packets     = []          # Son 500 paket
        self.stats       = defaultdict(int)   # protokol → paket sayısı
        self.bandwidth   = []          # [ {ts, bytes} ]
        self.dns_queries = []          # [ {ts, query, type} ]
        self.http_reqs   = []          # [ {ts, method, host, path, status} ]
        self.os_hints    = {}          # pasif OS fingerprint
        self._thread     = None
        self._lock       = threading.Lock()

    # ── Capture başlat ────────────────────────────────────────
    def start(self):
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._capture, daemon=True)
        self._thread.start()

    def stop(self):
        self.running = False

    def clear(self):
        with self._lock:
            self.packets.clear()
            self.stats.clear()
            self.bandwidth.clear()
            self.dns_queries.clear()
            self.http_reqs.clear()
            self.os_hints.clear()

    # ── Scapy sniff döngüsü ───────────────────────────────────
    def _capture(self):
        def stop_filter(_):
            return not self.running

        sniff(
            filter=f"host {self.target_ip}",
            prn=self._process,
            store=False,
            stop_filter=stop_filter,
        )

    def _process(self, pkt):
        if not self.running:
            return

        ts    = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        proto = "OTHER"
        info  = ""
        size  = len(pkt)

        with self._lock:
            # ── Bant genişliği ────────────────────────────────
            now = time.time()
            self.bandwidth.append({"ts": now, "bytes": size})
            # Son 60 saniyelik veriyi tut
            self.bandwidth = [b for b in self.bandwidth if now - b["ts"] <= 60]

            # ── Protokol tespiti ──────────────────────────────
            if pkt.haslayer(ARP):
                proto = "ARP"
                info  = f"Who has {pkt[ARP].pdst}? Tell {pkt[ARP].psrc}"

            elif pkt.haslayer(DNS):
                proto = "DNS"
                if pkt.haslayer(DNSQR):
                    qname = pkt[DNSQR].qname.decode(errors="ignore").rstrip(".")
                    qtype = pkt[DNSQR].qtype
                    info  = f"Query: {qname}"
                    self.dns_queries.append({
                        "ts": ts, "query": qname,
                        "type": _dns_type(qtype),
                        "dir": "OUT" if pkt[IP].dst == self.target_ip else "IN"
                            if pkt.haslayer(IP) else "?"
                    })
                    if len(self.dns_queries) > 100:
                        self.dns_queries.pop(0)

            elif pkt.haslayer(HTTPRequest):
                proto = "HTTP"
                try:
                    method = pkt[HTTPRequest].Method.decode(errors="ignore")
                    host   = pkt[HTTPRequest].Host.decode(errors="ignore")
                    path   = pkt[HTTPRequest].Path.decode(errors="ignore")
                    info   = f"{method} {host}{path}"
                    self.http_reqs.append({
                        "ts": ts, "method": method,
                        "host": host, "path": path, "status": "-"
                    })
                    if len(self.http_reqs) > 100:
                        self.http_reqs.pop(0)
                except Exception:
                    info = "HTTP Request"

            elif pkt.haslayer(HTTPResponse):
                proto = "HTTP"
                try:
                    status = pkt[HTTPResponse].Status_Code.decode(errors="ignore")
                    info   = f"Response {status}"
                    # Son HTTP isteğine status ekle
                    for r in reversed(self.http_reqs):
                        if r["status"] == "-":
                            r["status"] = status
                            break
                except Exception:
                    info = "HTTP Response"

            elif pkt.haslayer(ICMP):
                proto = "ICMP"
                t = pkt[ICMP].type
                info = {0: "Echo Reply", 8: "Echo Request"}.get(t, f"Type {t}")

            elif pkt.haslayer(TCP):
                proto = "TCP"
                flags = _tcp_flags(pkt[TCP].flags)
                sport = pkt[TCP].sport
                dport = pkt[TCP].dport
                info  = f"{sport} → {dport} [{flags}]"
                # Pasif OS fingerprint
                self._fingerprint(pkt)

            elif pkt.haslayer(UDP):
                proto = "UDP"
                sport = pkt[UDP].sport
                dport = pkt[UDP].dport
                info  = f"{sport} → {dport}"

            elif pkt.haslayer(IP):
                proto = "IP"

            self.stats[proto] += 1

            # ── Src / Dst ─────────────────────────────────────
            src = pkt[IP].src if pkt.haslayer(IP) else (pkt[ARP].psrc if pkt.haslayer(ARP) else "?")
            dst = pkt[IP].dst if pkt.haslayer(IP) else (pkt[ARP].pdst if pkt.haslayer(ARP) else "?")

            self.packets.append({
                "ts": ts, "src": src, "dst": dst,
                "proto": proto, "size": size, "info": info,
            })
            if len(self.packets) > 500:
                self.packets.pop(0)

    def _fingerprint(self, pkt):
        """TTL + TCP window + flags ile pasif OS tahmini."""
        if not pkt.haslayer(IP) or not pkt.haslayer(TCP):
            return
        ttl    = pkt[IP].ttl
        window = pkt[TCP].window
        flags  = int(pkt[TCP].flags)

        if ttl >= 128:
            os_guess = "Windows"
        elif ttl >= 64:
            os_guess = "Linux / macOS"
        elif ttl >= 32:
            os_guess = "Older Windows / Cisco"
        else:
            os_guess = "Unknown"

        self.os_hints = {
            "ttl":     ttl,
            "window":  window,
            "os":      os_guess,
            "flags":   _tcp_flags(flags),
        }

    # ── Snapshot (API'ye döndürülecek veri) ──────────────────
    def snapshot(self) -> dict:
        with self._lock:
            # Bant genişliği: son 60s, 1s granülerlik
            bw = _aggregate_bandwidth(self.bandwidth)
            return {
                "running":     self.running,
                "packets":     list(self.packets[-100:]),   # son 100
                "stats":       dict(self.stats),
                "bandwidth":   bw,
                "dns_queries": list(self.dns_queries[-50:]),
                "http_reqs":   list(self.http_reqs[-50:]),
                "os_hints":    dict(self.os_hints),
                "total":       sum(self.stats.values()),
            }


# ── Yardımcı fonksiyonlar ─────────────────────────────────────

def _tcp_flags(flags) -> str:
    flag_map = {0x01: "FIN", 0x02: "SYN", 0x04: "RST",
                0x08: "PSH", 0x10: "ACK", 0x20: "URG"}
    return " ".join(v for k, v in flag_map.items() if int(flags) & k) or "NONE"


def _dns_type(t: int) -> str:
    return {1: "A", 2: "NS", 5: "CNAME", 15: "MX",
            16: "TXT", 28: "AAAA", 33: "SRV"}.get(t, str(t))


def _aggregate_bandwidth(raw: list) -> list:
    """Ham byte listesini 1s dilimlerine böler → [{ts, bps}]"""
    if not raw:
        return []
    buckets = defaultdict(int)
    for entry in raw:
        bucket = int(entry["ts"])
        buckets[bucket] += entry["bytes"]
    now = int(time.time())
    result = []
    for i in range(59, -1, -1):
        t = now - i
        result.append({
            "ts":  datetime.fromtimestamp(t).strftime("%H:%M:%S"),
            "bps": buckets.get(t, 0) * 8,   # bytes → bits
        })
    return result


# ── Session yönetimi (routes'tan çağrılır) ───────────────────

def get_session(ip: str) -> CaptureSession:
    with _lock:
        if ip not in _sessions:
            _sessions[ip] = CaptureSession(ip)
        return _sessions[ip]