import time
import threading
import pywifi
from pywifi import const

_wifi_instance = None
_iface_instance = None
_scan_lock = threading.Lock()


def _get_interface():
    global _wifi_instance, _iface_instance
    if _wifi_instance is None:
        _wifi_instance = pywifi.PyWiFi()
    if _iface_instance is None:
        interfaces = _wifi_instance.interfaces()
        if not interfaces:
            raise RuntimeError("No wireless network adapter found in the system.")
        _iface_instance = interfaces[0]
    return _iface_instance


AKM_MAP = {
    const.AKM_TYPE_NONE: "Open",
    const.AKM_TYPE_WPA: "WPA-Enterprise",
    const.AKM_TYPE_WPAPSK: "WPA-Personal",
    const.AKM_TYPE_WPA2: "WPA2-Enterprise",
    const.AKM_TYPE_WPA2PSK: "WPA2-Personal",
    const.AKM_TYPE_UNKNOWN: "WPA3/Unknown",
}


def _resolve_security(network):
    if not network.akm:
        return "Open"
    
    labels = []
    for a in network.akm:
        if a not in AKM_MAP or a == const.AKM_TYPE_UNKNOWN:
            labels.append("WPA3/Unknown")
        else:
            labels.append(AKM_MAP[a])
            
    labels = set(labels)
    if labels == {"Open"}:
        return "Open"
    labels.discard("Open")
    return " / ".join(sorted(labels)) if labels else "Unknown"


def _resolve_channel_band(freq_value):
    freq = freq_value
    if freq > 20000:
        freq = freq / 1000
    freq = int(round(freq))

    if 2400 <= freq <= 2500:
        channel = int(round((freq - 2407) / 5))
        band, width = "2.4", 20
    elif 4900 <= freq <= 5900:
        channel = int(round((freq - 5000) / 5))
        band, width = "5", 80
    elif freq >= 5925:
        channel = int(round((freq - 5950) / 5)) + 1
        band, width = "6", 160
    else:
        channel, band, width = 0, "?", 20

    return freq, channel, band, width


def _decode_ssid(raw_ssid):
    """
    Resolves encoding issues for Turkish characters in Wi-Fi SSIDs.
    Ensures names like 'İnternet', 'Türk Telekom', 'Ayşegül' render correctly.
    """
    if not raw_ssid:
        return "[Hidden SSID]"
    
    # pywifi veri tipini string olarak getirse bile arka planda yanlış decode edilmiş olabilir
    if isinstance(raw_ssid, str):
        # Yöntem 1: Eğer string zaten bozuk unicode kaçış karakterleri içeriyorsa düzelt
        try:
            return raw_ssid.encode('raw_unicode_escape').decode('utf-8')
        except:
            pass
        
        # Yöntem 2: Windows mimarisinde gelen cp1254 (Türkçe) byte bozulmalarını düzelt
        try:
            return raw_ssid.encode('latin-1').decode('cp1254')
        except:
            pass
            
        # Yöntem 3: Standart utf-8'e zorla geri döndürmeyi dene
        try:
            return raw_ssid.encode('latin-1').decode('utf-8', errors='ignore')
        except:
            return raw_ssid
            
    return str(raw_ssid)


def scan_nearby_networks(force_rescan=True, wait_seconds=5, retry_count=2):
    if not _scan_lock.acquire(timeout=15):
        print("[-] Previous scan is still running, skipping this request.")
        return []

    try:
        for attempt in range(retry_count + 1):
            try:
                iface = _get_interface()

                if force_rescan:
                    iface.scan()
                    time.sleep(wait_seconds)

                raw_results = iface.scan_results()

                networks = []
                seen_bssids = set()

                for net in raw_results:
                    bssid = (net.bssid or "").upper()
                    if not bssid or bssid in seen_bssids:
                        continue
                    seen_bssids.add(bssid)

                    # Türkçe SSID çözücü fonksiyonu burada çağırılıyor
                    ssid = _decode_ssid(net.ssid)
                    frequency, channel, band, width = _resolve_channel_band(net.freq)
                    security = _resolve_security(net)

                    networks.append({
                        "ssid": ssid,
                        "bssid": bssid,
                        "signal": net.signal,
                        "channel": channel,
                        "frequency": frequency,
                        "width": width,
                        "band": band,
                        "security": security,
                    })

                return sorted(networks, key=lambda x: x["signal"], reverse=True)

            except Exception as e:
                print(f"[-] pywifi scan error (attempt {attempt + 1}/{retry_count + 1}): {e}")
                global _wifi_instance, _iface_instance
                _wifi_instance = None
                _iface_instance = None
                time.sleep(1)

        print("[-] All scan attempts failed.")
        return []

    finally:
        _scan_lock.release()