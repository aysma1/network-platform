"""
internet_tools.py
WHOIS, DNS Lookup, IP Geolocation, and SSL Certificate Checker
Free tools using standard Python libraries, python-whois, and dnspython.
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

# Default socket timeout (seconds) for WHOIS queries.
# Since python-whois uses raw sockets, kurumsal/restricted networks can cause
# queries to hang indefinitely without a timeout. This protects Flask from locking up.
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
        return {"error": "python-whois is not installed. Please run: pip install python-whois"}

    target = target.strip().lower()
    if not target:
        return {"error": "Please enter a valid Domain or IP address."}

    # Stage 1: Standard WHOIS query using raw socket port 43
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
        # Fallback to Stage 2 if Port 43 is blocked or times out
        pass
    finally:
        socket.setdefaulttimeout(old_timeout)

    # Stage 2: Web-based HTTP RDAP API (Bypasses local port blockages over port 443)
    try:
        import urllib.request
        import json
        import ssl
        
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        url = f"https://rdap.org/domain/{target}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        
        with urllib.request.urlopen(req, context=ctx, timeout=6) as response:
            data = json.loads(response.read().decode())
            
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
        return {"error": f"Both standard WHOIS (Port 43) and fallback RDAP (HTTP API) queries failed: {str(final_err)}"}


# ── DNS ───────────────────────────────────────────────────

DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "SRV", "CAA", "PTR"]

def query_dns(target: str, record_types: list = None) -> dict:
    if not _HAS_DNS:
        return {"error": "dnspython is not installed. Please run: pip install dnspython"}

    target = target.strip().lower()
    if target.startswith("www."):
        target = target[4:]
    if not target:
        return {"error": "Please enter a valid domain name."}

    if record_types is None:
        record_types = DNS_TYPES

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
    if not results and errors_seen:
        response["debug_errors"] = errors_seen
    return response


# ── IP Geolocation ────────────────────────────────────────

def query_ip_info(ip: str) -> dict:
    import urllib.request
    import json
    import ssl

    ip = ip.strip()
    if not ip:
        return {"error": "IP address is required."}

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    proxies = urllib.request.getproxies()
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
            last_error = data.get("message") or "empty/invalid response"
        except Exception as e:
            reason = getattr(e, "reason", None)
            detail = f"{reason}" if reason else (str(e) or repr(e))
            last_error = f"{provider['name']}: {type(e).__name__} — {detail}"
            continue

    proxy_note = " (System proxy detected: " + ", ".join(proxies.values()) + ")" if proxies else " (No system proxy configured)"
    return {"error": f"Failed to retrieve IP geolocation. All providers failed.{proxy_note} Last recorded error: {last_error}"}


# ── SSL Certificate Query (SSL Checker) ─────────────────

def query_ssl(target: str) -> dict:
    """
    Retrieves and parses SSL certificate details securely using OpenSSL.
    Supports self-signed, expired, and incomplete certificate chains.
    """
    import ssl
    import socket
    from datetime import datetime
    try:
        from OpenSSL import crypto
    except ImportError:
        # Fallback automatically if pyOpenSSL is not installed in the workspace
        return _query_ssl_fallback(target)

    target = target.strip().lower()
    if target.startswith("http://"):
        target = target[7:]
    if target.startswith("https://"):
        target = target[8:]
    if "/" in target:
        target = target.split("/")[0]
    if ":" in target:
        target = target.split(":")[0]

    if not target:
        return {"error": "Please enter a valid domain name."}

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        with socket.create_connection((target, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=target) as ssock:
                bin_cert = ssock.getpeercert(binary_form=True)
                
                x509 = crypto.load_certificate(crypto.FILETYPE_ASN1, bin_cert)
                
                # Parse Dates (Format: YYYYMMDDhhmmssZ)
                not_before_raw = x509.get_notBefore().decode("ascii")
                not_after_raw = x509.get_notAfter().decode("ascii")
                
                not_before = datetime.strptime(not_before_raw, "%Y%m%d%H%M%SZ")
                not_after = datetime.strptime(not_after_raw, "%Y%m%d%H%M%SZ")
                
                now = datetime.utcnow()
                days_left = (not_after - now).days
                is_expired = days_left < 0

                subject = x509.get_subject()
                issuer = x509.get_issuer()
                
                common_name = subject.CN or target
                issuer_org = issuer.O or "Unknown Authority"
                issuer_cn = issuer.CN or "N/A"
                
                # Parse Subject Alternative Names (SANs)
                sans = []
                for i in range(x509.get_extension_count()):
                    ext = x509.get_extension(i)
                    if ext.get_short_name() == b"subjectAltName":
                        sans_raw = str(ext).split(", ")
                        sans = [s.replace("DNS:", "").strip() for s in sans_raw if s.startswith("DNS:")]

                return {
                    "domain": target,
                    "common_name": common_name,
                    "issuer": issuer_org,
                    "issuer_common_name": issuer_cn,
                    "serial_number": str(x509.get_serial_number()),
                    "version": str(x509.get_version() + 1),
                    "not_before": not_before.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "not_after": not_after.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "days_left": max(0, days_left) if not is_expired else days_left,
                    "is_valid": not is_expired,
                    "sans": sans[:15]
                }

    except socket.timeout:
        return {"error": "Connection timed out. Port 443 might be closed or blocked on the destination host."}
    except Exception as e:
        return _query_ssl_fallback(target)


def _query_ssl_fallback(target: str) -> dict:
    """
    Fallback method using the 'cryptography' library to parse the certificate
    from a single TLS handshake (no second verified connection needed).
    """
    import ssl
    import socket
    from datetime import datetime
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend

    target = target.strip().lower()
    if target.startswith("http://"):
        target = target[7:]
    if target.startswith("https://"):
        target = target[8:]
    if "/" in target:
        target = target.split("/")[0]
    if ":" in target:
        target = target.split(":")[0]

    if not target:
        return {"error": "Please enter a valid domain name."}

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with socket.create_connection((target, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=target) as ssock:
                bin_cert = ssock.getpeercert(binary_form=True)

        cert = x509.load_der_x509_certificate(bin_cert, default_backend())

        not_before = cert.not_valid_before_utc.replace(tzinfo=None)
        not_after = cert.not_valid_after_utc.replace(tzinfo=None)
        now = datetime.utcnow()
        days_left = (not_after - now).days
        is_expired = days_left < 0

        def get_name_attr(name_obj, oid):
            attrs = name_obj.get_attributes_for_oid(oid)
            return attrs[0].value if attrs else None

        from cryptography.x509.oid import NameOID, ExtensionOID

        common_name = get_name_attr(cert.subject, NameOID.COMMON_NAME) or target
        issuer_org = get_name_attr(cert.issuer, NameOID.ORGANIZATION_NAME) or "Unknown Authority"
        issuer_cn = get_name_attr(cert.issuer, NameOID.COMMON_NAME) or "N/A"

        sans = []
        try:
            san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            sans = san_ext.value.get_values_for_type(x509.DNSName)
        except x509.ExtensionNotFound:
            pass

        return {
            "domain": target,
            "common_name": common_name,
            "issuer": issuer_org,
            "issuer_common_name": issuer_cn,
            "serial_number": str(cert.serial_number),
            "version": str(cert.version.value + 1) if hasattr(cert.version, "value") else str(cert.version),
            "not_before": not_before.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "not_after": not_after.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "days_left": max(0, days_left) if not is_expired else days_left,
            "is_valid": not is_expired,
            "sans": sans[:15]
        }

    except socket.timeout:
        return {"error": "Connection timed out. Port 443 might be closed or blocked on the destination host."}
    except Exception as e:
        return {"error": f"Failed to retrieve SSL details: {str(e)}"}