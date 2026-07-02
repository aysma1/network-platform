def classify_device(hostname, vendor, ip, ttl_str):
    """
    Hostname, vendor, IP ve TTL'e göre cihaz tipini, ikonunu ve OS tahminini döndürür.
    Returns: (device_type, icon, os_guess, ttl_str)
    """
    hn = (hostname or "").lower()
    vd = vendor.lower()

    try:
        ttl = int(ttl_str)
    except Exception:
        ttl = 0

    # 1. Apple & Android cihazlar
    if "iphone" in hn or "ipad" in hn or "macbook" in hn or "apple" in vd:
        return "iOS / macOS", "fa-mobile-button", "iOS / macOS", ttl_str
    if "android" in hn or "samsung" in vd or "xiaomi" in vd or "huawei" in vd:
        return "Android Mobile", "fa-mobile-screen-button", "Android OS", ttl_str

    # 2. Altyapı elemanları
    if "vmware" in vd or "virtualbox" in vd or "virtual" in vd:
        return "Virtual Machine", "fa-server", "Hypervisor Guest", ttl_str
    if ip.endswith(".1") or "router" in hn or "gateway" in hn or "tp-link" in vd or "cisco" in vd:
        return "Gateway / Router", "fa-wifi", "Embedded Linux", ttl_str

    # 3. Ağ isminden PC/Laptop tespiti
    if any(k in hn for k in ("laptop", "desktop", "pc", "computer", "notebook")):
        if ttl >= 128 or "windows" in hn:
            return "Windows PC / Laptop", "fa-desktop", "Windows OS", ttl_str
        return "PC / Laptop", "fa-laptop", "Linux / macOS or Windows", ttl_str

    # 4. TTL tabanlı OS tahmini
    if ttl >= 128:
        return "Windows PC / Laptop", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64 and any(k in vd for k in ("intel", "asus", "realtek", "lenovo", "gigabyte", "hp", "dell", "msi")):
        if "printer" not in hn:
            return "PC / Laptop Node", "fa-laptop", "Linux / macOS / Windows", ttl_str

    # 5. IoT / Özel donanımlar
    if "hikvision" in vd or "dahua" in vd or "camera" in hn or "nvr" in hn:
        return "IP Camera / NVR", "fa-video", "Embedded Linux", ttl_str

    is_hp_printer = (
        "hp" in vd
        and not any(k in hn for k in ("laptop", "desktop", "pc", "note", "pavilion", "elitebook", "probook", "envy", "spectre", "omen"))
        and any(k in hn for k in ("print", "laserjet", "officejet", "deskjet", "mfp"))
    )
    if "printer" in hn or "brother" in vd or "epson" in vd or "canon" in vd or is_hp_printer:
        return "Network Printer", "fa-print", "Embedded OS", ttl_str

    # Fallback
    if ttl >= 128:
        return "Windows PC", "fa-desktop", "Windows OS", ttl_str
    if ttl >= 64:
        return "Linux OS Device", "fa-laptop", "Linux OS", ttl_str
    if any(k in vd for k in ("hp", "dell", "lenovo", "asus", "acer")):
        return "Computer Node (Unverified TTL)", "fa-laptop", "Unknown OS", ttl_str

    return "Network Node / IoT", "fa-network-wired", "Unknown OS", ttl_str
