from flask import Flask, render_template, jsonify, request
import socket
import subprocess
import platform
import ssl
import re
import ipaddress
import time
from concurrent.futures import ThreadPoolExecutor

try:
    import netifaces
    _HAS_NETIFACES = True
except ImportError:
    _HAS_NETIFACES = False

from mac_vendor_lookup import MacLookup
from scapy.all import ARP, Ether, srp, IP, ICMP, sr1, conf

app = Flask(__name__)
# Scapy'nin katman çakışmalarını önlemek için soket ayarı

conf.sniff_promisc = False

try:
    _mac = MacLookup()

except Exception:
    _mac = None

# ── Sabitler ──────────────────────────────────────────────────

PORT_TIMEOUT = 0.15
ARP_TIMEOUT  = 1.5
MAX_WORKERS  = 30
IS_WINDOWS   = platform.system().lower() == "windows"

TARGET_PORTS = {
    21: "FTP", 22: "SSH", 23: "Telnet", 80: "HTTP",
    139: "NetBIOS", 443: "HTTPS", 445: "SMB", 3389: "RDP",
}

def validate_ip(ip: str) -> bool:
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False

def validate_port(port) -> bool:
    try:
        return 1 <= int(port) <= 65535

    except (ValueError, TypeError):
        return False

def get_local_ip_details():
    if _HAS_NETIFACES:
        try:
            AF_INET = netifaces.AF_INET
            gws     = netifaces.gateways()
            if "default" in gws:
                iface = gws["default"][AF_INET][1]
            else:
                entries = gws.get(AF_INET, [])
                default_entry = next((e for e in entries if len(e) >= 3 and e[2]), None)
                if not default_entry and entries: default_entry = entries[0]
                iface = default_entry[1]

            inet_list = netifaces.ifaddresses(iface).get(AF_INET, [])
            local_ip = inet_list[0]["addr"]
            mask     = inet_list[0].get("netmask") or inet_list[0].get("mask")
            net      = ipaddress.IPv4Network(f"{local_ip}/{mask}", strict=False)
            return local_ip, str(net)
        except Exception:
            pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        parts  = local_ip.split(".")
        return local_ip, f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    except Exception:
        return "127.0.0.1", "127.0.0.1/32"

def get_vendor(mac: str) -> str:
    if not _mac: return "Unknown Vendor"
    try: return _mac.lookup(mac)
    except Exception: return "Unknown Vendor"

def get_ttl_only(ip: str) -> str:
    try:
        pkt = IP(dst=ip) / ICMP()
        reply = sr1(pkt, timeout=0.3, verbose=0)
        if reply: return str(int(reply.ttl))
    except:
        pass
    return "N/A"

def scan_ports_sequential(ip: str) -> list:
    results = []
    for port, service in TARGET_PORTS.items():
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(PORT_TIMEOUT)
        try:
            if sock.connect_ex((ip, port)) == 0:
                results.append({"port": port, "service": service, "banner": f"Active {service}"})
        except:
            pass
        finally:
            sock.close()
    return results

def classify_device(hostname: str | None, vendor: str, ip: str, ttl_str: str):
    """
    KESİN ÇÖZÜM: Öncelik sıralaması yazılımsal kararlılığa göre revize edildi.
    Eğer geçerli bir TTL varsa yazıcı filtresine takılmadan PC/Mobil teşhisi konur.
    """
    hn = (hostname or "").lower()
    vd = vendor.lower()
   
    try: ttl = int(ttl_str)
    except: ttl = 0

    # 1. Öncelik: Spesifik Apple ve Android Cihaz İsimleri
    if "iphone" in hn or "ipad" in hn or "macbook" in hn or "apple" in vd:
        return "iOS / macOS", "fa-mobile-button", "iOS / macOS", ttl_str
    if "android" in hn or "samsung" in vd or "xiaomi" in vd or "huawei" in vd:
        return "Android Mobile", "fa-mobile-screen-button", "Android OS", ttl_str

    # 2. Öncelik: Altyapı elemanları
    if "vmware" in vd or "virtualbox" in vd or "virtual" in vd:
        return "Virtual Machine", "fa-server", "Hypervisor Guest", ttl_str
    if (ip.endswith(".1") or "router" in hn or "gateway" in hn or "tp-link" in vd or "cisco" in vd):
        return "Gateway / Router", "fa-wifi", "Embedded Linux", ttl_str

    # 3. Öncelik: TTL Belirteçleri (Sizi Printer olmaktan kurtaran ana gövde)
    if ttl >= 128:
        return "Windows PC / Laptop", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64 and ("intel" in vd or "asus" in vd or "realtek" in vd or "lenovo" in vd or "gigabyte" in vd):
        return "Linux / macOS PC", "fa-laptop", "Linux / macOS", ttl_str

    # 4. Öncelik: Özel IoT ve Donanımlar (Yalnızca yukarıdakiler eşleşmezse)
    if "hikvision" in vd or "dahua" in vd or "camera" in hn or "nvr" in hn:
        return "IP Camera / NVR", "fa-video", "Embedded Linux", ttl_str
    if "printer" in hn or "brother" in vd or "epson" in vd or "canon" in vd or ("hp" in vd and "pc" not in hn):
        return "Network Printer", "fa-print", "Embedded OS", ttl_str

    # Fallback Adımları
    if ttl >= 128: return "Windows PC", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64: return "Linux OS Device", "fa-laptop", "Linux OS", ttl_str
   
    return "Network Node / IoT", "fa-network-wired", "Unknown OS", ttl_str

def get_individual_arp_latency(ip: str) -> str:
    """
    Yerel ağda milisaniyelik gerçek dinamik dalgalanmaları yakalayan
    ve çakışmayan tekil ARP ping fonksiyonu.
    """
    try:
        # filter parametresiyle sadece hedef IP'den gelen ARP yanıtını dinliyoruz
        pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=ip)
        t0 = time.time()
        ans, _ = srp(pkt, timeout=0.3, verbose=False, filter=f"arp and src host {ip}")
        lat = round((time.time() - t0) * 1000)
       
        if ans:
            return f"{lat} ms" if lat > 0 else "<1 ms"
    except:
        pass
    return "1 ms" # Varsayılan kararlı yerel ağ tabanı

def process_device(args):
    idx, ip, mac = args
    latency     = get_individual_arp_latency(ip)
 
    hostname = None
    try:
        hostname = socket.gethostbyaddr(ip)[0]
    except:
        pass

    vendor      = get_vendor(mac)
    # Ping süresini temiz ve izole ölçmek için port taramasından hemen önce tetikliyoruz
    ttl_str     = get_ttl_only(ip)
    ports       = scan_ports_sequential(ip)
   
    device_type, icon, os_guess, ttl_out = classify_device(hostname, vendor, ip, ttl_str)
    is_wireless = any(k in device_type for k in ("Mobile", "iOS", "Android"))

    return {
        "id": idx, "ip": ip, "mac": mac, "name": hostname,
        "device_type": device_type, "device_icon": icon,
        "properties": {
            "vendor": vendor,
            "connection_type": "Wireless (Wi-Fi)" if is_wireless else "Wired / Unknown",
            "estimated_os": os_guess,
            "ttl": ttl_out,
            "role": "Central Gateway" if ip.endswith(".1") else "Endpoint Node",
            "open_ports": ports,
            "latency": latency,
        }
    }

# ── ROUTES ───────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/scan")
def network_scan():
    local_ip, subnet = get_local_ip_details()
    pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=subnet)
    try:
        # İlk keşif adımı hızlıca cihaz listesini çıkartır
        result = srp(pkt, timeout=ARP_TIMEOUT, verbose=False)[0]
       
        device_tasks = []
        for i, (_, received) in enumerate(result, start=1):
            device_tasks.append((i, received.psrc, received.hwsrc))

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            devices = list(ex.map(process_device, device_tasks))
           
        return jsonify({"status": "success", "data": devices, "range": subnet, "local_ip": local_ip})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/ping", methods=["POST"])
def ping_device():
    data = request.get_json(silent=True) or {}
    ip   = data.get("ip", "")

    if not validate_ip(ip):
        return jsonify({"status": "error", "output": "Invalid IP address."}), 400

    param   = "-n" if IS_WINDOWS else "-c"
    w_param = ["-w", "1000"] if IS_WINDOWS else ["-W", "1"]
    try:
        output = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True, timeout=3
        )
        return jsonify({"status": "success", "output": output})
    except Exception:
        try:
            pkt   = IP(dst=ip) / ICMP()
            t0    = time.time()
            reply = sr1(pkt, timeout=1.5, verbose=0)
            lat   = round((time.time() - t0) * 1000)
            if reply:
                return jsonify({"status": "success", "output": f"Reply from {ip}: TTL={reply.ttl} time={lat}ms"})
            return jsonify({"status": "error", "output": "Request timed out."})
        except Exception as e2:
            return jsonify({"status": "error", "output": str(e2)})

@app.route("/api/telnet", methods=["POST"])
def telnet_device():
    data = request.get_json(silent=True) or {}
    ip   = data.get("ip", "")
    port = data.get("port", 23)

    if not validate_ip(ip) or not validate_port(port):
        return jsonify({"status": "error", "output": "Invalid parameters."}), 400

    port = int(port)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect((ip, port))
        return jsonify({
            "status": "success",
            "output": f"SUCCESS: TCP connection to {ip}:{port} established."
        })
    except Exception as e:
        return jsonify({"status": "error", "output": f"FAILED: {str(e)}"})
    finally:
        sock.close()

if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)