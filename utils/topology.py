"""
utils/topology.py
------------------
Network Topology, IP Radar'in zaten yaptigi ARP taramasini (run_arp_scan)
yeniden kullanir; ayni taramayi tekrarlamaz. Sadece sonucu router'i
merkeze alan bir node/edge grafina donusturur.
"""

from datetime import datetime

from utils.scanner import run_arp_scan


def get_topology():
    """
    run_arp_scan() sonucunu {"nodes": [...], "edges": [...]} formatinda
    bir yildiz (star) topolojisine cevirir. Router, IP'si "*.1" ile biten
    (ya da subnet'in ilk hostu olan) cihaz olarak tahmin edilir.
    """
    scan_result = run_arp_scan()
    devices = scan_result["devices"]
    local_ip = scan_result["local_ip"]
    subnet = scan_result.get("subnet", "")

    gateway_ip = _guess_gateway_ip(local_ip, devices)

    nodes = [{
        "id": gateway_ip,
        "label": "Router / Gateway",
        "type": "router",
        "ip": gateway_ip,
    }]
    edges = []

    for dev in devices:
        ip = dev.get("ip")
        if not ip or ip == gateway_ip:
            continue
        node_type = "this_device" if ip == local_ip else "device"
        nodes.append({
            "id": ip,
            "label": dev.get("hostname") or dev.get("vendor") or ip,
            "type": node_type,
            "ip": ip,
            "mac": dev.get("mac"),
        })
        edges.append({"from": gateway_ip, "to": ip})

    return {
        "scanned_at": datetime.now().isoformat(timespec="seconds"),
        "subnet": subnet,
        "nodes": nodes,
        "edges": edges,
    }


def _guess_gateway_ip(local_ip: str, devices: list) -> str:
    """Once tarama sonuclarinda '*.1' ile biten bir IP arar,
    bulamazsa local_ip'nin subnet'inden tahmin eder."""
    for dev in devices:
        ip = dev.get("ip", "")
        if ip.endswith(".1"):
            return ip

    parts = local_ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3] + ["1"])
    return local_ip