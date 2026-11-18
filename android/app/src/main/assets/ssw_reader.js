// Leitor da tela do SSW (fase 2.4). Injetado pelo app do kiosk nas páginas do SSW quando o piloto está ligado.
// Só LÊ a página: não clica, não digita, não muda nada. Manda um retrato da tela ao app (StarXOps.report) quando
// algo muda, e avisa os toques em Concluir/Interromper (StarXOps.action) sem interferir neles.
(function () {
  "use strict";
  if (window.__starxOps) {
    window.__starxOps.scan(true);
    return;
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

  function fnOf() {
    var m = location.pathname.toLowerCase().match(/\/sswbar\/descarga\/(manifesto|coleta|romaneio)(\/|$)/);
    if (m) return m[1];
    m = input("funcao").toLowerCase().match(/manifesto|coleta|romaneio/);
    if (m) return m[0];
    m = text(byId("navbar_title")).toLowerCase().match(/descarga de (manifesto|coleta|romaneio)/);
    return m ? m[1] : null;
  }
  function plateFromPath() {
    var m = location.pathname.match(/\/sswbar\/descarga\/[a-z]+\/([^\/@]+)/i);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]).trim();
    } catch (e) {
      return m[1];
    }
  }
  /** "Unidades:" → SPAN com as siglas das filiais (ex.: "ALT OTI BOT CGB"). */
  function units() {
    var ps = document.getElementsByTagName("p");
    for (var i = 0; i < ps.length; i++) {
      var t = text(ps[i]);
      if (!/^unidades\s*:/i.test(t)) continue;
      var span = ps[i].querySelector("span");
      var s = span ? text(span) : t.replace(/^unidades\s*:/i, "");
      return s.split(/[\s,;]+/).filter(Boolean).slice(0, 20);
    }
    return [];
  }
  function screenOf(path) {
    if (byId("total_qtde") && byId("cap_qtde")) return "bipagem";
    if (/\/sswbar\/login/.test(path) || document.querySelector('input[type="password"]')) return "login";
    if (/\/sswbar\/menu/.test(path)) return "menu";
    if (/\/sswbar\/descarga\/[a-z]+\/?$/.test(path) || byId("placa")) return "placa";
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
      s.plate = input("placa") || plateFromPath() || null;
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
    return s;
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
