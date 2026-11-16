import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Enrollment, type Release } from "@/lib/api";
import { revokeEnrollment } from "@/lib/actions";
import { dateTime, enrollmentStatus as statusBadge } from "@/lib/format";
import { AdbInstall } from "./AdbInstall";
import { QrGenerator } from "./QrGenerator";

export const dynamic = "force-dynamic";

export default async function EnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enrollments, release } = await api<{ enrollments: Enrollment[]; release: Release | null }>("/v1/admin/enrollments");
  const e = enrollments.find((x) => x.id === id);
  if (!e) notFound();
  const active = e.status === "active";
  const apkUrl = release ? `${e.serverUrl}/apks/${release.file}` : "<APK>";
  const configB64 = e.initialConfig ? Buffer.from(JSON.stringify(e.initialConfig)).toString("base64") : null;
  const wifiScript = [
    "# 1) ligar a conexão (troque IP e portas pelos do coletor)",
    "#    Android 11+: Opções do desenvolvedor → Depuração por Wi-Fi → Parear com código",
    "adb pair <IP>:<PORTA-DE-PAREAMENTO>",
    "adb connect <IP>:<PORTA>",
    "#    Android 10 (ex.: Chainway C6000): uma vez com o cabo USB, depois pode tirar o cabo",
    "#    adb tcpip 5555   e então   adb connect <IP>:5555",
    "",
    "# 2) instalar e configurar",
    `curl -fLo starx-kiosk.apk ${apkUrl}`,
    "adb install -r starx-kiosk.apk",
    "adb shell dpm set-device-owner com.pstarx.kiosk/.admin.AdminReceiver",
    "adb shell appops set com.pstarx.kiosk SYSTEM_ALERT_WINDOW allow",
    ...(configB64 ? [`adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin <PIN> --es config_b64 ${configB64}`] : []),
    `adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin <PIN> --es enroll_url ${e.serverUrl} --es enroll_code ${e.code}`,
  ].join("\n");
  const adb = `adb shell am broadcast -n com.pstarx.kiosk/.adb.AdbConfigReceiver -a com.pstarx.kiosk.CONFIG --es pin <PIN> --es enroll_url ${e.serverUrl} --es enroll_code ${e.code}`;

  return (
    <div className="stack">
      <Link href="/enroll" className="muted">
        ← Cadastro
      </Link>
      <div className="row">
        <h1 style={{ margin: 0 }}>{e.name}</h1>
        <span className={`badge ${statusBadge[e.status][0]}`}>{statusBadge[e.status][1]}</span>
      </div>

      <div className="grid">
        <section className="card stack">
          <h2>Código</h2>
          <div className="code-big mono">{e.code}</div>
          <dl className="kv">
            <dt>Servidor</dt>
            <dd className="mono small">{e.serverUrl}</dd>
            <dt>Usos</dt>
            <dd>
              {e.uses}
              {e.maxUses !== null ? ` de ${e.maxUses}` : " (sem limite)"} · {e.devices} aparelho(s) hoje
            </dd>
            <dt>Perfil</dt>
            <dd>{e.profileName ?? "nenhum"}</dd>
            <dt>Validade</dt>
            <dd>{e.expiresAt ? dateTime(e.expiresAt) : "sem validade"}</dd>
            <dt>Criado</dt>
            <dd>{dateTime(e.createdAt)}</dd>
          </dl>
          {e.status === "active" && (
            <form action={revokeEnrollment}>
              <input type="hidden" name="id" value={e.id} />
              <button className="danger">Revogar código</button>
            </form>
          )}
        </section>

        <section className="card stack">
          <h2>Aparelho que já tem o app</h2>
          <p className="small" style={{ margin: 0 }}>
            No aparelho: 5 toques no canto → PIN → <strong>Avançado</strong> → <strong>Painel</strong> → informe o servidor e o código.
          </p>
          <p className="small" style={{ margin: 0 }}>Ou por ADB (o PIN do aparelho é exigido):</p>
          <pre className="json mono small" style={{ whiteSpace: "pre-wrap" }}>
            {adb}
          </pre>
        </section>
      </div>

      <section className="card stack">
        <h2>Instalar por cabo USB (direto do navegador)</h2>
        {!release ? (
          <div className="alert warn">Nenhum APK publicado no servidor ainda.</div>
        ) : !active ? (
          <div className="alert warn">Este código não está ativo.</div>
        ) : (
          <AdbInstall enrollment={e} release={release} />
        )}
      </section>

      <section className="card stack">
        <h2>Instalar por depuração Wi-Fi (comandos)</h2>
        <p className="small" style={{ margin: 0 }}>
          O navegador não consegue abrir a conexão de ADB por Wi-Fi (só por USB). Rode estes comandos num computador com o{" "}
          <a href="https://developer.android.com/tools/releases/platform-tools" target="_blank" rel="noreferrer">
            ADB
          </a>{" "}
          instalado, na mesma rede do coletor. Troque &lt;PIN&gt; pelo PIN de administrador que o aparelho vai ter.
        </p>
        <pre className="json mono small" style={{ whiteSpace: "pre-wrap" }}>
          {wifiScript}
        </pre>
      </section>

      {e.initialConfig ? (
        <section className="card stack">
          <details>
            <summary>
              <strong>Configuração inicial</strong> <span className="muted small">— vai no QR</span>
            </summary>
            <pre className="json mono" style={{ marginTop: 12 }}>
              {JSON.stringify(e.initialConfig, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}

      <section className="card stack">
        <h2>QR de provisionamento (aparelho novo ou resetado)</h2>
        {!release ? (
          <div className="alert warn">Nenhum APK publicado no servidor ainda.</div>
        ) : !active ? (
          <div className="alert warn">Este código não está ativo.</div>
        ) : (
          <QrGenerator id={e.id} />
        )}
        <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Aparelho de fábrica (ou resetado), na tela de boas-vindas.</li>
          <li>Toque 6 vezes no mesmo ponto da tela: abre o leitor de QR (no Android 10, ele pode pedir Wi-Fi antes).</li>
          <li>Leia o QR. O aparelho baixa o app deste servidor, vira gerenciado e aparece em Aparelhos.</li>
        </ol>
      </section>
    </div>
  );
}
