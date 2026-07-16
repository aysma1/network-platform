"""
utils/speed_test.py
--------------------
Ag hizi testi: ping, jitter, indirme, yukleme.
Diger utils modulleri gibi (scanner.py, network.py) fonksiyon tabanli.
"""

import json
import os
import time
import statistics
from datetime import datetime

import speedtest  # pip install speedtest-cli

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "speed_history.json")


def run_speed_test():
    """Tam bir hiz testi calistirir, sonucu dondurur ve gecmise kaydeder."""
    st = speedtest.Speedtest()
    st.get_best_server()

    ping_ms, jitter_ms = _measure_ping_jitter(st)
    download_bps = st.download()
    upload_bps = st.upload()

    result = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "ping_ms": round(ping_ms, 1),
        "jitter_ms": round(jitter_ms, 1),
        "download_mbps": round(download_bps / 1_000_000, 2),
        "upload_mbps": round(upload_bps / 1_000_000, 2),
        "server": {
            "name": st.results.server.get("sponsor"),
            "location": st.results.server.get("name"),
            "country": st.results.server.get("country"),
        },
    }

    _save_to_history(result)
    return result


def get_speed_history():
    """Kaydedilmis gecmis test sonuclarini dondurur (son 50 kayit)."""
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


# ---------------------------------------------------------------------- #
# Yardimci fonksiyonlar
# ---------------------------------------------------------------------- #
def _measure_ping_jitter(st: "speedtest.Speedtest", samples: int = 5):
    pings = []
    for _ in range(samples):
        st.get_best_server()
        pings.append(st.results.ping)
        time.sleep(0.05)
    ping_avg = statistics.mean(pings)
    jitter = statistics.pstdev(pings) if len(pings) > 1 else 0.0
    return ping_avg, jitter


def _save_to_history(result: dict) -> None:
    history = get_speed_history()
    history.append(result)
    history = history[-50:]
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)