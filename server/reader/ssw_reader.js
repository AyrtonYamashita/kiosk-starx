// Leitor da tela do SSW (fase 2.4). Injetado pelo app do kiosk nas páginas do SSW quando a leitura está ligada.
// LÊ a página: não digita e não muda o que o SSW mostra. Manda um retrato da tela ao app (StarXOps.report) quando
// algo muda, e avisa os toques em Concluir/Interromper (StarXOps.action) sem interferir neles.
// Exceção (app 0.5.6+): o alerta de tela cheia em erros graves de bipagem,
// por cima da página (ver "telas do kiosk por cima do SSW"). Elas repassam ao SSW o mesmo toque que o colaborador daria.
// Entregue pela API (GET /v1/device/reader) e embutido no APK como reserva: ajustes de mapeamento não precisam de app novo.
(function () {
  "use strict";
  // muda a cada versão do leitor: uma versão nova substitui a antiga já injetada na página
  var VERSION = "2026-11-27.4";
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
      trackScan(s);
      if (sc.done) s.extra = { scan: sc.done };
    } else {
      sc.key = null;
    }
    var why = problem(s, path);
    if (why) s.diag = diag(s, why);
    return s;
  }

  // ------------------------------------------------------------ códigos de barras (app 0.5.2; erros: leitor 2026-11-24)
  // Cada bipagem vira um registro com o tipo:
  //  "lido" (Lidos aumentou), "outra" (Outras aumentou), "erro" (o SSW recusou e mostrou uma mensagem na janela
  //  #errormsg: o texto de #error_body vai junto, como apareceu) ou "nao_contou" (nada aumentou e nenhuma mensagem).
  // A bipagem é percebida pelo Enter no campo #barcode (pega também o código repetido, que não muda #last) ou, se o
  // Enter escapar, pelo código novo em #last (a página guarda ali o último código enviado).
  // Número, código e mensagem podem chegar em momentos um pouco diferentes: espera até 1,5 s para casar; a mensagem que
  // chegar até 8 s depois (rede lenta) ainda completa o registro, que vira "erro" (mesmo id: o servidor atualiza).
  var SCAN_WAIT_MS = 1500;
  var ERROR_LATE_MS = 8000;
  // mensagens logo depois de Concluir/Interromper são da carga (confirmação, pendências), não de uma bipagem
  var ACTION_QUIET_MS = 15000;
  var sc = {
    key: null,
    code: "",
    read: null,
    out: null,
    incAt: 0,
    incKind: null,
    pending: null,
    done: null,
    doneAt: 0,
    err: "",
    typed: null,
    typedAt: 0,
    lastTyped: "",
    lastTypedAt: 0,
    actionAt: 0,
  };
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function finish(p, kind, now, since, error) {
    sc.done = { id: p.id, code: p.code, kind: kind, ageMs: Math.max(0, now - Math.min(p.at, since || p.at)) };
    if (error) sc.done.error = error;
    sc.doneAt = now;
    if (sc.pending === p) sc.pending = null;
  }
  function startScan(code, at, now) {
    if (sc.pending) finish(sc.pending, "nao_contou", now);
    var p = { id: newId(), code: code, at: at };
    if (sc.incKind && now - sc.incAt <= SCAN_WAIT_MS) finish(p, sc.incKind, now, sc.incAt);
    else sc.pending = p;
    sc.incKind = null;
  }
  /** Mensagem aberta na janela de erro do SSW ("" = nenhuma). */
  function errorText() {
    return cut(text(byId("error_body")), 300);
  }
  /** O SSW mostrou uma mensagem: completa a bipagem a que ela pertence. */
  /** Devolve o id do registro que ficou com a mensagem (null: mensagem ignorada ou da mesma bipagem). */
  function onError(err, code, now) {
    if (now - sc.actionAt < ACTION_QUIET_MS) return null;
    if (sc.pending) {
      var id = sc.pending.id;
      finish(sc.pending, "erro", now, null, err);
      return id;
    }
    var d = sc.done;
    if (d && now - sc.doneAt <= ERROR_LATE_MS) {
      // chegou depois do prazo de 1,5 s: o "não contou" vira erro (mesmo registro)
      if (!d.error && d.kind === "nao_contou") {
        sc.done = { id: d.id, code: d.code, kind: "erro", ageMs: Math.min(600000, d.ageMs + (now - sc.doneAt)), error: err };
        sc.doneAt = now;
        return d.id;
      }
      // senão é continuação da mesma bipagem (ex.: resposta a um botão da janela): não vira outro registro
      return null;
    }
    // bipagem que escapou dos dois sinais (ex.: código repetido sem o Enter visto): fica com o código de #last
    if (!code) return null;
    var p = { id: newId(), code: code, at: now };
    finish(p, "erro", now, null, err);
    return p.id;
  }
  function trackScan(s) {
    var now = Date.now();
    var code = cut(text(byId("last")), 80);
    var read = s.read ? s.read.qty : null;
    var out = intNum(text(byId("out_qtde")));
    var err = errorText();
    var key = (s.fn || "") + "|" + (s.plate || "");
    if (sc.key !== key) {
      // outra carga (ou voltou à tela): o código e a mensagem que já estavam na tela não são bipagem nova
      sc.key = key;
      sc.code = code;
      sc.read = read;
      sc.out = out;
      sc.err = err;
      sc.incKind = null;
      sc.pending = null;
      sc.done = null;
      sc.typed = null;
      return;
    }
    var kind = null;
    if (read !== null && sc.read !== null && read > sc.read) kind = "lido";
    else if (out !== null && sc.out !== null && out > sc.out) kind = "outra";
    sc.read = read;
    sc.out = out;
    if (kind) {
      if (sc.pending) finish(sc.pending, kind, now);
      else {
        sc.incAt = now;
        sc.incKind = kind;
      }
    }
    if (sc.typed) {
      startScan(sc.typed, sc.typedAt, now);
      sc.lastTyped = sc.typed;
      sc.lastTypedAt = sc.typedAt;
      sc.typed = null;
    }
    if (code && code !== sc.code) {
      sc.code = code;
      // o mesmo código que acabou de ser enviado pelo Enter já tem registro
      if (!(code === sc.lastTyped && now - sc.lastTypedAt <= ERROR_LATE_MS)) startScan(code, now, now);
    }
    if (err && err !== sc.err) {
      // janela de erro do SSW abriu: página no topo, para o cabeçalho com o usuário logado aparecer acima dela
      try {
        window.scrollTo(0, 0);
      } catch (e) {}
      var errId = onError(err, code, now);
      if (errId) raise(errId, err, s, sc.done && sc.done.id === errId ? sc.done.code : code);
    }
    sc.err = err;
    if (sc.pending && now - sc.pending.at > SCAN_WAIT_MS) finish(sc.pending, "nao_contou", now);
  }
  /** Enter no campo do código (leitor ou teclado): só anota o que foi enviado, sem interferir. */
  function onKey(e) {
    var t = e.target;
    if (!t || t.id !== "barcode" || !(e.key === "Enter" || e.keyCode === 13)) return;
    var v = cut(t.value, 80);
    if (!v) return;
    var now = Date.now();
    // Enter repetido do mesmo envio (tecla presa, leitor que manda dois) conta uma vez só
    if (v === sc.typed && now - sc.typedAt < 300) return;
    if (!sc.typed && v === sc.lastTyped && now - sc.lastTypedAt < 300) return;
    sc.typed = v;
    sc.typedAt = now;
    soon();
  }

  // ------------------------------------------------------------ telas do kiosk por cima do SSW (leitor 2026-11-25, app 0.5.6)
  // Só com o app que tem a ponte nova (StarXOps.alert, app 0.5.6+); nos apps anteriores nada muda:
  //  - alerta de tela cheia em erros que pedem atenção na hora (ALERTS): vermelho, ícone, a mensagem com os dados em
  //    negrito, quem/qual placa/hora. O app toca um alarme alto, vibra no máximo e tira uma captura da tela com o
  //    alerta, guardada no registro do erro. Leituras ficam bloqueadas até o toque em "Entendi", que fecha também a
  //    janela de erro do SSW.
  // (A confirmação de Concluir/Interromper do leitor 2026-11-25.1 saiu no 2026-11-27.1: travava o botão do SSW.)
  // CSS só com o que o WebView antigo dos coletores entende (Chrome ~70): nada de inset, min()/max(), gap em flex,
  // :has(). O leitor 2026-11-25.1 usava inset:0 e o alerta ficava fora da tela (a captura saía sem ele).
  // Visual: identidade do StarX Kiosk (tokens, raio 4 px, Space Grotesk/Inter/IBM Plex Mono servidas pelo app, sem
  // internet: /__starx/fonts/ no próprio endereço do SSW).
  var FONT_BASE = "/__starx/fonts/";
  var FONTS =
    '@font-face{font-family:"StarX Inter";src:url("' + FONT_BASE + 'inter.ttf") format("truetype");font-weight:100 900;font-display:block}' +
    '@font-face{font-family:"StarX Grotesk";src:url("' + FONT_BASE + 'spacegrotesk.ttf") format("truetype");font-weight:300 700;font-display:block}' +
    '@font-face{font-family:"StarX Mono";src:url("' + FONT_BASE + 'plexmono-regular.ttf") format("truetype");font-weight:400;font-display:block}' +
    '@font-face{font-family:"StarX Mono";src:url("' + FONT_BASE + 'plexmono-medium.ttf") format("truetype");font-weight:500 900;font-display:block}';
  /** As fontes ficam no documento (@font-face dentro de shadow DOM não vale no Chromium). */
  function loadFonts() {
    if (!bridge.alert || byId("starx-fonts")) return;
    var st = document.createElement("style");
    st.id = "starx-fonts";
    st.textContent = FONTS;
    (document.head || document.documentElement).appendChild(st);
  }
  var TOKENS =
    ":host{all:initial;--surface:#FFFFFF;--line:#E2E8F0;--soft:#516074;--mid:#334155;--ink:#0A1A2F;" +
    "--blue:#1560D4;--blue-deep:#0C4399;--blue-tint:#EEF4FD;--blue-edge:#DCE9FC;" +
    "--good:#15803D;--good-tint:#ECFDF3;--warn:#B45309;--warn-tint:#FFF7E6;--warn-edge:#FDE68A;--bad:#B91C1C;--bad-tint:#FEF1F1;--bad-edge:#FECACA;" +
    "--radius:4px;--shadow-float:0 6px 20px rgb(10 26 47 / .16);" +
    "--font-sans:'StarX Inter',Inter,Roboto,system-ui,sans-serif;--font-display:'StarX Grotesk','Space Grotesk','StarX Inter',Roboto,sans-serif;" +
    "--font-mono:'StarX Mono','IBM Plex Mono','Roboto Mono',ui-monospace,monospace}";

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function two(n) {
    return (n < 10 ? "0" : "") + n;
  }
  /** Hospedeiro com shadow DOM (o CSS do SSW não entra, o nosso não sai). */
  function shadowHost(id, css) {
    var host = el("div");
    host.id = id;
    var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
    var st = el("style");
    st.textContent = TOKENS + css;
    root.appendChild(st);
    return { host: host, root: root };
  }
  /** O código do leitor não pode cair no campo da página com uma das telas aberta. */
  function blurPage() {
    try {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } catch (e) {}
  }
  function focusBarcode() {
    setTimeout(function () {
      var bc = byId("barcode");
      try {
        if (bc) bc.focus();
      } catch (e) {}
    }, 150);
  }

  // ---- alerta de erro
  var ALERTS = [
    {
      key: "outra_placa",
      // "Este volume é do CTRC CGB379473-3, em carregamento na placa CNP por alissonm."
      re: /^(este volume [eé] do ctrc\s+)([^\s,]+)(,?\s+em carregamento na placa\s+)([^\s,]+?)(?:(\s+por\s+)([^\s,]+?))?(\.?)$/i,
      title: "Volume de outra carga",
    },
  ];
  var ALERT_ARM_MS = 900;
  var al = { host: null, fit: null };
  var FIT_MIN = 0.35;

  /**
   * Página inteira na tela enquanto o alerta está aberto (para a captura mostrar o cabeçalho do SSW com o usuário
   * logado, que a rolagem da bipagem esconde): volta ao topo e reduz a página (zoom no body) até caber na altura.
   * O alerta fica fora do body e não é reduzido. Desfeito ao fechar o alerta.
   */
  function fitPage() {
    var b = document.body;
    if (!b || al.fit) return;
    al.fit = { zoom: b.style.zoom, x: window.pageXOffset, y: window.pageYOffset };
    try {
      window.scrollTo(0, 0);
      var h = Math.max(b.scrollHeight, document.documentElement.scrollHeight);
      var w = Math.max(b.scrollWidth, document.documentElement.scrollWidth);
      var z = Math.min(1, window.innerHeight / (h || 1), window.innerWidth / (w || 1));
      if (z < 1) b.style.zoom = String(Math.max(FIT_MIN, Math.floor(zoomOf(b) * z * 100) / 100));
    } catch (e) {}
  }
  function unfitPage() {
    var f = al.fit;
    al.fit = null;
    if (!f || !document.body) return;
    try {
      document.body.style.zoom = f.zoom || "";
      window.scrollTo(f.x, f.y);
    } catch (e) {}
  }
  var ALERT_CSS =
    ".ov{position:fixed;top:0;right:0;bottom:0;left:0;width:100%;height:100%;z-index:2147483647;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;" +
    "padding:14px 14px 12px;overflow:auto;color:#fff;text-align:center;font-family:var(--font-sans);-webkit-font-smoothing:antialiased;" +
    "background:rgba(200,16,16,.72);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;" +
    "animation:flash .45s ease-in-out 6 alternate}" +
    "@keyframes flash{from{background:rgba(200,16,16,.72)}to{background:rgba(130,8,8,.84)}}" +
    ".mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;width:100%;max-width:440px}" +
    ".ico{flex:none;width:96px;height:96px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;" +
    "box-shadow:0 0 0 8px rgba(255,255,255,.22);animation:pop .5s cubic-bezier(.3,1.6,.5,1) both,shake .45s .5s ease-in-out 2}" +
    ".ico svg{width:72%;height:72%}" +
    "@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}" +
    "@keyframes shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-9deg)}75%{transform:rotate(9deg)}}" +
    ".title,.msg,.who{text-shadow:0 1px 3px rgba(0,0,0,.55),0 0 1px rgba(0,0,0,.6)}" +
    ".title{margin:0;font-family:var(--font-display);font-size:22px;line-height:1.1;font-weight:700;letter-spacing:-.01em;text-transform:uppercase}" +
    ".msg{margin:0;font-size:18px;line-height:1.4;font-weight:400}.msg b{font-weight:800;white-space:nowrap}" +
    ".facts{width:100%;box-sizing:border-box;margin:0;padding:4px 14px;border-radius:var(--radius);background:rgba(0,0,0,.24);text-align:left}" +
    ".facts div{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:14px}" +
    ".facts dt{margin-right:12px}" +
    // tela baixa: o ícone encolhe (sem min(), que o WebView antigo dos coletores não entende)
    "@media (max-height:520px){.ico{width:80px;height:80px}}" +
    ".facts dt{opacity:.85}.facts dd{margin:0;font-family:var(--font-mono);font-size:16px;font-weight:500;text-align:right;word-break:break-all}" +
    ".who{font-size:13px;opacity:.92}.who b{font-family:var(--font-mono);font-weight:500}" +
    "button{flex:none;width:100%;max-width:440px;min-height:56px;margin-top:10px;border:0;border-radius:var(--radius);background:#fff;color:#b10f0f;" +
    "font:700 20px/1 var(--font-display);letter-spacing:.08em;text-transform:uppercase;box-shadow:0 6px 18px rgba(0,0,0,.25)}" +
    "button:disabled{opacity:.55}button:active{transform:scale(.98)}";
  // caminhão com um volume e um X: o volume é de outra carga/placa
  var ALERT_ICON =
    '<svg viewBox="0 0 96 96" fill="none" stroke="#c81010" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 40h46v28H6z"/><path d="M52 50h16l10 10v8H52z"/><circle cx="20" cy="72" r="7" fill="#fff"/><circle cx="66" cy="72" r="7" fill="#fff"/>' +
    '<rect x="18" y="48" width="18" height="14" rx="2"/>' +
    '<circle cx="72" cy="24" r="16" fill="#c81010" stroke="none"/><path d="M65 17l14 14M79 17 65 31" stroke="#fff" stroke-width="5"/></svg>';

  function ruleFor(err) {
    for (var i = 0; i < ALERTS.length; i++) {
      var m = err.match(ALERTS[i].re);
      if (m) return { rule: ALERTS[i], m: m };
    }
    return null;
  }
  /** A mensagem do SSW como apareceu, com os dados (CTRC, placa, quem) em negrito. */
  function alertMessage(hit, err) {
    var p = el("p", "msg");
    var m = hit.m;
    if (!m || m.length < 2) {
      p.textContent = err;
      return p;
    }
    for (var i = 1; i < m.length; i++) {
      if (!m[i]) continue;
      // grupos pares: os dados; ímpares: o texto em volta
      if (i % 2 === 0) p.appendChild(el("b", null, m[i]));
      else p.appendChild(document.createTextNode(m[i]));
    }
    return p;
  }

  /** Abre o alerta para a mensagem do SSW, se ela for de um tipo que pede (ALERTS). */
  function raise(id, err, s, code) {
    if (!bridge.alert) return;
    var hit = ruleFor(err);
    if (!hit) return;
    closeAlert(false);
    loadFonts();
    var now = new Date();
    var sh = shadowHost("starx-alert", ALERT_CSS);
    var ov = el("div", "ov");
    ov.setAttribute("role", "alertdialog");
    ov.setAttribute("aria-modal", "true");
    var mid = el("div", "mid");
    var ico = el("div", "ico");
    ico.innerHTML = ALERT_ICON;
    mid.appendChild(ico);
    mid.appendChild(el("h1", "title", hit.rule.title));
    mid.appendChild(alertMessage(hit, err));
    if (code) {
      var dl = el("dl", "facts");
      var row = el("div");
      row.appendChild(el("dt", null, "Código bipado"));
      row.appendChild(el("dd", null, code));
      dl.appendChild(row);
      mid.appendChild(dl);
    }
    // quem, em qual carga e quando: ficam na captura da tela
    var who = el("div", "who");
    var parts = [
      ["", (s && s.user) || "—"],
      ["placa ", (s && (s.realPlate || s.plate)) || "—"],
      ["", two(now.getDate()) + "/" + two(now.getMonth() + 1) + " " + two(now.getHours()) + ":" + two(now.getMinutes()) + ":" + two(now.getSeconds())],
    ];
    for (var j = 0; j < parts.length; j++) {
      if (j) who.appendChild(document.createTextNode(" · "));
      if (parts[j][0]) who.appendChild(document.createTextNode(parts[j][0]));
      who.appendChild(el("b", null, parts[j][1]));
    }
    mid.appendChild(who);
    var ok = el("button", null, "Entendi");
    ok.type = "button";
    ok.disabled = true;
    ok.addEventListener("click", function () {
      if (!ok.disabled) closeAlert(true);
    });
    ov.appendChild(mid);
    ov.appendChild(ok);
    sh.root.appendChild(ov);
    blurPage();
    // fora do body: a redução da página (fitPage) não pega o alerta
    document.documentElement.appendChild(sh.host);
    fitPage();
    var host = sh.host;
    al.host = host;
    // um toque que já vinha (o dedo na tela) não fecha o alerta sem ele ser lido
    setTimeout(function () {
      if (al.host === host) ok.disabled = false;
    }, ALERT_ARM_MS);
    // alarme, vibração e captura: depois de o alerta aparecer na tela (e as fontes carregarem, para a captura)
    var fire = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (al.host !== host) return;
          try {
            bridge.alert(id, hit.rule.key);
          } catch (e) {}
        });
      });
    };
    var fired = false;
    var once = function () {
      if (!fired) {
        fired = true;
        fire();
      }
    };
    try {
      document.fonts.ready.then(once);
    } catch (e) {}
    setTimeout(once, 400);
  }
  /** Fecha o alerta; pelo "Entendi", fecha também a janela de erro do SSW e volta o cursor ao campo do código. */
  function closeAlert(byUser) {
    if (!al.host) return;
    var host = al.host;
    al.host = null;
    if (host.parentNode) host.parentNode.removeChild(host);
    unfitPage();
    try {
      bridge.alertEnd();
    } catch (e) {}
    if (!byUser) return;
    var btn = byId("btn_errormsg_fechar");
    try {
      if (btn) btn.click();
    } catch (e) {}
    focusBarcode();
  }

  /** Com uma das telas aberta, teclas (o leitor de código é um teclado) não chegam à página. */
  function blockKeys(e) {
    if (!al.host) return;
    e.preventDefault();
    e.stopImmediatePropagation();
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

  // ------------------------------------------------------------ página do tamanho da tela (leitor 2026-11-27.2)
  // O SSW é mais largo e mais alto que a tela do coletor: rola para os lados e para baixo. O leitor reduz a página
  // (zoom no body) até caber na largura e na altura, sem passar de FIT_AUTO_MIN (texto legível); se ainda não couber,
  // sobra só a rolagem vertical. A altura de referência é a maior vista (sem o teclado da tela, que encolhe a janela
  // por um instante e faria a página encolher junto). Com o alerta aberto, quem manda no zoom é o alerta (fitPage).
  var FIT_AUTO_MIN = 0.9;
  var fitH = 0;
  var fitW = 0;
  function zoomOf(el) {
    var z = parseFloat(el.style.zoom);
    return z > 0 ? z : 1;
  }
  function autoFit() {
    var b = document.body;
    if (!b || al.fit) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (!vw || !vh) return;
    // girou a tela ou mudou a largura: recomeça a altura de referência
    if (vw !== fitW) {
      fitW = vw;
      fitH = vh;
    } else if (vh > fitH) fitH = vh;
    try {
      var cur = zoomOf(b);
      var target = cur;
      // duas passadas: reduzir libera largura (a página se rearruma mais baixa), então mede de novo
      for (var i = 0; i < 2; i++) {
        b.style.zoom = String(target);
        var de = document.documentElement;
        var w = Math.max(b.scrollWidth, de.scrollWidth) / target;
        var h = Math.max(b.scrollHeight, de.scrollHeight) / target;
        var next = Math.min(1, fitW / (w || 1), fitH / (h || 1));
        next = Math.max(FIT_AUTO_MIN, Math.floor(next * 100) / 100);
        if (Math.abs(next - target) < 0.02) break;
        target = next;
      }
      // sem mexer por pouco (evita a página "respirar" a cada retrato)
      b.style.zoom = Math.abs(target - cur) < 0.02 ? String(cur) : String(target);
      if (b.style.zoom === "1") b.style.zoom = "";
    } catch (e) {}
  }

  // Janela de erro do SSW mais abaixo (posição escolhida no coletor): o cabeçalho com o usuário logado fica à vista
  // acima dela (na tela e na captura do alerta).
  var ERROR_TOP_PX = 68;
  function errorBoxStyle() {
    if (byId("starx-errpos")) return;
    var st = document.createElement("style");
    st.id = "starx-errpos";
    st.textContent = "#errormsg .modal-dialog{margin-top:" + ERROR_TOP_PX + "px !important}";
    (document.head || document.documentElement).appendChild(st);
  }

  function scan(force) {
    pending = false;
    errorBoxStyle();
    autoFit();
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
    sc.actionAt = Date.now();
    try {
      bridge.action(name);
    } catch (err) {}
    soon();
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("keydown", blockKeys, true);
  window.addEventListener("keypress", blockKeys, true);
  window.addEventListener("keyup", blockKeys, true);
  try {
    observer = new MutationObserver(soon);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  } catch (e) {}
  // campos escondidos mudam por script sem gerar mutação: confere também a cada 500 ms
  timer = setInterval(scan, 500);
  window.addEventListener("resize", autoFit);

  window.__starxOps = {
    version: VERSION,
    scan: scan,
    // teste no navegador: abre o alerta com uma mensagem qualquer
    preview: function (err, code) {
      raise("preview", String(err || ""), snapshot(), code || "");
    },
    stop: function () {
      clearInterval(timer);
      if (observer) observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", blockKeys, true);
      window.removeEventListener("keypress", blockKeys, true);
      window.removeEventListener("keyup", blockKeys, true);
      window.removeEventListener("resize", autoFit);
      closeAlert(false);
      var es = byId("starx-errpos");
      if (es && es.parentNode) es.parentNode.removeChild(es);
      delete window.__starxOps;
    },
  };
  scan(true);
})();
