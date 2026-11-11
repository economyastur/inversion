# Simulador de inversión

App web personal para comparar ETF que se pueden comprar desde España y practicar con una cartera ficticia. No mueve dinero real ni es una recomendación de inversión.

Misma línea visual que las apps de mobilityastur (Costa, Carretera): móvil primero, instalable en la pantalla de inicio.

## Qué hace

- **Simulador de aportaciones**: aportación inicial, mensual y comisión por compra sobre precios históricos reales.
- **Ranking configurable**: pondera rentabilidad, estabilidad y caídas.
- **Cartera ficticia**: compras y ventas con 10.000 € virtuales al último cierre. Se guarda solo en el navegador.

## Cómo se actualizan los datos

`.github/workflows/update-data.yml` ejecuta `scripts/fetch_prices.py` cada día laborable (18:23 UTC) y guarda el resultado en `data/prices.json`. También se puede lanzar a mano desde la pestaña **Actions** → *Actualizar precios* → *Run workflow*.

Los precios son cierres diarios de Yahoo Finance (XETRA, en euros). Es una fuente no oficial, pensada aquí para uso personal y pruebas.

## Añadir o quitar productos

Edita `data/catalog.json`. Cada producto necesita un `id` único, el símbolo de Yahoo Finance (`yahoo`), ISIN, categoría y TER. Al guardar el cambio, los precios se descargan solos.

## Puesta en marcha

1. Settings → Pages → *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
2. Settings → Actions → General → *Workflow permissions* → **Read and write permissions**.
