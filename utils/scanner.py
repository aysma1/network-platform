import socket
import subprocess
import re
from concurrent.futures import ThreadPoolExecutor

from scapy.all import ARP, Ether, srp, conf
from config import PORT_TIMEOUT, ARP_TIMEOUT, MAX_WORKERS, TARGET_PORTS, IS_WINDOWS
from utils.network import get_local_ip_details, get_vendor, resolve_hostname
from utils.classifier import classify_device

# get_windows_if_list farklı Scapy sürümlerinde farklı yerlerde olabiliyor
try:
    from scapy.all import get_windows_if_list
except ImportError:
    try:
        from scapy.arch.windows import get_windows_if_list
    except ImportError:
        get_windows_if_list = None


def get_scapy_iface_by_ip(local_ip: str):
    """
    Verilen local IP'ye sahip doğru Scapy/Npcap interface adını bul.
    Windows'ta birden fazla adaptör (Wi-Fi, Ethernet, VPN, Virtual vs.)
    olabildiği için Scapy'nin varsayılan seçtiği interface çoğu zaman
    gerçek aktif bağlantı olmayabilir. Bu fonksiyon local_ip'ye göre
    doğru kartı bulup ARP paketlerinin doğru yerden çıkmasını sağlar.
    """
    if not IS_WINDOWS or get_windows_if_list is None:
        return None
    try:
        for iface in get_windows_if_list():
            if local_ip in (iface.get('ips') or []):
                return iface.get('name')
    except Exception:
        pass
    return None


def get_ttl(ip: str) -> str:
    """Subprocess ping ile TTL değerini yakala."""
    try:
        param   = "-n" if IS_WINDOWS else "-c"
        w_param = ["-w", "800"] if IS_WINDOWS else ["-W", "1"]
        output  = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
        match = re.search(r"TTL=(\d+)", output, re.IGNORECASE)
        if match:
            return match.group(1)
    except Exception:
        pass
    return "N/A"


def get_latency(ip: str) -> str:
    """Ping ile ortalama gecikme süresini döndür."""
    try:
        param   = "-n" if IS_WINDOWS else "-c"
        w_param = ["-w", "800"] if IS_WINDOWS else ["-W", "1"]
        output  = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            timeout=2,
        )
        # Windows: Average = Xms
        match = re.search(r"[Aa]verage\s*=\s*(\d+)\s*ms", output)
        if not match:
            # Türkçe Windows
            match = re.search(r"[Oo]rtalama\s*=\s*(\d+)\s*ms", output)
        if not match:
            # Linux/macOS rtt
            match = re.search(r"rtt .+ = [\d.]+/([\d.]+)/", output)

        if match:
            val = round(float(match.group(1)))
            return "<1 ms" if val == 0 else f"{val} ms"
    except Exception:
        pass
    return "N/A"


def scan_ports(ip: str) -> list:
    """Hedef portları sırayla tara, açık olanları döndür."""
    results = []
    for port, service in TARGET_PORTS.items():
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(PORT_TIMEOUT)
        try:
            if sock.connect_ex((ip, port)) == 0:
                results.append({
                    "port":    port,
                    "service": service,
                    "banner":  f"Active {service}",
                })
        except Exception:
            pass
        finally:
            sock.close()
    return results


def process_device(args: tuple) -> dict:
    """Tek bir cihazı tam olarak işle (thread havuzundan çağrılır)."""
    idx, ip, mac = args

    latency  = get_latency(ip)
    hostname = resolve_hostname(ip)
    vendor   = get_vendor(mac)
    ttl_str  = get_ttl(ip)
    ports    = scan_ports(ip)

    device_type, icon, os_guess, ttl_out = classify_device(
        hostname, vendor, ip, ttl_str
    )
    is_wireless = any(k in device_type for k in ("Mobile", "iOS", "Android"))

    return {
        "id":          idx,
        "ip":          ip,
        "mac":         mac,
        "name":        hostname,
        "device_type": device_type,
        "device_icon": icon,
        "properties": {
            "vendor":          vendor,
            "connection_type": "Wireless (Wi-Fi)" if is_wireless else "Wired / Unknown",
            "estimated_os":    os_guess,
            "ttl":             ttl_out,
            "role":            "Central Gateway" if ip.endswith(".1") else "Endpoint Node",
            "open_ports":      ports,
            "latency":         latency,
        },
    }


def run_arp_scan() -> dict:
    """
    1. Scapy ile ARP sweep → cihaz listesi
    2. ThreadPoolExecutor ile tüm cihazları paralel işle
    """
    local_ip, subnet = get_local_ip_details()
    iface_name = get_scapy_iface_by_ip(local_ip)

    pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=subnet)

    result = srp(pkt, timeout=ARP_TIMEOUT, verbose=False, iface=iface_name)[0]

    tasks = [
        (i, received.psrc, received.hwsrc)
        for i, (_, received) in enumerate(result, start=1)
    ]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        devices = list(ex.map(process_device, tasks))

    return {"devices": devices, "subnet": subnet, "local_ip": local_ip}


def ping_once(ip: str) -> dict:
    """Tek bir ping isteği gönder."""
    param   = "-n" if IS_WINDOWS else "-c"
    w_param = ["-w", "1000"] if IS_WINDOWS else ["-W", "1"]
    try:
        output = subprocess.check_output(
            ["ping", param, "1"] + w_param + [ip],
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            timeout=3,
        )
        return {"status": "success", "output": output}
    except Exception:
        return {"status": "error", "output": "Request timed out."}


def tcp_connect(ip: str, port: int) -> dict:
    """Belirtilen porta TCP bağlantı denemesi yap."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect((ip, port))
        return {
            "status": "success",
            "output": f"SUCCESS: TCP connection to {ip}:{port} established.",
        }
    except Exception as e:
        return {"status": "error", "output": f"FAILED: {str(e)}"}
    finally:
        sock.close()