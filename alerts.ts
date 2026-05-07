import { Client } from "@jubbio/core";

const BINANCE_PRICE_API = "https://api.binance.com/api/v3/ticker/price";

export interface Alert {
  userId: string;
  username: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  channelId: string;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

export class AlertManager {
  private alerts: Alert[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  add(alert: Alert): void {
    this.alerts.push(alert);
  }

  remove(userId: string, symbol: string): number {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter(
      (a) => !(a.userId === userId && a.symbol === symbol.toUpperCase())
    );
    return before - this.alerts.length;
  }

  list(userId: string): Alert[] {
    return this.alerts.filter((a) => a.userId === userId);
  }

  startChecking(client: Client): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.checkPrices(client).catch((err) =>
        console.error("Alarm kontrolünde hata:", err)
      );
    }, 60_000);
  }

  private async checkPrices(client: Client): Promise<void> {
    if (this.alerts.length === 0) return;

    const symbols = [...new Set(this.alerts.map((a) => a.symbol))];
    const pairs = symbols.map((s) => `${s}USDT`);
    const url = `${BINANCE_PRICE_API}?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;

    let priceMap: Map<string, number>;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as Array<{ symbol: string; price: string }>;
      priceMap = new Map(data.map((t) => [t.symbol.slice(0, -4), parseFloat(t.price)]));
    } catch {
      return;
    }

    const triggered: Alert[] = [];
    const remaining: Alert[] = [];

    for (const alert of this.alerts) {
      const price = priceMap.get(alert.symbol);
      if (price === undefined) { remaining.push(alert); continue; }
      const fired =
        alert.direction === "above" ? price >= alert.targetPrice : price <= alert.targetPrice;
      if (fired) triggered.push(alert);
      else remaining.push(alert);
    }

    this.alerts = remaining;

    for (const alert of triggered) {
      const channel = client.channels.get(alert.channelId);
      if (!channel || !channel.isTextBased()) continue;

      const price = priceMap.get(alert.symbol)!;
      const direction = alert.direction === "above" ? "üzerine çıktı ✅" : "altına düştü ✅";
      const emoji = alert.direction === "above" ? "📈" : "📉";

      await channel.send(
        [
          `${emoji} **Fiyat Alarmı!** <@${alert.userId}>`,
          ``,
          `**${alert.symbol}** $${formatPrice(price)} ile $${formatPrice(alert.targetPrice)} hedefinin **${direction}**`,
        ].join("\n")
      );
    }
  }
}
