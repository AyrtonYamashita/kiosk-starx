"use client";

import { useRef, useState } from "react";
import { refreshApps, uploadToken } from "@/lib/actions";

type Status = { kind: "idle" } | { kind: "sending"; pct: number } | { kind: "ok"; text: string } | { kind: "error"; text: string };

/**
 * Envio de APK: o painel pede um token de uso único e o navegador manda o arquivo direto para a API
 * (a Vercel recusa corpos acima de 4,5 MB).
 */
export function UploadApk({ maxApkMb }: { maxApkMb: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setStatus({ kind: "error", text: "Escolha o arquivo .apk." });
    if (file.size > maxApkMb * 1024 * 1024) return setStatus({ kind: "error", text: `Arquivo maior que ${maxApkMb} MB.` });
    setStatus({ kind: "sending", pct: 0 });
    const t = await uploadToken();
    if ("error" in t) return setStatus({ kind: "error", text: t.error });
    const url = label.trim() ? `${t.uploadUrl}?label=${encodeURIComponent(label.trim())}` : t.uploadUrl;
    // XMLHttpRequest: o fetch não informa o progresso do envio
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-upload-token", t.token);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setStatus({ kind: "sending", pct: Math.round((ev.loaded / ev.total) * 100) });
    xhr.onerror = () => setStatus({ kind: "error", text: "Falha de rede no envio (a API recusou a origem ou está fora do ar)." });
    xhr.onload = async () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // resposta sem JSON (ex.: 413 do proxy)
      }
      if (xhr.status !== 200) {
        return setStatus({ kind: "error", text: body?.message ?? (xhr.status === 413 ? "Arquivo grande demais para o servidor." : `Erro HTTP ${xhr.status}.`) });
      }
      setStatus({
        kind: "ok",
        text: body.alreadyExisted
          ? `${body.packageName} ${body.versionName ?? ""} (${body.versionCode}) já estava no repositório.`
          : `Enviado: ${body.packageName} ${body.versionName ?? ""} (${body.versionCode}).`,
      });
      if (fileRef.current) fileRef.current.value = "";
      setLabel("");
      await refreshApps();
    };
    xhr.send(file);
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="grid">
        <label>
          Arquivo APK (até {maxApkMb} MB)
          <input ref={fileRef} type="file" accept=".apk,application/vnd.android.package-archive" required />
        </label>
        <label>
          Nome no painel (opcional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="o nome que os aparelhos mostram, ou o pacote" />
        </label>
      </div>
      <div className="row">
        <button className="primary" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? `Enviando… ${status.pct}%` : "Enviar APK"}
        </button>
        {status.kind === "ok" && <span className="alert ok small">{status.text}</span>}
        {status.kind === "error" && <span className="alert error small">{status.text}</span>}
      </div>
      <span className="muted small">
        O pacote e a versão vêm do próprio APK. Uma versão nova do mesmo app precisa ter versionCode maior e a mesma assinatura. Os aparelhos com perfis que mantêm o app
        recebem a versão nova sozinhos no próximo contato.
      </span>
    </form>
  );
}
