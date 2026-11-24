/*
  Service worker do painel: recebe as notificações no celular (Web Push) mesmo com o app fechado.
  A API manda { title, body, url, tag }; tocar na notificação abre (ou traz para a frente) o painel nessa página.
*/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Starx Kiosk";
  // só caminhos do próprio painel (nunca um endereço de fora)
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/operations";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon1.png",
      badge: "/icon1.png",
      lang: "pt-BR",
      // a mesma carga substitui a notificação anterior (o fim troca o início) e avisa de novo
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/operations", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) return open.navigate(target);
        return;
      }
      return self.clients.openWindow(target);
    })(),
  );
});
