"""
Hotspot Radar - Detects devices connected to this PC's Mobile Hotspot / ICS
"""
import subprocess
import socket
import re
import psutil
import concurrent.futures

from utils.network import get_vendor, resolve_hostname

HOTSPOT_SUBNET_PREFIX = "192.168.137."


def find_hotspot_interface():
    for iface_name, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == socket.AF_INET and addr.address.startswith(HOTSPOT_SUBNET_PREFIX):
                return {"interface": iface_name, "ip": addr.address}
    return None


def _ping(ip):
    try:
        subprocess.run(
            ["ping", "-n", "1", "-w", "200", ip],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=1
        )
    except Exception:
        pass


def ping_sweep(prefix=HOTSPOT_SUBNET_PREFIX, start=2, end=254):
    """
    Actively pings every address in the hotspot subnet so Windows
    populates its ARP cache for any device that's actually online.
    Runs in parallel, ~1-2 seconds total.
    """
    ips = [f"{prefix}{i}" for i in range(start, end + 1)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as executor:
        list(executor.map(_ping, ips))


def get_arp_table():
    devices = []
    try:
        output = subprocess.check_output("arp -a", shell=True, text=True, timeout=5)
        for line in output.splitlines():
            match = re.match(r"\s*(\d+\.\d+\.\d+\.\d+)\s+([\w-]{17})\s+(\w+)", line)
            if match:
                ip, mac, entry_type = match.groups()
                devices.append({
                    "ip": ip,
                    "mac": mac.upper().replace("-", ":"),
                    "type": entry_type.lower()
                })
    except Exception as e:
        print(f"[HotspotRadar] ARP table read failed: {e}")
    return devices


def is_real_client(ip, mac):
    """Filter out broadcast, multicast, and non-device ARP entries."""
    if ip.endswith(".255"):
        return False
    if ip.startswith("224.") or ip.startswith("239."):
        return False
    if mac == "FF:FF:FF:FF:FF:FF":
        return False
    if mac.startswith("01:00:5E"):  # multicast MAC prefix
        return False
    return True


def scan_hotspot_clients():
    hotspot = find_hotspot_interface()
    if not hotspot:
        return {
            "active": False,
            "message": "Mobile Hotspot is not currently active on this PC.",
            "devices": []
        }

    ping_sweep()
    arp_devices = get_arp_table()

    clients = []
    for dev in arp_devices:
        if (dev["ip"].startswith(HOTSPOT_SUBNET_PREFIX)
                and dev["ip"] != hotspot["ip"]
                and is_real_client(dev["ip"], dev["mac"])):
            hostname = resolve_hostname(dev["ip"]) or "Unknown"
            vendor = get_vendor(dev["mac"])
            clients.append({
                "ip": dev["ip"],
                "mac": dev["mac"],
                "hostname": hostname,
                "vendor": vendor
            })

    return {
        "active": True,
        "gateway_ip": hotspot["ip"],
        "interface": hotspot["interface"],
        "device_count": len(clients),
        "devices": clients
    }