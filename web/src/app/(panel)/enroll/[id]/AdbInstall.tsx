"use client";

import { useEffect, useState } from "react";
import type { Enrollment, Release } from "@/lib/api";

const PKG = "com.pstarx.kiosk";
const ADMIN = `${PKG}/.admin.AdminReceiver`;
const REMOTE_APK = "/data/local/tmp/starx-kiosk.apk";

type StepState = "wait" | "run" | "ok" | "fail" | "skip";
type Step = { key: string; label: string; state: StepState; detail?: string };

const STEPS: { key: string; label: string }[] = [
  { key: "connect", label: "Conectar e autorizar a depuração USB" },
  { key: "check", label: "Conferir o aparelho (contas e Device Owner)" },
  { key: "download", label: "Baixar o app do servidor e conferir o SHA-256" },
  { key: "install", label: "Instalar o app" },
  { key: "owner", label: "Tornar o app Device Owner" },
  { key: "overlay", label: "Liberar o gesto no canto (sobrepor a outros apps)" },
  { key: "verifier", label: "Desligar a verificação do Play Protect (atualização automática)" },
  { key: "enroll", label: "Definir o PIN, aplicar a configuração inicial e cadastrar no painel" },
];

const tone: Record<StepState, string> = { wait: "off", run: "blue", ok: "ok", fail: "danger", skip: "off" };
const word: Record<StepState, string> = { wait: "aguardando", run: "em andamento", ok: "concluído", fail: "falhou", skip: "já estava" };

function b64(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

async function sha256Hex(data: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Instalação do kiosk por USB, direto do navegador (WebUSB, Chrome/Edge no computador).
 * Faz o mesmo que os comandos de ADB: instala, Device Owner, sobreposição, PIN, configuração inicial e cadastro.
 */
export function AdbInstall({ enrollment, release }: { enrollment: Enrollment; release: Release }) {
  const [pin, setPin] = useState("");
  const [disableVerifier, setDisableVerifier] = useState(true);
  const [steps, setSteps] = useState<Step[]>(STEPS.map((s) => ({ ...s, state: "wait" })));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // só no navegador (no servidor não há navigator): evita divergência na hidratação
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported("usb" in navigator), []);

  const set = (key: string, state: StepState, detail?: string) =>
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, state, detail } : s)));

  async function run() {
    if (!/^\d{4,12}$/.test(pin)) {
      setResult({ ok: false, text: "Informe o PIN de administrador do aparelho (4 a 12 números)." });
      return;
    }
    setRunning(true);
    setResult(null);
    setSteps(STEPS.map((s) => ({ ...s, state: "wait" })));
    let current = "connect";
    let adb: import("@yume-chan/adb").Adb | undefined;
    try {
      const [{ Adb, AdbDaemonTransport }, { AdbDaemonWebUsbDeviceManager, AdbDaemonWebUsbDevice }, { default: AdbWebCredentialStore }, { ReadableStream }] =
        await Promise.all([import("@yume-chan/adb"), import("@yume-chan/adb-daemon-webusb"), import("@yume-chan/adb-credential-web"), import("@yume-chan/stream-extra")]);

      // 1. conectar
      set("connect", "run", "Escolha o coletor na janela do navegador. No coletor, toque em Permitir quando pedir.");
      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) throw new Error("este navegador não tem WebUSB: use o Chrome ou o Edge no computador");
      const device = await manager.requestDevice();
      if (!device) throw new Error("nenhum aparelho escolhido");
      let connection;
      try {
        connection = await device.connect();
      } catch (e) {
        if (e instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
          throw new Error("o USB do coletor está em uso por outro programa: feche o Android Studio e rode \"adb kill-server\" no computador");
        }
        throw e;
      }
      const transport = await AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore: new AdbWebCredentialStore("StarX Kiosk") });
      adb = new Adb(transport);
      const sh = (cmd: string) => adb!.subprocess.noneProtocol.spawnWaitText(cmd).then((t) => t.trim());
      const model = `${await adb.getProp("ro.product.manufacturer")} ${await adb.getProp("ro.product.model")}`;
      set("connect", "ok", `${model} · Android ${await adb.getProp("ro.build.version.release")} · serial ${device.serial}`);

      // 2. conferir
      current = "check";
      set("check", "run");
      // `dpm list-owners` não existe no Android 10 (responde com a ajuda do comando); o dumpsys funciona em todas as
      // versões: "Device Owner:" seguido de "admin=ComponentInfo{pacote/classe}" só quando há um dono
      const policy = await sh("dumpsys device_policy");
      const owner = /Device Owner:[\s\S]*?admin=ComponentInfo\{([^/}]+)\//.exec(policy)?.[1] ?? null;
      const ownerIsUs = owner === PKG;
      if (owner && !ownerIsUs) {
        throw new Error(`o aparelho já tem outro Device Owner: ${owner}. Ele precisa ser removido (ou o aparelho resetado) antes.`);
      }
      const accounts = await sh("dumpsys account | grep -c 'Account {'");
      const hasAccounts = Number(accounts) > 0;
      if (!ownerIsUs && hasAccounts) {
        throw new Error("o aparelho tem contas (Google, Samsung etc.). Remova as contas em Configurações → Contas, ou faça o reset de fábrica e pule as contas.");
      }
      set("check", "ok", ownerIsUs ? "o StarX Kiosk já é Device Owner: só atualiza e cadastra" : "sem contas e sem Device Owner");

      // 3. baixar
      current = "download";
      set("download", "run");
      const res = await fetch(`/kiosk-apk/${release.file}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`o painel não entregou o APK (HTTP ${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha = await sha256Hex(bytes);
      if (sha !== release.sha256) throw new Error("SHA-256 do APK não confere com o publicado: instalação cancelada");
      set("download", "ok", `${release.versionName} (${release.versionCode}) · ${Math.round(bytes.length / 1024)} KB`);

      // 4. instalar
      current = "install";
      set("install", "run", "Se aparecer o aviso do Play Protect no coletor, toque em Instalar mesmo assim.");
      const sync = await adb.sync();
      try {
        await sync.write({
          filename: REMOTE_APK,
          file: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(bytes);
              c.close();
            },
          }),
        });
      } finally {
        await sync.dispose();
      }
      const install = await sh(`pm install -r ${REMOTE_APK}`);
      await sh(`rm -f ${REMOTE_APK}`);
      if (!/Success/.test(install)) throw new Error(`pm install: ${install}`);
      set("install", "ok");

      // 5. Device Owner
      current = "owner";
      if (ownerIsUs) {
        set("owner", "skip");
      } else {
        set("owner", "run");
        const out = await sh(`dpm set-device-owner ${ADMIN}`);
        if (!/Success/i.test(out)) throw new Error(out.includes("accounts") ? "o Android recusou: há contas no aparelho" : out);
        set("owner", "ok");
      }

      // 6. sobreposição
      current = "overlay";
      set("overlay", "run");
      await sh(`appops set ${PKG} SYSTEM_ALERT_WINDOW allow`);
      set("overlay", "ok");

      // 7. Play Protect: sem isso, aparelhos com serviços do Google recusam a atualização automática do app
      //    (instalação sem ninguém na tela para tocar em "Instalar mesmo assim")
      current = "verifier";
      const hasPlay = (await sh("pm list packages com.android.vending")).includes("package:com.android.vending");
      if (!hasPlay) {
        set("verifier", "skip", "sem serviços do Google (Play Protect não existe neste aparelho)");
      } else if (!disableVerifier) {
        set("verifier", "skip", "mantido ligado: atualizações do app terão de ser feitas pelo cabo");
      } else {
        set("verifier", "run");
        await sh("settings put global package_verifier_enable 0");
        await sh("settings put global verifier_verify_adb_installs 0");
        const now = await sh("settings get global package_verifier_enable");
        if (now !== "0") throw new Error(`o Android não aceitou desligar a verificação (package_verifier_enable=${now})`);
        set("verifier", "ok", "verificação desligada: o app se atualiza sozinho");
      }

      // 8. PIN, configuração inicial e cadastro (o receptor de ADB do app)
      current = "enroll";
      set("enroll", "run");
      const receiver = `am broadcast -n ${PKG}/.adb.AdbConfigReceiver -a ${PKG}.CONFIG --es pin ${pin}`;
      if (enrollment.initialConfig) {
        const out = await sh(`${receiver} --es config_b64 ${b64(JSON.stringify(enrollment.initialConfig))}`);
        if (!/"ok":true/.test(out)) throw new Error(`configuração inicial: ${out}`);
      }
      const out = await sh(`${receiver} --es enroll_url ${enrollment.serverUrl} --es enroll_code ${enrollment.code}`);
      if (!/"ok":true/.test(out)) {
        const msg = /"error":"([^"]*)"/.exec(out)?.[1] ?? out;
        throw new Error(msg);
      }
      const name = /"name":"([^"]*)"/.exec(out)?.[1];
      set("enroll", "ok", name ? `cadastrado como "${name}"` : undefined);
      setResult({ ok: true, text: "Pronto. O coletor já aparece em Aparelhos. Pode desconectar o cabo (e desligar a depuração USB)." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // o usuário fechou a janela de escolha do aparelho
      const canceled = e instanceof DOMException && e.name === "NotFoundError";
      set(current, "fail", canceled ? "nenhum aparelho escolhido" : msg);
      setResult({ ok: false, text: canceled ? "Nenhum aparelho escolhido." : msg });
    } finally {
      await adb?.close().catch(() => undefined);
      setRunning(false);
    }
  }

  if (supported === false) {
    return (
      <div className="alert warn">
        Este navegador não fala com USB. Abra o painel no Chrome ou no Edge, no computador onde o coletor está conectado.
      </div>
    );
  }

  return (
    <div className="stack">
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>No coletor: Configurações → Sobre o telefone → toque 7× em Número da versão; depois Opções do desenvolvedor → Depuração USB ligada.</li>
        <li>Conecte o cabo USB no computador. Feche o Android Studio e outros programas de ADB (eles prendem o USB).</li>
        <li>O aparelho precisa estar sem contas (Google etc.) e sem outro Device Owner: de preferência, recém-resetado.</li>
      </ol>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label style={{ width: 200 }}>
          PIN de administrador do aparelho
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={12} placeholder="4 a 12 números" className="mono" />
        </label>
        <button className="primary" onClick={run} disabled={running}>
          {running ? "Instalando…" : "Conectar coletor e instalar"}
        </button>
      </div>
      <label className="inline" style={{ alignItems: "flex-start" }}>
        <input type="checkbox" checked={disableVerifier} onChange={(e) => setDisableVerifier(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          Desligar a verificação do Play Protect (só em aparelhos com serviços do Google)
          <span className="muted small" style={{ display: "block" }}>
            Sem isso, o Play Protect recusa a atualização automática do app do kiosk (não há ninguém para tocar em &quot;Instalar mesmo assim&quot;). O coletor em kiosk só
            roda os apps liberados pelo painel.
          </span>
        </span>
      </label>
      <span className="muted small">
        O PIN abre as configurações no coletor (5 toques no canto). Se o aparelho já tem o StarX com PIN, use o mesmo. O código {enrollment.code}
        {enrollment.profileName ? ` (perfil ${enrollment.profileName})` : ""} é usado no cadastro.
      </span>

      <div className="table-wrap">
        <table>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.key}>
                <td className="mono muted" style={{ width: 28 }}>
                  {i + 1}
                </td>
                <td>
                  {s.label}
                  {s.detail && <div className={`small ${s.state === "fail" ? "" : "muted"}`} style={s.state === "fail" ? { color: "var(--bad-deep)" } : undefined}>{s.detail}</div>}
                </td>
                <td style={{ width: 130, textAlign: "right" }}>
                  <span className={`badge ${tone[s.state]}`}>
                    <span className="dot" /> {word[s.state]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result && <div className={`alert ${result.ok ? "ok" : "error"}`}>{result.text}</div>}
    </div>
  );
}
