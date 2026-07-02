import socket
import ipaddress
import os

try:
    import netifaces
    _HAS_NETIFACES = True
except ImportError:
    _HAS_NETIFACES = False

try:
    from mac_vendor_lookup import MacLookup
    _mac = MacLookup()
    try:
        _mac.load_local()
    except FileNotFoundError:
        _mac.update_binary_if_needed()
except Exception:
    _mac = None


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
    """Yerel IP ve subnet bilgisini döndürür."""
    if _HAS_NETIFACES:
        try:
            AF_INET = netifaces.AF_INET
            gws = netifaces.gateways()
            if "default" in gws and AF_INET in gws["default"]:
                iface = gws["default"][AF_INET][1]
            else:
                entries = gws.get(AF_INET, [])
                default_entry = next((e for e in entries if len(e) >= 3 and e[2]), None)
                if not default_entry and entries:
                    default_entry = entries[0]
                iface = default_entry[1]

            inet_list = netifaces.ifaddresses(iface).get(AF_INET, [])
            local_ip = inet_list[0]["addr"]
            mask = inet_list[0].get("netmask") or inet_list[0].get("mask")
            net = ipaddress.IPv4Network(f"{local_ip}/{mask}", strict=False)
            return local_ip, str(net)
        except Exception:
            pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        parts = local_ip.split(".")
        return local_ip, f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    except Exception:
        return "127.0.0.1", "127.0.0.1/32"


def get_vendor(mac: str) -> str:
    """MAC adresinden donanım üreticisini bul."""
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

    oui_path = os.path.join(
        os.path.expanduser("~"), ".cache", "mac-vendors", "oui.txt"
    )
    if os.path.exists(oui_path):
        prefix = clean[:8].replace(":", "-").upper()
        try:
            with open(oui_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith(prefix) and "(hex)" in line:
                        parts = line.split("\t\t")
                        if len(parts) >= 2:
                            return parts[-1].strip()
        except Exception:
            pass

    return "Unknown Vendor"


def resolve_hostname(ip: str):
    """IP adresinden hostname çöz."""
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return None
