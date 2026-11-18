import { api, type Me, type OpsCard, type OpsSettings } from "@/lib/api";
import { OpsBoard } from "./OpsBoard";
import { ReaderAll } from "./ReaderAll";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const [{ cards, serverTime }, settings, me] = await Promise.all([
    api<{ cards: OpsCard[]; serverTime: number }>("/v1/admin/ops/cards"),
    api<OpsSettings>("/v1/admin/ops/settings"),
    api<Me>("/v1/admin/me"),
  ]);
  return (
    <div className="stack wide">
      <OpsBoard initial={cards} initialServerTime={serverTime} />
      <ReaderAll settings={settings} canEdit={me.role === "admin"} />
    </div>
  );
}
