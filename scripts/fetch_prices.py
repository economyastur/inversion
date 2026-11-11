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
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=0&period2={now}&interval=1d"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
DAILY_KEEP = 400  # dias de cotizacion que se guardan con detalle diario


def download(sym):
    url = URL.format(sym=urllib.parse.quote(sym), now=int(time.time()))
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except Exception as exc:  # reintento con espera creciente
            last = exc
            time.sleep(3 * (attempt + 1))
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
    if len(days) < 2:
        raise ValueError("sin datos")
    monthly = {}
    for day, px in days:  # el ultimo cierre de cada mes
        monthly[day[:7]] = px
    meta = res.get("meta") or {}
    return {
        "moneda": meta.get("currency"),
        "nombre_fuente": meta.get("longName") or meta.get("shortName"),
        "mensual": [[m, p] for m, p in sorted(monthly.items())],
        "diario": days[-DAILY_KEEP:],
        "ultimo": {"fecha": days[-1][0], "precio": days[-1][1]},
    }


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["productos"]
    try:
        previous = json.loads(OUT.read_text(encoding="utf-8")).get("activos", {})
    except Exception:
        previous = {}
    assets, errors = {}, {}
    for prod in catalog:
        pid, sym = prod["id"], prod["yahoo"]
        try:
            data = parse(download(sym))
            data["yahoo"] = sym
            assets[pid] = data
            print(f"ok    {sym:10s} {len(data['mensual'])} meses, ultimo {data['ultimo']}")
        except Exception as exc:
            errors[pid] = f"{sym}: {exc}"
            print(f"ERROR {sym:10s} {exc}", file=sys.stderr)
            if pid in previous:
                assets[pid] = previous[pid]
        time.sleep(1.5)
    if not assets:
        print("No se ha podido descargar ningun producto; no se modifica el fichero.", file=sys.stderr)
        return 1
    out = {
        "actualizado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "fuente": "Yahoo Finance (cierres diarios)",
        "errores": errors,
        "activos": assets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return 1 if len(errors) == len(catalog) else 0


if __name__ == "__main__":
    sys.exit(main())
