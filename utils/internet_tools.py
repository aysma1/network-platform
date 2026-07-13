"""
internet_tools.py
WHOIS ve DNS sorgulama — python-whois + dnspython (ücretsiz)
Kurulum: pip install python-whois dnspython
"""

import socket
from datetime import datetime

try:
    import whois as pywhois
    _HAS_WHOIS = True
except ImportError:
    _HAS_WHOIS = False

try:
    import dns.resolver
    import dns.reversename
    import dns.exception
    _HAS_DNS = True
except ImportError:
    _HAS_DNS = False

# WHOIS için varsayılan soket timeout (saniye).
# python-whois kütüphanesi kendi timeout parametresi almıyor;
# ham soket kullanıyor. Kurumsal ağlarda port 43 (WHOIS) sessizce
# engellenirse bu olmadan sorgu SONSUZA KADAR askıda kalır ve
# Flask'ın tek-thread'li dev server'ını tamamen kilitler.
WHOIS_SOCKET_TIMEOUT = 6


def _fmt_date(val):
    if val is None:
        return None
    if isinstance(val, list):
        val = val[0]
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S UTC")
    return str(val)


def _clean(val):
    if val is None:
        return None
    if isinstance(val, list):
        val = [v for v in val if v]
        return val[0] if len(val) == 1 else val if val else None
    return val


def _is_ip(target: str) -> bool:
    try:
        socket.inet_aton(target)
        return True
    except Exception:
        return False


# ── WHOIS ─────────────────────────────────────────────────

def query_whois(target: str) -> dict:
    if not _HAS_WHOIS:
        return {"error": "python-whois kurulu değil: pip install python-whois"}

    target = target.strip().lower()
    if not target:
        return {"error": "Domain veya IP giriniz."}

    # 1. Aşama: Standart WHOIS Sorgusu Dene
    old_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(WHOIS_SOCKET_TIMEOUT)
    try:
        w = pywhois.whois(target)
        if w and w.domain_name:
            ns = w.name_servers
            ns = sorted({str(n).lower() for n in ns if n}) if isinstance(ns, (list, set)) else ([str(ns).lower()] if ns else [])
            emails = [emails] if isinstance(w.emails, str) else (sorted({str(e).lower() for e in w.emails if e}) if isinstance(w.emails, (list, set)) else [])
            
            return {
                "query":            target,
                "domain_name":      _clean(w.domain_name),
                "registrar":        _clean(w.registrar),
                "whois_server":     _clean(w.whois_server),
                "creation_date":    _fmt_date(w.creation_date),
                "expiration_date":  _fmt_date(w.expiration_date),
                "updated_date":     _fmt_date(w.updated_date),
                "status":           w.status if isinstance(w.status, list) else ([w.status] if w.status else []),
                "name_servers":     ns,
                "emails":           emails,
                "name":             _clean(w.name),
                "org":              _clean(w.org),
                "country":          _clean(w.country),
                "state":            _clean(w.state),
                "city":             _clean(w.city),
                "address":          _clean(w.address),
                "dnssec":           _clean(w.dnssec),
            }
    except (socket.timeout, Exception):
        # Eğer Port 43 engellendiyse ya da hata alındıysa sessizce 2. Aşamaya geç
        pass
    finally:
        socket.setdefaulttimeout(old_timeout)

    # 2. Aşama: Port 443 üzerinden HTTP tabanlı RDAP Web API sorgusu (Ağ engellerini bypass eder)
    try:
        import urllib.request
        import json
        import ssl
        
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        # RDAP (Registration Data Access Protocol) HTTP tabanlı standart WHOIS alternatifidir
        url = f"https://rdap.org/domain/{target}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        
        with urllib.request.urlopen(req, context=ctx, timeout=6) as response:
            data = json.loads(response.read().decode())
            
        # RDAP verisini mevcut WHOIS şablonuna uydurarak parse edelim
        events = data.get("events", [])
        c_date, u_date, e_date = None, None, None
        for ev in events:
            action = ev.get("eventAction")
            date_str = ev.get("eventDate", "").replace("Z", " UTC")
            if action == "registration": c_date = date_str
            elif action == "last changed": u_date = date_str
            elif action == "expiration": e_date = date_str

        ns_list = [str(i.get("ldhName", "")).lower() for i in data.get("nameservers", []) if i.get("ldhName")]
        registrar_name = None
        for entity in data.get("entities", []):
            if "registrar" in entity.get("roles", []):
                vcard = entity.get("vcardArray", [None, []])[1]
                for prop in vcard:
                    if prop[0] == "fn": registrar_name = prop[3]

        return {
            "query":            target,
            "domain_name":      data.get("ldhName", target),
            "registrar":        registrar_name or "RDAP Provider",
            "whois_server":     "https://rdap.org",
            "creation_date":    c_date,
            "expiration_date":  e_date,
            "updated_date":     u_date,
            "status":           data.get("status", []),
            "name_servers":     ns_list,
            "emails":           [],
            "name":             None,
            "org":              None,
            "country":          None,
            "state":            None,
            "city":             None,
            "address":          None,
            "dnssec":           "secure" if data.get("secureDNS", {}).get("delegated") else "unsigned",
        }
    except Exception as final_err:
        return {"error": f"Ağ kısıtlaması nedeniyle Port 43 ve Web API sorguları başarısız oldu: {str(final_err)}"}

# ── DNS ───────────────────────────────────────────────────

DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "SRV", "CAA", "PTR"]

def query_dns(target: str, record_types: list = None) -> dict:
    if not _HAS_DNS:
        return {"error": "dnspython kurulu değil: pip install dnspython"}

    target = target.strip().lower()
    if target.startswith("www."):
        target = target[4:]
    if not target:
        return {"error": "Domain giriniz."}

    if record_types is None:
        record_types = DNS_TYPES

    # Bazı ağlarda (özellikle ev/ISP tarafında) sistemin varsayılan DNS
    # sunucusu Python'dan atılan ham sorgulara yavaş/tutarsız cevap verip
    # timeout'a düşebiliyor. Bu yüzden önce sistem varsayılanını deniyoruz,
    # hiç sonuç gelmezse herkese açık, güvenilir resolver'lara (Cloudflare
    # ve Google) düşüyoruz. Kurumsal ağlarda genelde sistem varsayılanı
    # zaten çalışıyor, bu yüzden fallback'e hiç gerek kalmıyor.
    resolver_configs = [
        ("system", None),
        ("fallback (1.1.1.1 / 8.8.8.8)", ["1.1.1.1", "8.8.8.8"]),
    ]

    results = {}
    errors_seen = []
    used_resolver = None

    for label, nameservers in resolver_configs:
        results = {}
        errors_seen = []
        resolver = dns.resolver.Resolver()
        if nameservers:
            resolver.nameservers = nameservers
        resolver.timeout = 3
        resolver.lifetime = 5

        for rtype in record_types:
            try:
                if rtype == "PTR" and _is_ip(target):
                    rev = dns.reversename.from_address(target)
                    answers = resolver.resolve(rev, "PTR")
                    results["PTR"] = [str(r) for r in answers]
                elif rtype == "PTR":
                    continue
                else:
                    answers = resolver.resolve(target, rtype)
                    records = []
                    for r in answers:
                        if rtype == "MX":
                            records.append({"priority": r.preference, "exchange": str(r.exchange).rstrip(".")})
                        elif rtype == "SOA":
                            records.append({
                                "mname": str(r.mname).rstrip("."), "rname": str(r.rname).rstrip("."),
                                "serial": r.serial, "refresh": r.refresh,
                                "retry": r.retry, "expire": r.expire, "minimum": r.minimum,
                            })
                        elif rtype == "SRV":
                            records.append({"priority": r.priority, "weight": r.weight, "port": r.port, "target": str(r.target).rstrip(".")})
                        elif rtype == "TXT":
                            records.append(b"".join(r.strings).decode("utf-8", errors="ignore"))
                        elif rtype == "CAA":
                            records.append({"flags": r.flags, "tag": r.tag.decode(), "value": r.value.decode()})
                        else:
                            records.append(str(r).rstrip("."))
                    if records:
                        results[rtype] = records
            except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
                pass
            except dns.exception.Timeout:
                errors_seen.append(f"{rtype}: timeout ({label})")
            except Exception as e:
                errors_seen.append(f"{rtype}: {e}")

        used_resolver = label
        if results:
            # Bu resolver ile en az bir kayıt bulduk, devam etmeye gerek yok.
            break

    if _is_ip(target) and "PTR" not in results:
        try:
            results["PTR"] = [socket.gethostbyaddr(target)[0]]
        except Exception:
            pass

    response = {
        "query": target,
        "records": results,
        "total": sum(len(v) if isinstance(v, list) else 1 for v in results.values()),
        "resolver_used": used_resolver,
    }
    # Hiç kayıt bulunamadıysa, teşhis için hataları da ekle (arayüz göstermese de faydalı)
    if not results and errors_seen:
        response["debug_errors"] = errors_seen
    return response


# ── IP Geolocation (ip-api.com — ücretsiz, API key yok) ──
def query_ip_info(ip: str) -> dict:
    import urllib.request
    import json
    import ssl  # SSL context yönetimi için eklendi

    ip = ip.strip()
    if not ip:
        return {"error": "IP adresi gerekli."}

    # SSL sertifika hatalarını (Missing Authority Key vb.) bypass etmek için context
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    proxies = urllib.request.getproxies()
    # Hem proxy handler'ı hem de hazırladığımız güvensiz SSL context'ini beraber yükleyen bir opener kuruyoruz
    if proxies:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler(proxies),
            urllib.request.HTTPSHandler(context=ctx)
        )
    else:
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ctx)
        )

    providers = [
        {
            "name": "ip-api.com",
            # Hata ihtimaline karşı ip-api.com HTTP (port 80) üzerinden sorgulanabilir
            "url": f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,query",
            "parse": lambda d: None if d.get("status") == "fail" else {
                "ip": d.get("query"), "country": d.get("country"),
                "country_code": d.get("countryCode"), "region": d.get("regionName"),
                "city": d.get("city"), "zip": d.get("zip"),
                "lat": d.get("lat"), "lon": d.get("lon"),
                "timezone": d.get("timezone"), "isp": d.get("isp"),
                "org": d.get("org"), "as": d.get("as"),
            },
        },
        {
            "name": "ipwho.is",
            "url": f"https://ipwho.is/{ip}",
            "parse": lambda d: None if not d.get("success", True) else {
                "ip": d.get("ip"), "country": d.get("country"),
                "country_code": d.get("country_code"), "region": d.get("region"),
                "city": d.get("city"), "zip": d.get("postal"),
                "lat": d.get("latitude"), "lon": d.get("longitude"),
                "timezone": (d.get("timezone") or {}).get("id"),
                "isp": (d.get("connection") or {}).get("isp"),
                "org": (d.get("connection") or {}).get("org"),
                "as": (d.get("connection") or {}).get("asn"),
            },
        },
    ]

    last_error = None
    for provider in providers:
        try:
            req = urllib.request.Request(
                provider["url"],
                headers={"User-Agent": "Mozilla/5.0 (network-platform internet-tools)"},
            )
            with opener.open(req, timeout=6) as resp:
                data = json.loads(resp.read().decode())
            parsed = provider["parse"](data)
            if parsed:
                return parsed
            last_error = data.get("message") or "boş/başarısız cevap"
        except Exception as e:
            reason = getattr(e, "reason", None)
            detail = f"{reason}" if reason else (str(e) or repr(e))
            last_error = f"{provider['name']}: {type(e).__name__} — {detail}"
            continue

    proxy_note = " (Sistem proxy tespit edildi: " + ", ".join(proxies.values()) + ")" if proxies else " (Sistemde proxy tanımlı değil)"
    return {"error": f"IP bilgisi alınamadı. Denenen tüm kaynaklar başarısız oldu.{proxy_note} Son hata: {last_error}"}