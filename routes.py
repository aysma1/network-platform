import socket
from flask import render_template, jsonify, request
from utils.network import validate_ip, validate_port, get_local_ip_details
from utils.scanner import run_arp_scan, ping_once, tcp_connect
from utils.packet_capture import get_session
from utils.wifi_scanner import scan_nearby_networks
from utils.bluetooth_scanner import scan_bluetooth_sync
from utils.internet_tools import query_whois, query_dns, query_ip_info
from utils.speed_test import run_speed_test, get_speed_history
from utils.topology import get_topology


def register_routes(app):

    # ── Ana Sayfa ─────────────────────────────────────────────
    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/info")
    def platform_info():
        local_ip, _ = get_local_ip_details()
        return jsonify({
            "hostname": socket.gethostname(),
            "local_ip": local_ip,
        })

    # ── IP Radar ──────────────────────────────────────────────
    @app.route("/ip-scan")
    def ip_scan():
        return render_template("ip_scan.html")

    @app.route("/api/scan")
    def network_scan():
        try:
            result = run_arp_scan()
            return jsonify({
                "status":   "success",
                "data":     result["devices"],
                "range":    result["subnet"],
                "local_ip": result["local_ip"],
            })
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    @app.route("/api/ping", methods=["POST"])
    def ping_device():
        data = request.get_json(silent=True) or {}
        ip = data.get("ip", "")
        if not validate_ip(ip):
            return jsonify({"status": "error", "output": "Invalid IP address."}), 400
        return jsonify(ping_once(ip))

    @app.route("/api/telnet", methods=["POST"])
    def telnet_device():
        data = request.get_json(silent=True) or {}
        ip   = data.get("ip", "")
        port = data.get("port", 23)
        if not validate_ip(ip) or not validate_port(port):
            return jsonify({"status": "error", "output": "Invalid parameters."}), 400
        return jsonify(tcp_connect(ip, int(port)))

    # ── Wi-Fi Radar ───────────────────────────────────────────
    @app.route("/wifi-scan")
    def wifi_scan():
        return render_template("wifi_scan.html")

    @app.route("/api/wifi-scan")
    def api_wifi_scan():
        try:
            networks = scan_nearby_networks()
            return jsonify({"status": "success", "networks": networks})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e), "networks": []}), 500

    # ── Bluetooth Radar ───────────────────────────────────────
    @app.route("/bluetooth-scan")
    def bluetooth_scan():
        return render_template("bluetooth.html")

    @app.route("/api/bluetooth-scan")
    def api_bluetooth_scan():
        timeout  = request.args.get("timeout",  default=8.0,  type=float)
        min_rssi = request.args.get("min_rssi", default=-90,  type=int)
        try:
            devices = scan_bluetooth_sync(timeout=timeout, min_rssi=min_rssi)
            return jsonify({"success": True, "count": len(devices), "devices": devices})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500

    # ── Paket Analizörü ───────────────────────────────────────
    @app.route("/analyzer/<ip>")
    def analyzer(ip):
        if not validate_ip(ip):
            return "Invalid IP", 400
        return render_template("analyzer.html", target_ip=ip)

    @app.route("/api/analyzer/<ip>/start", methods=["POST"])
    def analyzer_start(ip):
        if not validate_ip(ip):
            return jsonify({"status": "error"}), 400
        get_session(ip).start()
        return jsonify({"status": "started"})

    @app.route("/api/analyzer/<ip>/stop", methods=["POST"])
    def analyzer_stop(ip):
        if not validate_ip(ip):
            return jsonify({"status": "error"}), 400
        get_session(ip).stop()
        return jsonify({"status": "stopped"})

    @app.route("/api/analyzer/<ip>/clear", methods=["POST"])
    def analyzer_clear(ip):
        if not validate_ip(ip):
            return jsonify({"status": "error"}), 400
        get_session(ip).clear()
        return jsonify({"status": "cleared"})

    @app.route("/api/analyzer/<ip>/data")
    def analyzer_data(ip):
        if not validate_ip(ip):
            return jsonify({"status": "error"}), 400
        return jsonify(get_session(ip).snapshot())

    # ── Internet Tools ────────────────────────────────────────
    @app.route("/internet-tools")
    def internet_tools():
        return render_template("internet_tools.html")

    @app.route("/api/whois")
    def api_whois():
        target = request.args.get("target", "").strip()
        if not target:
            return jsonify({"error": "target parametresi gerekli"}), 400
        return jsonify(query_whois(target))

    @app.route("/api/dns")
    def api_dns():
        target = request.args.get("target", "").strip()
        types  = request.args.get("types", "").strip()
        if not target:
            return jsonify({"error": "target parametresi gerekli"}), 400
        record_types = [t.strip().upper() for t in types.split(",")] if types else None
        return jsonify(query_dns(target, record_types))

    @app.route("/api/ip-info")
    def api_ip_info():
        ip = request.args.get("ip", "").strip()
        if not ip:
            return jsonify({"error": "ip parametresi gerekli"}), 400
        return jsonify(query_ip_info(ip))

# ── Speed Test ────────────────────────────────────────────
    @app.route("/speed-test")
    def speed_test_page():
        return render_template("speed_test.html")

    @app.route("/api/speed-test")
    def api_speed_test():
        try:
            result = run_speed_test()
            
            # Eğer hız testi başarısız olduysa hata fırlatalım
            if not result.get("success", False):
                return jsonify({"status": "error", "message": result.get("error", "Hız testi başarısız oldu.")}), 500
            
            # Sunucu ismini ve lokasyonunu JS'in beklediği gibi ayırıyoruz (Örn: "Turkcell (Istanbul)" -> name: Turkcell, location: Istanbul)
            server_raw = result.get("server", "N/A")
            server_name = server_raw
            server_location = "N/A"
            
            if "(" in server_raw:
                parts = server_raw.split("(")
                server_name = parts[0].strip()
                server_location = parts[1].replace(")", "").strip()

            # JS kodunun tam olarak beklediği veri yapısı (data.download_mbps vb.)
            formatted_data = {
                "download_mbps": result.get("download"),
                "upload_mbps": result.get("upload"),
                "ping_ms": result.get("ping"),
                "jitter_ms": result.get("jitter", 0),
                "timestamp": result.get("timestamp"),
                "server": {
                    "name": server_name,
                    "location": server_location
                }
            }
            
            return jsonify({
                "status": "success",
                "data": formatted_data
            })
            
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    @app.route("/api/speed-test/history")
    def api_speed_test_history():
        try:
            history = get_speed_history()
            formatted_history = []
            
            # Geçmiş kayıtları da JS'in beklediği formata dönüştürüyoruz
            for item in history:
                server_raw = item.get("server", "N/A")
                server_name = server_raw
                server_location = "N/A"
                if "(" in server_raw:
                    parts = server_raw.split("(")
                    server_name = parts[0].strip()
                    server_location = parts[1].replace(")", "").strip()

                formatted_history.append({
                    "timestamp": item.get("timestamp", "").split(".")[0].replace("T", " "), # Daha okunabilir tarih
                    "download_mbps": item.get("download"),
                    "upload_mbps": item.get("upload"),
                    "ping_ms": item.get("ping"),
                    "jitter_ms": item.get("jitter", 0),
                    "server": {
                        "name": server_name,
                        "location": server_location
                    }
                })
                
            return jsonify({
                "status": "success",
                "data": formatted_history
            })
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    # ── Network Topology ──────────────────────────────────────
    @app.route("/topology")
    def topology_page():
        return render_template("topology.html")

    @app.route("/api/topology")
    def api_topology():
        try:
            result = get_topology()
            return jsonify({"status": "success", "data": result})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500