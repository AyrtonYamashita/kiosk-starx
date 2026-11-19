import { api, type OpsCard } from "@/lib/api";
import { OpsBoard } from "./OpsBoard";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const { cards, serverTime } = await api<{ cards: OpsCard[]; serverTime: number }>("/v1/admin/ops/cards");
  return <OpsBoard initial={cards} initialServerTime={serverTime} />;
}
