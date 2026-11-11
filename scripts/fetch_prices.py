#!/usr/bin/env python3
"""Descarga los cierres diarios de cada producto del catalogo y escribe data/prices.json.

Solo usa la biblioteca estandar. Si un simbolo falla, se conserva lo que ya habia.
Uso: python3 scripts/fetch_prices.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "catalog.json"
OUT = ROOT / "data" / "prices.json"
STATUS = ROOT / "data" / "estado.json"
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=0&period2={now}&interval=1d"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
DAILY_KEEP = 400  # dias de cotizacion que se guardan con detalle diario


def download(sym):
    url = URL.format(sym=urllib.parse.quote(sym), now=int(time.time()))
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except Exception as exc:  # reintento con espera creciente
            last = exc
            time.sleep(2 * (attempt + 1))
    raise last


def parse(payload):
    """Convierte la respuesta de Yahoo en {moneda, nombre, mensual, diario, ultimo}."""
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise ValueError(str(chart["error"]))
    res = chart["result"][0]
    stamps = res.get("timestamp") or []
    ind = res["indicators"]
    closes = (ind.get("adjclose") or [{}])[0].get("adjclose") or ind["quote"][0]["close"]
    days = []
    for ts, px in zip(stamps, closes):
        if px is None or px <= 0:
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        if days and days[-1][0] == day:
            days[-1][1] = round(px, 4)
        else:
            days.append([day, round(px, 4)])
    meta = res.get("meta") or {}
    return pack(days, meta.get("currency"), meta.get("longName") or meta.get("shortName"))


def pack(days, currency, name):
    """days: lista [[AAAA-MM-DD, precio], ...] ordenada por fecha."""
    if len(days) < 2:
        raise ValueError("sin datos")
    monthly = {}
    for day, px in days:  # el ultimo cierre de cada mes
        monthly[day[:7]] = px
    return {
        "moneda": currency,
        "nombre_fuente": name,
        "mensual": [[m, p] for m, p in sorted(monthly.items())],
        "diario": days[-DAILY_KEEP:],
        "ultimo": {"fecha": days[-1][0], "precio": days[-1][1]},
    }


def from_yfinance(prod):
    import yfinance as yf  # opcional: se instala en la tarea de GitHub
    tk = yf.Ticker(prod["yahoo"])
    hist = tk.history(period="max", interval="1d", auto_adjust=True)
    days = [[idx.strftime("%Y-%m-%d"), round(float(px), 4)] for idx, px in hist["Close"].items() if px == px and px > 0]
    name = currency = None
    try:
        meta = tk.history_metadata or {}
        name, currency = meta.get("longName") or meta.get("shortName"), meta.get("currency")
    except Exception:
        pass
    return pack(days, currency, name)


def from_yahoo(prod):
    return parse(download(prod["yahoo"]))


def from_justetf(prod):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    url = ("https://www.justetf.com/api/etfs/{isin}/performance-chart?locale=en&currency=EUR&valuesType=MARKET_VALUE"
           "&reduceData=false&includeDividends=false&features=DIVIDENDS&dateFrom=1990-01-01&dateTo={today}").format(isin=prod["isin"], today=today)
    req = urllib.request.Request(url, headers=dict(HEADERS, Accept="application/json"))
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.load(resp)
    days = []
    for row in payload.get("series") or []:
        val = row.get("value")
        px = val.get("raw") if isinstance(val, dict) else val
        if row.get("date") and isinstance(px, (int, float)) and px > 0:
            days.append([row["date"][:10], round(float(px), 4)])
    days.sort()
    return pack(days, "EUR", "justETF " + prod["isin"])


def cross_check(data, prod):
    """Contrasta las variaciones mensuales con justETF y sustituye las que difieren mucho.

    Devuelve la lista de meses corregidos. Los precios recientes no cambian: la serie se
    reconstruye hacia atras desde el ultimo cierre.
    """
    ref = dict(from_justetf(prod)["mensual"])
    m = data["mensual"]
    rets, flagged = [None], []
    for i in range(1, len(m)):
        ry = m[i][1] / m[i - 1][1] - 1
        rj = None
        if m[i][0] in ref and m[i - 1][0] in ref:
            rj = ref[m[i][0]] / ref[m[i - 1][0]] - 1
        if rj is not None and abs(ry - rj) > 0.05:
            flagged.append({"mes": m[i][0], "original": round(ry, 4), "justetf": round(rj, 4)})
            rets.append(rj)
        else:
            rets.append(ry)
    if not flagged:
        return []
    if len(flagged) > 6:
        raise ValueError(f"{len(flagged)} meses discrepantes: no se corrige")
    px = m[-1][1]
    for i in range(len(m) - 1, 0, -1):
        px = px / (1 + rets[i])
        m[i - 1][1] = round(px, 4)
    return flagged


SOURCES = [("yfinance", from_yfinance), ("yahoo", from_yahoo), ("justetf", from_justetf)]


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["productos"]
    try:
        previous = json.loads(OUT.read_text(encoding="utf-8")).get("activos", {})
    except Exception:
        previous = {}
    assets, errors, status = {}, {}, {}
    for prod in catalog:
        pid, sym = prod["id"], prod["yahoo"]
        log = {}
        pref = prod.get("fuente")  # fuente preferida para este producto, si se indica
        for name, fn in sorted(SOURCES, key=lambda x: x[0] != pref):
            try:
                data = fn(prod)
                data["yahoo"], data["origen"] = sym, name
                assets[pid] = data
                log[name] = "ok"
                if name != "justetf":
                    try:
                        fixes = cross_check(data, prod)
                        log["contraste_justetf"] = fixes or "sin diferencias"
                        if fixes:
                            data["correcciones"] = [f["mes"] for f in fixes]
                    except Exception as exc:
                        log["contraste_justetf"] = f"no realizado: {type(exc).__name__}: {exc}"[:200]
                print(f"ok    {sym:10s} {name}: {len(data['mensual'])} meses, ultimo {data['ultimo']}")
                break
            except Exception as exc:
                log[name] = f"{type(exc).__name__}: {exc}"[:200]
                print(f"ERROR {sym:10s} {name}: {exc}", file=sys.stderr)
        status[pid] = log
        if pid not in assets:
            errors[pid] = sym
            if pid in previous:
                assets[pid] = previous[pid]
        time.sleep(1)
    STATUS.write_text(json.dumps({"ejecutado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "fuentes": status}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if not assets:
        print("No se ha podido descargar ningun producto; no se modifica el fichero.", file=sys.stderr)
        return 1
    out = {
        "actualizado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "fuente": "Yahoo Finance / justETF (cierres diarios)",
        "errores": errors,
        "activos": assets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return 1 if len(errors) == len(catalog) else 0


if __name__ == "__main__":
    sys.exit(main())
