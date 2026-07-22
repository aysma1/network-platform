"""
utils/bluetooth_scanner.py

BLE (Bluetooth Low Energy) device discovery module for Network Radar.

Every field returned to the caller is tagged with how it was obtained:
  - "known"    -> came directly from the device's advertisement data
  - "inferred" -> guessed by matching manufacturer IDs / service UUIDs
                  against public reference tables (not guaranteed accurate)

This keeps the distinction between real data and best-effort guesses
visible all the way to the frontend, instead of silently blending them.
"""

import asyncio
from typing import Optional
from bleak import BleakScanner

# Bluetooth SIG "Company Identifier" -> vendor name.
# Reference: https://www.bluetooth.com/specifications/assigned-numbers/company-identifiers/
# This is a small, commonly-seen subset, not the full registry.
KNOWN_MANUFACTURERS = {
    0x004C: "Apple",
    0x0006: "Microsoft",
    0x00E0: "Google",
    0x0075: "Samsung",
    0x0157: "Huami (Amazfit / Xiaomi wearables)",
    0x0171: "Amazon",
    0x038F: "Xiaomi",
    0x0087: "Garmin",
    0x02E5: "Espressif (ESP32-based devices)",
    0x0059: "Nordic Semiconductor",
}

# Standard 16-bit GATT service UUIDs -> what kind of device commonly exposes them.
# Reference: https://www.bluetooth.com/specifications/assigned-numbers/
SERVICE_TYPE_HINTS = {
    "0000180f": "Wearable / sensor (exposes Battery Service)",
    "0000180d": "Heart rate monitor",
    "0000110b": "Audio device (headset / speaker)",
    "0000fe9f": "Google Fast Pair device",
    "0000fd6f": "Phone (Exposure Notification service)",
    "0000181a": "Environmental sensor",
    "00001812": "HID device (keyboard / mouse / remote)",
}


def _guess_manufacturer(manufacturer_data: dict) -> Optional[str]:
    """Return an inferred manufacturer name from BLE manufacturer data, or None."""
    if not manufacturer_data:
        return None
    for company_id in manufacturer_data.keys():
        if company_id in KNOWN_MANUFACTURERS:
            return KNOWN_MANUFACTURERS[company_id]
    return None


def _guess_device_type(service_uuids: list) -> Optional[str]:
    """Return an inferred device category from advertised service UUIDs, or None."""
    for uuid in service_uuids or []:
        short_uuid = uuid.lower()[:8]
        if short_uuid in SERVICE_TYPE_HINTS:
            return SERVICE_TYPE_HINTS[short_uuid]
    return None


def _signal_label(rssi: int) -> str:
    """Rough human-readable distance estimate from RSSI. Always an estimate."""
    if rssi >= -50:
        return "Very close (same room)"
    if rssi >= -70:
        return "Nearby (same/adjacent room)"
    if rssi >= -90:
        return "Far (through walls / distant)"
    return "Very weak / unreliable"


async def _discover(timeout: float, min_rssi: int) -> list[dict]:

    scanner = BleakScanner(
        scanning_mode="active",
        cb=dict(use_bdaddr=True)
    )

    discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)

    devices = []
    for address, (device, adv_data) in discovered.items():
        rssi = adv_data.rssi
        if rssi < min_rssi:
            continue

        real_name = device.name
        service_uuids = list(adv_data.service_uuids) if adv_data.service_uuids else []
        manufacturer_guess = _guess_manufacturer(adv_data.manufacturer_data)
        type_guess = _guess_device_type(service_uuids, adv_data.manufacturer_data)

        # manufacturer_data keys are ints (company IDs), values are raw bytes.
        # Convert to a JSON/display-friendly form.
        manufacturer_data_hex = {
            f"0x{company_id:04X}": data.hex()
            for company_id, data in adv_data.manufacturer_data.items()
        }

        devices.append({
            "address": address,                      # known - always present
            "name": real_name,                        # known if not None
            "display_name": real_name or manufacturer_guess or "Unknown device",
            "name_source": "known" if real_name else (
                "inferred" if manufacturer_guess else "unavailable"
            ),
            "rssi": rssi,                              # known
            "signal_estimate": _signal_label(rssi),     # inferred (distance guess)
            "manufacturer_guess": manufacturer_guess,   # inferred, may be None
            "device_type_guess": type_guess,             # inferred, may be None
            "service_uuids": service_uuids,              # known
            "manufacturer_data": manufacturer_data_hex,  # known (raw bytes)
            "tx_power": adv_data.tx_power,                # known, may be None
        })

    devices.sort(key=lambda d: d["rssi"], reverse=True)
    return devices


def scan_bluetooth_sync(timeout: float = 8.0, min_rssi: int = -90) -> list[dict]:
    """
    Synchronous wrapper around the async BLE scan, safe to call from a
    normal Flask route (Flask routes are sync by default).

    timeout  -> seconds to listen for BLE advertisements
    min_rssi -> discard devices weaker than this (filters distant/noisy results)
    """
    return asyncio.run(_discover(timeout=timeout, min_rssi=min_rssi))


if __name__ == "__main__":
    # Quick manual test: python utils/bluetooth_scanner.py
    results = scan_bluetooth_sync()
    print(f"Found {len(results)} device(s):\n")
    for d in results:
        tag = "" if d["name_source"] == "known" else f" ({d['name_source']})"
        print(f"{d['rssi']:>5} dBm | {d['display_name']:<28}{tag:<12} | {d['address']}")

def _guess_apple_device_type(data_bytes: bytes) -> Optional[str]:
    """Apple'ın özel reklam paketinden cihaz tipini tahmin eder."""
    if not data_bytes or len(data_bytes) < 2:
        return None
    
    type_byte = data_bytes[0]
    # Apple Proximity Pairing / AirDrop / Continuity tipleri
    if type_byte == 0x10:  # Nearby / Continuity
        return "Apple Device (iPhone / iPad / Mac)"
    elif type_byte == 0x07: # AirPods / HomePod
        return "Apple Audio Device (AirPods / HomePod)"
    elif type_byte == 0x12: # AirTag / Find My network
        return "Apple Find My Network Item (AirTag / Tracker)"
    elif type_byte == 0x02: # iBeacon
        return "iBeacon Beacon"
    
    return "Apple Device"

def _guess_device_type(service_uuids: list, manufacturer_data: dict) -> Optional[str]:
    # 1. Öncelik: Servis UUID'leri
    for uuid in service_uuids or []:
        short_uuid = uuid.lower()[:8]
        if short_uuid in SERVICE_TYPE_HINTS:
            return SERVICE_TYPE_HINTS[short_uuid]
            
    # 2. Öncelik: Apple'a özel paket analizi (Apple servis UUID göndermediği için)
    if 0x004C in manufacturer_data:
        apple_guess = _guess_apple_device_type(manufacturer_data[0x004C])
        if apple_guess:
            return apple_guess

    return None