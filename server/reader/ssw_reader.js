// Leitor da tela do SSW (fase 2.4). Injetado pelo app do kiosk nas páginas do SSW quando a leitura está ligada.
// Só LÊ a página: não clica, não digita, não muda nada. Manda um retrato da tela ao app (StarXOps.report) quando
// algo muda, e avisa os toques em Concluir/Interromper (StarXOps.action) sem interferir neles.
// Entregue pela API (GET /v1/device/reader) e embutido no APK como reserva: ajustes de mapeamento não precisam de app novo.
(function () {
  "use strict";
  // muda a cada versão do leitor: uma versão nova substitui a antiga já injetada na página
  var VERSION = "2026-11-19.1";
  if (window.__starxOps) {
    if (window.__starxOps.version === VERSION) {
      window.__starxOps.scan(true);
      return;
    }
    try {
      window.__starxOps.stop();
    } catch (e) {}
  }
  var bridge = window.StarXOps;
  if (!bridge) return;

  var last = "";
  var timer = null;
  var observer = null;
  var pending = false;

  function byId(id) {
    return document.getElementById(id);
  }
  function text(el) {
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function input(name) {
    var e = document.querySelector('input[name="' + name + '"]');
    return e ? String(e.value || "").trim() : "";
  }
  /** "1.234,56" / "1234,56" / "1.234" / "12.5" → número; vazio → null. */
  function ptNum(s) {
    s = String(s == null ? "" : s).replace(/[^\d.,-]/g, "");
    if (!s) return null;
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  /** Quantidade de volumes: só os dígitos ("1.234" → 1234). */
  function intNum(s) {
    var d = String(s == null ? "" : s).replace(/[^\d]/g, "");
    return d ? Number(d) : null;
  }
  function first(a, b) {
    return a !== null ? a : b;
  }

  /** Descarga: "manifesto"/"coleta"/"romaneio"; carga: "carga_manifesto"... (o campo "funcao" é um número na carga). */
  function fnOf() {
    var m = location.pathname.toLowerCase().match(/\/sswbar\/(descarga|carga)\/(manifesto|coleta|romaneio)(\/|$)/);
    if (!m) m = (text(byId("navbar_title")) || document.title).toLowerCase().match(/(descarga|carga) de (manifesto|coleta|romaneio)/);
    if (m) return (m[1] === "carga" ? "carga_" : "") + m[2];
    m = input("funcao").toLowerCase().match(/manifesto|coleta|romaneio/);
    return m ? m[0] : null;
  }
  function plateFromPath() {
    var m = location.pathname.match(/\/sswbar\/(?:descarga|carga)\/[a-z]+\/([^\/@]+)/i);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]).trim();
    } catch (e) {
      return m[1];
    }
  }
  /** "Placa provisória: X" (carga) ou "Placa: X". */
  function plateFromText() {
    var ps = document.getElementsByTagName("p");
    for (var i = 0; i < ps.length; i++) {
      var m = text(ps[i]).match(/^placa( provis[oó]ria)?\s*:\s*(\S+)/i);
      if (m) return m[2];
    }
    return "";
  }
  /** "Unidades:" (descarga) ou "Unidades destino:" (carga) → SPAN com as siglas das filiais (ex.: "ALT OTI BOT CGB"). */
  function units() {
    var ps = document.getElementsByTagName("p");
    for (var i = 0; i < ps.length; i++) {
      var t = text(ps[i]);
      if (!/^unidades( destino)?\s*:/i.test(t)) continue;
      var span = ps[i].querySelector("span");
      var s = span ? text(span) : t.replace(/^unidades( destino)?\s*:/i, "").replace(/centralizadoras\s*:.*$/i, "");
      return s.split(/[\s,;]+/).filter(Boolean).slice(0, 20);
    }
    return [];
  }
  function screenOf(path) {
    if (byId("total_qtde") && byId("cap_qtde")) return "bipagem";
    if (/\/sswbar\/login/.test(path) || document.querySelector('input[type="password"]')) return "login";
    if (/\/sswbar\/menu/.test(path)) return "menu";
    if (/\/sswbar\/(descarga|carga)\/[a-z]+\/?$/.test(path) || byId("placa")) return "placa";
    return "outra";
  }

  function snapshot() {
    var path = location.pathname.toLowerCase();
    var s = {
      screen: screenOf(path),
      user: input("usuario") || text(byId("dropdownMenuButton")) || null,
      domain: input("dominio") || null,
      branch: input("filial") || null,
      fn: fnOf(),
    };
    if (s.screen === "bipagem") {
      s.plate = input("placa") || plateFromPath() || plateFromText() || null;
      s.realPlate = input("placa_real") || null;
      s.units = units();
      s.total = {
        qty: intNum(text(byId("total_qtde"))),
        kg: first(ptNum(input("full_total_peso")), ptNum(text(byId("total_peso")))),
        value: first(ptNum(input("full_total_vlr")), ptNum(text(byId("total_vlr")))),
      };
      s.read = {
        qty: intNum(text(byId("cap_qtde"))),
        kg: first(ptNum(input("full_cap_peso")), ptNum(text(byId("cap_peso")))),
        value: first(ptNum(input("full_cap_vlr")), ptNum(text(byId("cap_vlr")))),
      };
    }
    var why = problem(s, path);
    if (why) s.diag = diag(s, why);
    return s;
  }

  /** O que impede de ler a tela (null = nada): bipagem sem função/placa/total ou tela do SSW desconhecida. */
  function problem(s, path) {
    if (s.screen === "bipagem") {
      var miss = [];
      if (!s.fn) miss.push("funcao");
      if (!s.plate) miss.push("placa");
      if (!s.total || s.total.qty === null) miss.push("total");
      return miss.length ? "bipagem sem " + miss.join(",") : null;
    }
    if (s.screen === "outra" && /\/sswbar\//.test(path)) return "tela desconhecida";
    return null;
  }
  function cut(v, n) {
    v = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    return v.length > n ? v.slice(0, n) : v;
  }
  /** Só a estrutura da página (endereço, ids, nomes de campos, rótulos), para ajustar o mapeamento sem ir ao coletor. */
  function diag(s, why) {
    var VALUES = { funcao: 1, placa: 1, placa_real: 1, dominio: 1, filial: 1 };
    var ids = [];
    var all = document.querySelectorAll("[id]");
    for (var i = 0; i < all.length && ids.length < 120; i++) ids.push(cut(all[i].tagName.toLowerCase() + "#" + all[i].id, 60));
    var inputs = [];
    var ins = document.querySelectorAll("input, select, textarea");
    for (var j = 0; j < ins.length && inputs.length < 100; j++) {
      var e = ins[j];
      var n = e.name || e.id || "";
      inputs.push(cut((e.type || e.tagName.toLowerCase()) + ":" + n + (VALUES[n] ? "=" + e.value : ""), 60));
    }
    var texts = [];
    var ps = document.querySelectorAll("p, label, h1, h2, h3, h4, h5, th");
    for (var k = 0; k < ps.length && texts.length < 30; k++) {
      var t = cut(text(ps[k]), 120);
      if (t) texts.push(t);
    }
    return { reason: why, path: cut(location.pathname, 300), title: cut(text(byId("navbar_title")) || document.title, 120), ids: ids, inputs: inputs, texts: texts, reader: VERSION };
  }

  function scan(force) {
    pending = false;
    var json;
    try {
      json = JSON.stringify(snapshot());
    } catch (e) {
      return;
    }
    if (!force && json === last) return;
    last = json;
    try {
      bridge.report(json);
    } catch (e) {}
  }
  function soon() {
    if (pending) return;
    pending = true;
    setTimeout(scan, 80);
  }

  // toques nos botões: só observa (fase de captura, sem impedir nada)
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('button, a, input[type="button"], input[type="submit"]') : null;
    if (!el) return;
    var t = String(el.innerText || el.value || "").trim().toLowerCase();
    var name = /^concluir/.test(t) ? "concluir" : /^interromper/.test(t) ? "interromper" : null;
    if (!name) return;
    try {
      bridge.action(name);
    } catch (err) {}
    soon();
  }

  document.addEventListener("click", onClick, true);
  try {
    observer = new MutationObserver(soon);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  } catch (e) {}
  // campos escondidos mudam por script sem gerar mutação: confere também a cada 500 ms
  timer = setInterval(scan, 500);

  window.__starxOps = {
    version: VERSION,
    scan: scan,
    stop: function () {
      clearInterval(timer);
      if (observer) observer.disconnect();
      document.removeEventListener("click", onClick, true);
      delete window.__starxOps;
    },
  };
  scan(true);
})();
