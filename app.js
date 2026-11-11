"use strict";

// Datos generados por la tarea diaria del repositorio.
const URL_CATALOGO = "data/catalog.json";
const URL_PRECIOS = "data/prices.json";
const CLAVE_PLAN = "inversion:plan";
const CLAVE_CARTERA = "inversion.cartera.v1";
const EFECTIVO_INICIAL = 10000;
const PERIODOS = [[1, "1 año"], [3, "3 años"], [5, "5 años"], [10, "10 años"], [15, "15 años"], [0, "Todo"]];
const PERFILES = {
  crecer: { nombre: "Crecer", pesos: { ret: 8, stab: 1, dd: 1 }, pista: "Pesa sobre todo la rentabilidad, aunque haya más vaivenes." },
  equilibrado: { nombre: "Equilibrado", pesos: { ret: 6, stab: 2, dd: 2 }, pista: "Reparte el peso entre ganar y no sufrir grandes caídas." },
  prudente: { nombre: "Prudente", pesos: { ret: 2, stab: 4, dd: 4 }, pista: "Pesa sobre todo la estabilidad y evitar caídas." },
};

const vista = document.getElementById("vista");
let catalogo = [], precios = null, modelo = null, errorCarga = false;
let plan = Object.assign({ inicial: 1000, mensual: 100, comision: 1, deposito: 2, anios: 5, perfil: "equilibrado" }, leerJSON(CLAVE_PLAN));
let resaltado = null;      // opción resaltada en el gráfico de Comparar
let compraPre = null;      // producto preseleccionado al llegar a Cartera
let mensajeCartera = null; // { texto, mal }
let memoriaCartera = null;

function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
function leerJSON(k) { try { return JSON.parse(leer(k)) || {}; } catch (e) { return {}; } }

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" }));
const eur = (v, d = 0) => `${num(v, d)} €`;
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : `${num(v * 100, d).replace("-", "−")} %`);
const conSigno = (v, txt) => (v >= 0 ? "+" : "−") + txt.replace(/^[-−]/, "");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesTxt = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const diaTxt = (d) => `${+d.slice(8, 10)} ${mesTxt(d)}`;
const ICO = {
  flecha: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  atras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5v.5"/></svg>',
};

// ---------- motor de cálculo (funciones puras) ----------
// Aportación inicial en el mes de inicio y una mensual al final de cada mes siguiente.
function simular(r, inicio, inicial, mensual, comision) {
  const valores = [], aportado = [], flujos = [];
  let v = inicial > 0 ? Math.max(inicial - comision, 0) : 0, p = inicial;
  valores.push(v); aportado.push(p); flujos.push(inicial);
  for (let i = inicio + 1; i < r.length; i++) {
    v *= 1 + r[i];
    if (mensual > 0 && i < r.length - 1) { v += Math.max(mensual - comision, 0); p += mensual; flujos.push(mensual); }
    else flujos.push(0);
    valores.push(v); aportado.push(p);
  }
  return { valores, aportado, final: v, totalAportado: p, tir: tirAnual(flujos, v) };
}
// Rentabilidad anual del dinero aportado (TIR), por bisección.
function tirAnual(flujos, valorFinal) {
  const van = (t) => {
    let s = -valorFinal / Math.pow(1 + t, flujos.length - 1);
    for (let k = 0; k < flujos.length; k++) s += flujos[k] / Math.pow(1 + t, k);
    return s;
  };
  let lo = -0.2, hi = 0.2;
  if (!(van(lo) * van(hi) <= 0)) return NaN;
  for (let k = 0; k < 90; k++) { const mid = (lo + hi) / 2; if (van(lo) * van(mid) <= 0) hi = mid; else lo = mid; }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
function riesgo(r, inicio) {
  const w = r.slice(inicio + 1);
  if (w.length < 2) return { vol: 0, caida: 0 };
  const media = w.reduce((a, b) => a + b, 0) / w.length;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - media) ** 2, 0) / (w.length - 1));
  let idx = 1, pico = 1, dd = 0;
  for (const x of w) { idx *= 1 + x; pico = Math.max(pico, idx); dd = Math.min(dd, idx / pico - 1); }
  return { vol: sd * Math.sqrt(12), caida: dd };
}
// Puntuación 0-100: cada criterio se normaliza entre la peor y la mejor opción del periodo.
function puntuar(filas, w) {
  const norma = (clave, masEsMejor) => {
    const xs = filas.map((x) => x[clave]).filter(Number.isFinite), lo = Math.min(...xs), hi = Math.max(...xs);
    return (x) => (!Number.isFinite(x[clave]) ? 0 : hi === lo ? 1 : (masEsMejor ? x[clave] - lo : hi - x[clave]) / (hi - lo));
  };
  const a = norma("tir", true), b = norma("vol", false), c = norma("caida", true);
  const tot = w.ret + w.stab + w.dd || 1;
  filas.forEach((x) => { x.puntos = 100 * (w.ret * a(x) + w.stab * b(x) + w.dd * c(x)) / tot; });
  return filas.sort((x, y) => y.puntos - x.puntos);
}
// Eje común de meses y, por producto, precios de fin de mes.
function construirModelo() {
  const conDatos = catalogo.filter((p) => precios.activos[p.id] && precios.activos[p.id].mensual.length > 1);
  const meses = [...new Set(conDatos.flatMap((p) => precios.activos[p.id].mensual.map(([m]) => m)))].sort();
  const pos = Object.fromEntries(meses.map((m, i) => [m, i]));
  const activos = conDatos.map((p) => {
    const a = precios.activos[p.id], px = new Array(meses.length).fill(null);
    a.mensual.forEach(([m, v]) => { px[pos[m]] = v; });
    const primero = px.findIndex((v) => v != null);
    for (let i = primero + 1; i < px.length; i++) if (px[i] == null) px[i] = px[i - 1];
    const r = px.map((v, i) => (i > primero ? v / px[i - 1] - 1 : 0));
    return { ...p, px, r, primero, ultimo: a.ultimo, origen: a.origen, nombreFuente: a.nombre_fuente, moneda: a.moneda, correcciones: a.correcciones || [] };
  });
  return { meses, activos };
}
function calcular() {
  const n = modelo.meses.length;
  const comun = Math.max(...modelo.activos.map((a) => a.primero));
  const inicio = plan.anios > 0 ? Math.max(n - 1 - plan.anios * 12, 0) : comun;
  const dentro = modelo.activos.filter((a) => a.primero <= inicio), fuera = modelo.activos.filter((a) => a.primero > inicio);
  const dep = Math.pow(1 + plan.deposito / 100, 1 / 12) - 1;
  const opciones = dentro.map((a) => ({ id: a.id, nombre: a.nombre, categoria: a.categoria, r: a.r, comision: plan.comision }));
  opciones.push({ id: "dep", nombre: "Depósito", categoria: `Tipo fijo al ${num(plan.deposito, 2).replace(/,?0+$/, "")} %`, r: new Array(n).fill(dep), comision: 0 });
  const filas = opciones.map((x) => Object.assign(x, simular(x.r, inicio, plan.inicial, plan.mensual, x.comision), riesgo(x.r, inicio)));
  return { inicio, meses: modelo.meses.slice(inicio), filas: puntuar(filas, PERFILES[plan.perfil].pesos), fuera };
}

// ---------- gráficos (SVG propio) ----------
// series: [{ valores, color, ancho, opacidad, trazo, area }]; la escala es común a todas.
function grafico(series, etiquetas, { desdeCero = true, alto = 250, desc = "", fmt = (v) => num(v, 0) } = {}) {
  const W = 520, H = alto, izq = 6, der = 6, sup = 12, inf = 28;
  const todos = series.flatMap((s) => s.valores);
  let min = desdeCero ? 0 : Math.min(...todos), max = Math.max(...todos);
  if (max === min) max = min + 1;
  if (!desdeCero) { const m = (max - min) * 0.08; min -= m; max += m; }
  const n = etiquetas.length;
  const x = (i) => izq + (W - izq - der) * (n > 1 ? i / (n - 1) : 0);
  const y = (v) => sup + (H - sup - inf) * (1 - (v - min) / (max - min));
  const camino = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  let g = "";
  for (let k = 0; k <= 3; k++) {
    const v = min + (max - min) * k / 3, yy = y(v).toFixed(1);
    g += `<line x1="${izq}" x2="${W - der}" y1="${yy}" y2="${yy}" stroke="#262E45" stroke-width="1"/>`;
    if (k) g += `<text x="${izq + 2}" y="${(+yy + 16).toFixed(1)}" font-size="15" fill="#7F8AA8">${esc(fmt(v))}</text>`;
  }
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => {
    g += `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="15" fill="#7F8AA8" text-anchor="${["start", "middle", "end"][k]}">${esc(etiquetas[i])}</text>`;
  });
  series.forEach((s, k) => {
    const d = camino(s.valores);
    if (s.area) {
      g += `<defs><linearGradient id="ar${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`;
      g += `<path d="${d}L${x(n - 1).toFixed(1)} ${y(min).toFixed(1)}L${x(0).toFixed(1)} ${y(min).toFixed(1)}Z" fill="url(#ar${k})"/>`;
    }
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.ancho || 2}" stroke-opacity="${s.opacidad ?? 1}" ${s.trazo ? `stroke-dasharray="${s.trazo}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  const p = series.find((s) => s.principal);
  if (p) {
    g += `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(p.valores[n - 1]).toFixed(1)}" r="4.5" fill="${p.color}" stroke="#1B2238" stroke-width="2"/>`;
    g += `<g class="cursor" visibility="hidden"><line y1="${sup}" y2="${H - inf}" stroke="#9DA8C2" stroke-width="1" stroke-dasharray="3 3"/><circle r="5" fill="${p.color}" stroke="#1B2238" stroke-width="2"/></g>`;
  }
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(desc)}" font-family="Barlow, sans-serif" data-izq="${izq}" data-der="${der}" data-sup="${sup}" data-inf="${inf}" data-min="${min}" data-max="${max}">${g}</svg>`;
}
// Cursor táctil: al pasar el dedo o el ratón marca el mes y avisa con su índice (null al salir).
function activarCursor(svg, valores, alCambiar) {
  if (!svg) return;
  const W = 520, H = svg.viewBox.baseVal.height, d = svg.dataset, n = valores.length;
  const cur = svg.querySelector(".cursor");
  if (!cur) return;
  const mover = (ev) => {
    const caja = svg.getBoundingClientRect();
    const px = (ev.clientX - caja.left) / caja.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - +d.izq) / (W - +d.izq - +d.der) * (n - 1))));
    const cx = +d.izq + (W - +d.izq - +d.der) * (n > 1 ? i / (n - 1) : 0);
    const cy = +d.sup + (H - +d.sup - +d.inf) * (1 - (valores[i] - +d.min) / (+d.max - +d.min));
    cur.setAttribute("visibility", "visible");
    cur.querySelector("line").setAttribute("x1", cx); cur.querySelector("line").setAttribute("x2", cx);
    cur.querySelector("circle").setAttribute("cx", cx); cur.querySelector("circle").setAttribute("cy", cy);
    alCambiar(i);
  };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", () => { cur.setAttribute("visibility", "hidden"); alCambiar(null); });
}

// ---------- piezas comunes ----------
function cabecera(titulo, extra = "", sub = "") {
  const fecha = precios && precios.actualizado ? `Precios del ${diaTxt(precios.actualizado.slice(0, 10))}` : "Sin precios todavía";
  return `<header class="cabecera">
    <div class="fila"><span class="marca">economyastur · Inversión</span><span class="chip-estado">Simulación</span></div>
    ${extra}<h1 class="${titulo.length > 16 ? "medio" : ""}">${esc(titulo)}</h1>
    ${sub ? `<span class="hora">${esc(sub)}</span>` : ""}
    <span class="hora">${fecha} · No se mueve dinero real</span>
  </header>`;
}
function insignia(valor, texto, pie, neutra = false) {
  return `<div class="insignia ${neutra ? "neutra" : valor < 0 ? "neg" : ""}"><strong>${esc(texto)}</strong><span>${esc(pie)}</span></div>`;
}
function pie() {
  return `<p class="fuentes">Precios de cierre de <a href="https://finance.yahoo.com/" target="_blank" rel="noopener">Yahoo Finance</a> y <a href="https://www.justetf.com/" target="_blank" rel="noopener">justETF</a>, fuentes no oficiales. Lo ocurrido en el pasado no indica lo que ocurrirá: esto es una herramienta de aprendizaje, no una recomendación de inversión.</p>`;
}
function sinDatos() {
  vista.innerHTML = cabecera("Inversión") + `<section class="aviso">${ICO.aviso}<div><strong>${errorCarga ? "No se han podido leer los datos" : "Todavía no hay precios"}</strong>
    <span>${errorCarga ? "Comprueba la conexión y vuelve a abrir la app." : "Se descargan solos cada día laborable. Para la primera carga, lanza «Actualizar precios» desde la pestaña Actions del repositorio."}</span></div></section>`;
}

// ---------- Comparar ----------
function vistaComparar() {
  const res = calcular();
  const campo = (id, rotulo, valor, unidad, paso) => `<label class="campo"><span>${rotulo}</span><div><input id="${id}" type="number" inputmode="decimal" min="0" step="${paso}" value="${valor}"><em>${unidad}</em></div></label>`;
  let html = cabecera("Comparar");
  html += `<section class="plan" aria-label="Tu plan">
    ${campo("p-inicial", "Aportación inicial", plan.inicial, "€", 100)}
    ${campo("p-mensual", "Cada mes", plan.mensual, "€", 10)}
    ${campo("p-comision", "Comisión por compra", plan.comision, "€", 0.5)}
    ${campo("p-deposito", "Interés del depósito", plan.deposito, "% anual", 0.25)}
  </section>
  <div class="rotulo">Periodo simulado</div>
  <div class="chips" role="group" aria-label="Periodo simulado">${PERIODOS.map(([a, t]) => `<button type="button" data-anios="${a}" aria-pressed="${a === plan.anios}">${t}</button>`).join("")}</div>
  <div class="rotulo">Qué valoras más</div>
  <nav class="segmento" aria-label="Perfil">${Object.entries(PERFILES).map(([k, p]) => `<button type="button" data-perfil="${k}" aria-pressed="${k === plan.perfil}">${p.nombre}</button>`).join("")}</nav>
  <p class="pista">${PERFILES[plan.perfil].pista}</p>
  <div id="resultado">${resultadoHTML(res)}</div>` + pie();
  vista.innerHTML = html;
  enlazarResultado(res);

  const releer = () => {
    const v = (id) => { const x = parseFloat(document.getElementById(id).value); return Number.isFinite(x) && x >= 0 ? x : 0; };
    plan.inicial = v("p-inicial"); plan.mensual = v("p-mensual"); plan.comision = v("p-comision"); plan.deposito = Math.min(v("p-deposito"), 15);
    guardar(CLAVE_PLAN, JSON.stringify(plan));
    const r = calcular();
    document.getElementById("resultado").innerHTML = resultadoHTML(r);
    enlazarResultado(r);
  };
  vista.querySelectorAll(".plan input").forEach((el) => el.addEventListener("input", releer));
  vista.querySelectorAll("[data-anios]").forEach((b) => b.addEventListener("click", () => { plan.anios = +b.dataset.anios; guardar(CLAVE_PLAN, JSON.stringify(plan)); mantenerScroll(vistaComparar); }));
  vista.querySelectorAll("[data-perfil]").forEach((b) => b.addEventListener("click", () => { plan.perfil = b.dataset.perfil; guardar(CLAVE_PLAN, JSON.stringify(plan)); mantenerScroll(vistaComparar); }));
}
function mantenerScroll(fn) { const y = scrollY; fn(); scrollTo(0, y); }

function resultadoHTML(res) {
  if (plan.inicial + plan.mensual <= 0) return `<p class="vacio">Indica una aportación inicial o mensual para ver la comparación.</p>`;
  const top = res.filas[0];
  const sel = res.filas.find((f) => f.id === resaltado) || top;
  const desde = mesTxt(res.meses[0]), hasta = mesTxt(res.meses[res.meses.length - 1]);
  const etiquetas = res.meses.map(mesTxt);
  const series = res.filas.filter((f) => f.id !== sel.id).map((f) => ({ valores: f.valores, color: "#55618A", ancho: 1.3, opacidad: 0.75 }));
  series.push({ valores: sel.aportado, color: "#9DA8C2", ancho: 1.5, trazo: "5 4" });
  series.push({ valores: sel.valores, color: "#9DB2FF", ancho: 2.6, area: true, principal: true });
  const gan = sel.final - sel.totalAportado;
  let html = `<section class="tarjeta">
    <div class="cab"><h2>${sel.id === top.id ? "Mejor puntuada" : "Opción resaltada"}</h2><small>${desde} – ${hasta}</small></div>
    <div class="grande"><strong>${esc(sel.nombre)}</strong>
      <span>${eur(sel.totalAportado)} aportados serían hoy <b>${eur(sel.final)}</b> <span class="${gan >= 0 ? "pos" : "neg"}">(${conSigno(gan, eur(Math.abs(gan)))})</span></span></div>
    ${grafico(series, etiquetas, { desc: `Evolución de ${sel.nombre} frente al dinero aportado y al resto de opciones, de ${desde} a ${hasta}`, fmt: (v) => eur(v) })}
    <div class="lectura" id="lectura"></div>
    <div class="chips" role="group" aria-label="Opción resaltada en el gráfico">${res.filas.map((f) => `<button type="button" data-resaltar="${f.id}" aria-pressed="${f.id === sel.id}">${esc(nombreCorto(f.nombre))}</button>`).join("")}</div>
    <span class="nota">En gris, el resto de opciones. Es una comparación del pasado, no una predicción.</span>
  </section>`;
  html += `<section class="seccion"><h2>Ranking</h2>${res.filas.map((f, i) => {
    const cuerpo = `<span class="puesto">${i + 1}</span>${insignia(f.tir, pct(f.tir), "al año", f.id === "dep")}
      <div class="cuerpo"><strong class="nom">${esc(nombreCorto(f.nombre))}</strong>
      <span class="sub">${eur(f.final)} · caída máx. ${pct(f.caida, 0)}</span>
      <div class="puntos"><div class="barra"><i style="width:${Math.round(f.puntos)}%"></i></div><span>${Math.round(f.puntos)} pts</span></div></div>`;
    return f.id === "dep" ? `<div class="lugar">${cuerpo}</div>` : `<a class="lugar" href="#/producto/${esc(f.id)}">${cuerpo}${ICO.flecha}</a>`;
  }).join("")}
  <span class="nota">Rentabilidad al año: la de tu dinero, contando cuándo entró cada aportación y la comisión de cada compra. Los gastos del producto ya van dentro de su precio.</span>
  ${res.fuera.length ? `<span class="nota">Fuera de la comparación por no tener histórico suficiente: ${res.fuera.map((a) => `${esc(a.nombre)} (desde ${mesTxt(modelo.meses[a.primero])})`).join("; ")}.</span>` : ""}
  </section>`;
  return html;
}
const nombreCorto = (n) => n.replace(/^(iShares Core|Vanguard|Xtrackers II|Invesco)\s+/, "").replace(/\s*\(Acc\)| 1C| ETC/g, "");

function enlazarResultado(res) {
  const svg = vista.querySelector("#resultado .grafico");
  if (!svg) return;
  const sel = res.filas.find((f) => f.id === resaltado) || res.filas[0];
  const lectura = document.getElementById("lectura");
  const pintarLectura = (i) => {
    const k = i == null ? sel.valores.length - 1 : i;
    lectura.innerHTML = `<span>${mesTxt(res.meses[k])}</span><span><i></i><b>${eur(sel.valores[k])}</b> &nbsp; <i class="ap"></i>${eur(sel.aportado[k])} aportados</span>`;
  };
  pintarLectura(null);
  activarCursor(svg, sel.valores, pintarLectura);
  vista.querySelectorAll("[data-resaltar]").forEach((b) => b.addEventListener("click", () => {
    resaltado = b.dataset.resaltar;
    const y = scrollY, chips = b.parentElement.scrollLeft;
    document.getElementById("resultado").innerHTML = resultadoHTML(res);
    enlazarResultado(res);
    const c = vista.querySelector("#resultado .chips"); if (c) c.scrollLeft = chips;
    scrollTo(0, y);
  }));
}

// ---------- Producto ----------
function vistaProducto(id) {
  const a = modelo.activos.find((x) => x.id === id);
  if (!a) { location.hash = "#/productos"; return; }
  const n = modelo.meses.length;
  const inicio = Math.max(plan.anios > 0 ? n - 1 - plan.anios * 12 : a.primero, a.primero);
  const meses = modelo.meses.slice(inicio), px = a.px.slice(inicio);
  const sim = simular(a.r, inicio, plan.inicial, plan.mensual, plan.comision), rg = riesgo(a.r, inicio);
  const cambio = px[px.length - 1] / px[0] - 1, gan = sim.final - sim.totalAportado;
  const recortado = plan.anios > 0 && a.primero > n - 1 - plan.anios * 12;
  let html = cabecera(a.nombre, `<a class="atras" href="#/">${ICO.atras}Comparar</a>`, a.categoria);
  html += `<section class="cuadros">
    <div class="destacado ${sim.tir >= 0 ? "pos" : "neg"}"><span>Rentab. al año</span><strong>${pct(sim.tir)}</strong><span>con tu plan</span></div>
    <div><span>Volatilidad</span><strong>${pct(rg.vol)}</strong><span>anual</span></div>
    <div><span>Peor caída</span><strong>${pct(rg.caida, 0)}</strong><span>desde máximos</span></div>
  </section>`;
  html += `<section class="tarjeta"><div class="cab"><h2>Precio</h2><small>${mesTxt(meses[0])} – ${mesTxt(meses[meses.length - 1])}</small></div>
    <div class="grande"><strong>${eur(a.ultimo.precio, 2)}</strong><span>Cierre del ${diaTxt(a.ultimo.fecha)} · <span class="${cambio >= 0 ? "pos" : "neg"}">${conSigno(cambio, pct(Math.abs(cambio)))}</span> en el periodo</span></div>
    ${grafico([{ valores: px, color: "#9DB2FF", ancho: 2.4, area: true, principal: true }], meses.map(mesTxt), { desdeCero: false, alto: 220, desc: `Precio de ${a.nombre} entre ${mesTxt(meses[0])} y ${mesTxt(meses[meses.length - 1])}`, fmt: (v) => eur(v, v < 100 ? 1 : 0) })}
    <div class="lectura" id="lectura"></div>
    ${recortado ? `<span class="nota">Este producto solo tiene histórico desde ${mesTxt(modelo.meses[a.primero])}; se muestra desde entonces.</span>` : ""}
  </section>`;
  html += `<section class="tarjeta lisa"><div class="cab"><h2>Con tu plan</h2><small>${eur(plan.inicial)} + ${eur(plan.mensual)}/mes</small></div>
    <div class="tabla">
      <div class="fila"><span>Aportado</span><strong>${eur(sim.totalAportado)}</strong></div>
      <div class="fila"><span>Valor final</span><strong>${eur(sim.final)}</strong></div>
      <div class="fila"><span>Ganancia</span><strong class="${gan >= 0 ? "pos" : "neg"}">${conSigno(gan, eur(Math.abs(gan)))}</strong></div>
    </div></section>`;
  html += `<section class="tarjeta lisa"><div class="cab"><h2>Ficha</h2></div>
    <div class="tabla">
      <div class="fila"><span>ISIN</span><strong>${esc(a.isin)}</strong></div>
      <div class="fila"><span>Gastos anuales (TER)<small>Orientativo: compruébalo en la ficha oficial</small></span><strong>${num(a.ter, 2)} %</strong></div>
      <div class="fila"><span>Histórico desde</span><strong>${mesTxt(modelo.meses[a.primero])}</strong></div>
      <div class="fila"><span>Fuente del precio<small>${esc(a.nombreFuente || "")}</small></span><strong>${a.origen === "justetf" ? "justETF" : "Yahoo Finance"}</strong></div>
      ${a.correcciones.length ? `<div class="fila"><span>Meses corregidos con justETF</span><strong>${a.correcciones.map(mesTxt).join(", ")}</strong></div>` : ""}
    </div></section>
    <section class="seccion"><a class="boton" href="#/cartera" data-comprar="${esc(a.id)}">Comprar en la cartera ficticia</a></section>` + pie();
  vista.innerHTML = html;
  const lectura = document.getElementById("lectura");
  const pintar = (i) => { const k = i == null ? px.length - 1 : i; lectura.innerHTML = `<span>${mesTxt(meses[k])}</span><span><i></i><b>${eur(px[k], 2)}</b></span>`; };
  pintar(null);
  activarCursor(vista.querySelector(".grafico"), px, pintar);
  vista.querySelector("[data-comprar]").addEventListener("click", () => { compraPre = a.id; });
}

// ---------- Productos ----------
function vistaProductos() {
  let html = cabecera("Productos", "", "ETF que se pueden comprar desde España");
  html += `<section class="seccion" style="padding-top:4px">${modelo.activos.map((a) => {
    const n = a.px.length, ini = Math.max(n - 13, a.primero), c = a.px[n - 1] / a.px[ini] - 1;
    return `<a class="lugar" href="#/producto/${esc(a.id)}">${insignia(c, conSigno(c, pct(Math.abs(c), 0)), "12 meses")}
      <div class="cuerpo"><strong class="nom">${esc(a.nombre)}</strong><span class="sub">${esc(a.categoria)}</span></div>
      <div class="der"><strong>${eur(a.ultimo.precio, 2)}</strong><span class="hora">TER ${num(a.ter, 2)} %</span></div></a>`;
  }).join("")}</section>`;
  const faltan = catalogo.filter((p) => !modelo.activos.some((a) => a.id === p.id));
  if (faltan.length) html += `<p class="pista">Sin precios todavía: ${faltan.map((p) => esc(p.nombre)).join(", ")}.</p>`;
  vista.innerHTML = html + pie();
}

// ---------- Cartera ficticia (solo en este navegador) ----------
function leerCartera() {
  try { const c = JSON.parse(leer(CLAVE_CARTERA)); if (c && Array.isArray(c.ops)) return c; } catch (e) { /* vacía */ }
  return memoriaCartera || { cash: EFECTIVO_INICIAL, ops: [] };
}
function guardarCartera(c) { memoriaCartera = c; guardar(CLAVE_CARTERA, JSON.stringify(c)); }
function posiciones(c) {
  const pos = {};
  c.ops.forEach((op) => {
    const x = pos[op.id] || (pos[op.id] = { units: 0, coste: 0 });
    if (op.tipo === "compra") { x.units += op.units; x.coste += op.importe; }
    else { x.coste -= x.coste * (op.units / x.units); x.units -= op.units; }
  });
  return Object.entries(pos).filter(([, x]) => x.units > 1e-9);
}
function vistaCartera() {
  const c = leerCartera(), porId = Object.fromEntries(modelo.activos.map((a) => [a.id, a]));
  const pos = posiciones(c).filter(([id]) => porId[id]);
  const invertido = pos.reduce((s, [id, x]) => s + x.units * porId[id].ultimo.precio, 0);
  const total = c.cash + invertido, res = total - EFECTIVO_INICIAL;
  const pre = compraPre || leer("inversion:ultimo-producto") || modelo.activos[0].id;
  compraPre = null;
  let html = cabecera("Cartera", "", "Dinero virtual, guardado solo en este dispositivo");
  html += `<section class="cuadros">
    <div class="destacado"><span>Total</span><strong>${eur(total)}</strong><span>de ${eur(EFECTIVO_INICIAL)}</span></div>
    <div><span>Efectivo</span><strong>${eur(c.cash)}</strong><span>disponible</span></div>
    <div><span>Resultado</span><strong class="${res >= 0 ? "pos" : "neg"}">${conSigno(res, eur(Math.abs(res)))}</strong><span>${pct(res / EFECTIVO_INICIAL, 2)}</span></div>
  </section>`;
  html += `<section class="tarjeta"><div class="cab"><h2>Comprar</h2><small>al último cierre</small></div>
    <form class="form" id="comprar" novalidate>
      <label class="nota" for="c-prod">Producto</label>
      <select id="c-prod">${modelo.activos.map((a) => `<option value="${esc(a.id)}" ${a.id === pre ? "selected" : ""}>${esc(a.nombre)} · ${eur(a.ultimo.precio, 2)}</option>`).join("")}</select>
      <div class="dos"><label class="campo"><span>Importe</span><div><input id="c-imp" type="number" inputmode="decimal" min="1" step="any" value="100"><em>€</em></div></label>
      <button class="boton" type="submit">Comprar</button></div>
      <span class="mensaje ${mensajeCartera && mensajeCartera.mal ? "mal" : ""}" role="status">${mensajeCartera ? esc(mensajeCartera.texto) : `Comisión por compra: ${eur(plan.comision, 2)} (la de tu plan).`}</span>
    </form></section>`;
  mensajeCartera = null;
  html += `<section class="seccion"><h2>Posiciones</h2>${pos.length ? pos.map(([id, x]) => {
    const a = porId[id], valor = x.units * a.ultimo.precio, g = valor - x.coste;
    return `<div class="lugar posicion">
      <div class="cuerpo"><strong class="nom">${esc(nombreCorto(a.nombre))}</strong><span class="sub">${num(x.units, 4)} part. · medio ${eur(x.coste / x.units, 2)}</span></div>
      <div class="der"><strong>${eur(valor, 2)}</strong><span class="${g >= 0 ? "pos" : "neg"}">${conSigno(g, eur(Math.abs(g), 2))} (${pct(g / x.coste)})</span></div>
      <div class="acciones"><a href="#/producto/${esc(id)}">Ver producto</a><button type="button" class="mini" data-vender="${esc(id)}">Vender</button></div></div>`;
  }).join("") : `<p class="vacio" style="padding:20px 0">Aún no tienes posiciones. Haz una compra de prueba.</p>`}</section>`;
  if (c.ops.length) {
    html += `<section class="tarjeta lisa"><div class="cab"><h2>Operaciones</h2><small>${c.ops.length}</small></div><div class="tabla">${c.ops.slice().reverse().slice(0, 30).map((op) => {
      const a = porId[op.id];
      return `<div class="fila"><span>${op.tipo === "compra" ? "Compra" : "Venta"} · ${esc(a ? nombreCorto(a.nombre) : op.id)}<small>${diaTxt(op.fecha)} · ${num(op.units, 4)} part. a ${eur(op.precio, 2)}</small></span><strong>${eur(op.importe, 2)}</strong></div>`;
    }).join("")}</div></section>`;
  }
  html += `<section class="seccion"><button type="button" class="boton sec" id="reiniciar">Empezar de cero</button></section>` + pie();
  vista.innerHTML = html;

  document.getElementById("comprar").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const a = porId[document.getElementById("c-prod").value], imp = parseFloat(document.getElementById("c-imp").value) || 0, com = plan.comision;
    guardar("inversion:ultimo-producto", a.id);
    if (imp <= com) mensajeCartera = { texto: `El importe tiene que ser mayor que la comisión (${eur(com, 2)}).`, mal: true };
    else if (imp > c.cash) mensajeCartera = { texto: `No tienes efectivo suficiente: te quedan ${eur(c.cash, 2)}.`, mal: true };
    else {
      const units = (imp - com) / a.ultimo.precio;
      c.cash -= imp; c.ops.push({ tipo: "compra", id: a.id, fecha: a.ultimo.fecha, units, precio: a.ultimo.precio, importe: imp, comision: com });
      guardarCartera(c);
      mensajeCartera = { texto: `Compra anotada: ${num(units, 4)} participaciones a ${eur(a.ultimo.precio, 2)}.` };
    }
    mantenerScroll(vistaCartera);
  });
  vista.querySelectorAll("[data-vender]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.armado !== "1") { b.dataset.armado = "1"; b.textContent = "¿Vender todo?"; setTimeout(() => { b.dataset.armado = ""; b.textContent = "Vender"; }, 3500); return; }
    const id = b.dataset.vender, a = porId[id], x = posiciones(c).find(([k]) => k === id)[1];
    const neto = Math.max(x.units * a.ultimo.precio - plan.comision, 0);
    c.cash += neto; c.ops.push({ tipo: "venta", id, fecha: a.ultimo.fecha, units: x.units, precio: a.ultimo.precio, importe: neto, comision: plan.comision });
    guardarCartera(c);
    mensajeCartera = { texto: `Venta anotada: recibes ${eur(neto, 2)}.` };
    mantenerScroll(vistaCartera);
  }));
  const rein = document.getElementById("reiniciar");
  rein.addEventListener("click", () => {
    if (rein.dataset.armado !== "1") { rein.dataset.armado = "1"; rein.textContent = "Pulsa otra vez para borrar la cartera"; setTimeout(() => { rein.dataset.armado = ""; rein.textContent = "Empezar de cero"; }, 4000); return; }
    guardarCartera({ cash: EFECTIVO_INICIAL, ops: [] });
    mensajeCartera = { texto: `Cartera reiniciada con ${eur(EFECTIVO_INICIAL)} virtuales.` };
    vistaCartera(); scrollTo(0, 0);
  });
}

// ---------- Datos ----------
function vistaDatos() {
  const errores = Object.values(precios.errores || {});
  let html = cabecera("Datos", "", "De dónde salen las cifras y qué límites tienen");
  if (errores.length) html += `<section class="aviso">${ICO.aviso}<div><strong>Hay productos sin actualizar</strong><span>${errores.map(esc).join(", ")}. Se conserva el último precio conocido.</span></div></section>`;
  html += `<section class="tarjeta lisa" style="margin-top:0"><div class="cab"><h2>Cómo se calcula</h2></div><div class="texto">
      <p>Cada simulación invierte la aportación inicial el primer mes y la mensual al final de cada mes, a precios reales de cierre, restando la comisión de cada compra.</p>
      <p>La puntuación compara las opciones entre sí en el periodo elegido según rentabilidad, volatilidad y peor caída, con el peso del perfil que elijas.</p>
    </div></section>
    <section class="tarjeta lisa"><div class="cab"><h2>Precios</h2></div><div class="tabla">
      ${modelo.activos.map((a) => `<div class="fila"><span>${esc(nombreCorto(a.nombre))}<small>${a.origen === "justetf" ? "justETF" : "Yahoo Finance"} · desde ${mesTxt(modelo.meses[a.primero])}${a.correcciones.length ? ` · ${a.correcciones.length} meses corregidos` : ""}</small></span><strong>${diaTxt(a.ultimo.fecha)}</strong></div>`).join("")}
    </div><span class="nota">Se actualizan solos de lunes a viernes tras el cierre de la bolsa alemana. El histórico mensual se contrasta con justETF: si un mes difiere en más de 5 puntos, se usa el dato de justETF.</span></section>
    <section class="tarjeta lisa"><div class="cab"><h2>Límites</h2></div><div class="texto">
      <p>Los precios vienen de fuentes no oficiales y pueden contener errores. El TER y el ISIN son orientativos: compruébalos en la ficha oficial de cada producto.</p>
      <p>No se incluyen impuestos, inflación ni la horquilla de compra y venta. La volatilidad y las caídas se calculan con cierres de fin de mes.</p>
      <p>Lo ocurrido en el pasado no indica lo que ocurrirá. Esto es una herramienta de aprendizaje, no una recomendación de inversión.</p>
    </div></section>`;
  vista.innerHTML = html;
}

// ---------- navegación ----------
function pintar() {
  const [seccion, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const tab = { "": "comparar", producto: "comparar", productos: "productos", cartera: "cartera", datos: "datos" }[seccion] || "comparar";
  document.querySelectorAll(".pestanas a").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (!modelo || !modelo.activos.length) return sinDatos();
  if (seccion === "producto") vistaProducto(arg);
  else if (seccion === "productos") vistaProductos();
  else if (seccion === "cartera") vistaCartera();
  else if (seccion === "datos") vistaDatos();
  else vistaComparar();
}
async function cargar() {
  try {
    const [c, p] = await Promise.all([fetch(URL_CATALOGO, { cache: "no-cache" }), fetch(URL_PRECIOS, { cache: "no-cache" })]);
    catalogo = (await c.json()).productos; precios = await p.json();
    modelo = construirModelo();
  } catch (e) { errorCarga = true; }
  pintar();
}
addEventListener("hashchange", () => { pintar(); scrollTo(0, 0); });
cargar();

// ---------- instalación ----------
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
(function avisoInstalar() {
  const caja = document.getElementById("instalar"), CLAVE = "inversion:instalar-cerrado";
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (instalada || leer(CLAVE)) return;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const interno = /FBAN|FBAV|Instagram|Line\/|; wv\)|WhatsApp/i.test(ua);
  let peticion = null;
  const mostrar = (m) => { caja.classList.remove("modo-android", "modo-ios", "modo-interno"); caja.classList.add(`modo-${m}`); caja.hidden = false; };
  const ocultar = (rec) => { caja.hidden = true; if (rec) guardar(CLAVE, "1"); };
  caja.querySelector(".cerrar-instalar").addEventListener("click", () => ocultar(true));
  caja.querySelector(".si").addEventListener("click", async () => {
    if (!peticion) return;
    peticion.prompt();
    const { outcome } = await peticion.userChoice;
    peticion = null; ocultar(outcome === "accepted");
  });
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); peticion = e; if (!leer(CLAVE)) mostrar("android"); });
  addEventListener("appinstalled", () => ocultar(true));
  setTimeout(() => { if (!caja.hidden || leer(CLAVE)) return; if (interno) mostrar("interno"); else if (ios) mostrar("ios"); }, 1500);
})();
