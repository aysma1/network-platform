from flask import Flask, render_template, jsonify, request
import socket
import subprocess
import platform
import ssl
import re
import ipaddress
import time
import os
from concurrent.futures import ThreadPoolExecutor

try:
    import netifaces
    _HAS_NETIFACES = True
except ImportError:
    _HAS_NETIFACES = False

from mac_vendor_lookup import MacLookup
from scapy.all import ARP, Ether, srp, IP, ICMP, sr1, conf

app = Flask(__name__)

# Scapy thread güvenliği ve katman çakışmalarını önleme ayarları
conf.sniff_promisc = False

try:
    from mac_vendor_lookup import MacLookup
    _mac = MacLookup()
    # KESİN ÇÖZÜM: Kod başlamadan önce yerel veritabanı dosyasının 
    # indirilip hazırlandığından emin oluyoruz.
    try:
        _mac.load_local()  # Eğer sistemde varsa yerelden yükler
    except FileNotFoundError:
        _mac.update_binary_if_needed()  # Yoksa internetten çeker ve hazırlar
    _HAS_NETIFACES = True
except Exception:
    _mac = None

# ── Sabitler ──────────────────────────────────────────────────
PORT_TIMEOUT = 0.35
ARP_TIMEOUT  = 2.0
MAX_WORKERS  = 40  # Thread havuzunu genişlettik (Tamamen eşzamanlılık için)
IS_WINDOWS   = platform.system().lower() == "windows"

TARGET_PORTS = {
    21: "FTP", 
    22: "SSH", 
    23: "Telnet", 
    80: "HTTP", 
    139: "NetBIOS", 
    443: "HTTPS", 
    445: "SMB", 
    3389: "RDP",
    8080: "HTTP-ALT",
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
            if "default" in gws and AF_INET in gws["default"]:
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
    if not mac:
        return "Unknown Vendor"
    clean = mac.upper().replace("-", ":").strip()
    
    if _mac:
        try:
            result = _mac.lookup(clean)
            if result:
                return result
        except Exception:
            pass
    
    oui_path = os.path.join(os.path.expanduser("~"), ".cache", "mac-vendors", "oui.txt")
    if os.path.exists(oui_path):
        # MAC'in ilk 3 byte'ını al: "AA:BB:CC" → "AA-BB-CC"
        prefix = clean[:8].replace(":", "-").upper()
        try:
            with open(oui_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    # Satır başı prefix kontrolü — boşlukları ignore et
                    if line.startswith(prefix) and "(hex)" in line:
                        # Format: "28-6F-B9   (hex)\t\tNokia Shanghai Bell\n"
                        parts = line.split("\t\t")
                        if len(parts) >= 2:
                            return parts[-1].strip()
        except Exception:
            pass
    
    return "Unknown Vendor"

def get_ttl_only(ip: str) -> str:
    """
    Thread çakışmalarını önlemek için native ping (subprocess) kullanarak 
    TTL değerini yakalayan daha güvenli fonksiyon.
    """
    try:
        param = "-n" if IS_WINDOWS else "-c"
        w_param = ["-w", "800"] if IS_WINDOWS else ["-W", "1"]
        output = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        match = re.search(r"TTL=(\d+)", output, re.IGNORECASE)
        if match:
            return match.group(1)
    except:
        pass
    return "N/A"

def scan_ports_parallel(ip: str) -> list:
    """Tek bir cihazın portlarını tararken de hafif soket kullanarak hızlıca döner"""
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
    GÜNCELLENMİŞ KESİN ÇÖZÜM: Marka tabanlı yanlış eşleşmeleri (HP laptopların printer çıkması gibi) 
    önlemek için donanım/isimlendirme kırılımları ve TTL mantığı optimize edildi.
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

    # 3. Öncelik: Ağ isminden net PC/Laptop tespiti (TTL gelmese bile kurtarır)
    if any(k in hn for k in ("laptop", "desktop", "pc", "computer", "notebook")):
        if ttl >= 128 or "windows" in hn:
            return "Windows PC / Laptop", "fa-desktop", "Windows OS", ttl_str
        return "PC / Laptop", "fa-laptop", "Linux / macOS or Windows", ttl_str

    # 4. Öncelik: TTL Belirteçleri (Güvenli donanım eşleşmeleriyle birlikte)
    if ttl >= 128:
        return "Windows PC / Laptop", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64 and any(k in vd for k in ("intel", "asus", "realtek", "lenovo", "gigabyte", "hp", "dell", "msi")):
        if "printer" not in hn:
            return "PC / Laptop Node", "fa-laptop", "Linux / macOS / Windows", ttl_str

    # 5. Öncelik: Özel IoT ve Donanımlar (Yazıcı filtresi daraltıldı)
    if "hikvision" in vd or "dahua" in vd or "camera" in hn or "nvr" in hn:
        return "IP Camera / NVR", "fa-video", "Embedded Linux", ttl_str
    
    is_hp_printer = (
        "hp" in vd and not any(k in hn for k in ("laptop", "desktop", "pc", "note", "pavilion", "elitebook", "probook", "envy", "spectre", "omen"))
        and any(k in hn for k in ("print", "laserjet", "officejet", "deskjet", "mfp"))
    )
    if "printer" in hn or "brother" in vd or "epson" in vd or "canon" in vd or is_hp_printer:
        return "Network Printer", "fa-print", "Embedded OS", ttl_str

    # Fallback Adımları
    if ttl >= 128: return "Windows PC", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64: return "Linux OS Device", "fa-laptop", "Linux OS", ttl_str
    
    if any(k in vd for k in ("hp", "dell", "lenovo", "asus", "acer")):
        return "Computer Node (Unverified TTL)", "fa-laptop", "Unknown OS", ttl_str
   
    return "Network Node / IoT", "fa-network-wired", "Unknown OS", ttl_str

def get_individual_arp_latency(ip: str) -> str:
    try:
        param = "-n" if IS_WINDOWS else "-c"
        w_param = ["-w", "800"] if IS_WINDOWS else ["-W", "1"]
        output = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            timeout=2
        )
        match = re.search(r"[Aa]verage\s*=\s*(\d+)\s*ms", output)
        if match:
            val = int(match.group(1))
            return "<1 ms" if val == 0 else f"{val} ms"
        match = re.search(r"[Oo]rtalama\s*=\s*(\d+)\s*ms", output)
        if match:
            val = int(match.group(1))
            return "<1 ms" if val == 0 else f"{val} ms"
        match = re.search(r"rtt .+ = [\d.]+/([\d.]+)/", output)
        if match:
            val = round(float(match.group(1)))
            return "<1 ms" if val == 0 else f"{val} ms"
    except Exception:
        pass
    return "N/A"

def process_device(args):
    """
    Bütün cihazlar buraya THREAD havuzundan eşzamanlı (Parallel) olarak düşer.
    Hiçbir cihaz bir diğerinin port taramasını veya ping atmasını beklemez.
    """
    idx, ip, mac = args
    
    # Latency, Hostname, TTL ve Port taraması her thread içinde tamamen asenkron yürür.
    latency  = get_individual_arp_latency(ip)
 
    hostname = None
    try:
        hostname = socket.gethostbyaddr(ip)[0]
    except:
        pass

    vendor      = get_vendor(mac)
    ttl_str     = get_ttl_only(ip)
    ports       = scan_ports_parallel(ip)
    
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
        # 1. Aşama: Ağdaki aktif cihazların IP ve MAC listesini Scapy ile saniyeler içinde süpürürüz.
        result = srp(pkt, timeout=ARP_TIMEOUT, verbose=False)[0]
        
        device_tasks = []
        for i, (_, received) in enumerate(result, start=1):
            device_tasks.append((i, received.psrc, received.hwsrc))

        # 2. Aşama: Bulunan tüm cihazları (Örn: 15 cihaz) havuzdaki 40 thread'e aynı anda dağıtırız.
        # Böylece hepsi AYNI ANDA ping atar, port tarar ve ismini çözer. Süreç aşırı hızlanır.
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
        return jsonify({"status": "error", "output": "Request timed out."})

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