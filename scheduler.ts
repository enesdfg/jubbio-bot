import { Client } from "@jubbio/core";
import { fetchMarketOverview, fetchFearGreed } from "./market.js";
import { fetchTopGainers } from "./prices.js";

export class DailyReportScheduler {
  private channelId: string | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  setChannel(channelId: string, client: Client): void {
    this.channelId = channelId;
    this.scheduleNext(client);
  }

  disable(): void {
    this.channelId = null;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private getMsUntilNext9AM(): number {
    const now = new Date();
    const istanbulStr = now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
    const istanbul = new Date(istanbulStr);

    const next9AM = new Date(istanbul);
    next9AM.setHours(9, 0, 0, 0);
    if (istanbul >= next9AM) {
      next9AM.setDate(next9AM.getDate() + 1);
    }

    return Math.max(next9AM.getTime() - istanbul.getTime(), 0);
  }

  private scheduleNext(client: Client): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    const delay = this.getMsUntilNext9AM();
    const minutes = Math.round(delay / 60_000);
    console.log(`📅 Günlük rapor ${minutes} dakika sonra gönderilecek.`);

    this.timeoutId = setTimeout(async () => {
      await this.sendReport(client);
      if (this.channelId) this.scheduleNext(client);
    }, delay);
  }

  private async sendReport(client: Client): Promise<void> {
    if (!this.channelId) return;
    const channel = client.channels.get(this.channelId);
    if (!channel || !channel.isTextBased()) return;

    try {
      const [market, gainers, fearGreed] = await Promise.all([
        fetchMarketOverview(),
        fetchTopGainers(),
        fetchFearGreed(),
      ]);

      await channel.send(
        [`🌅 **Günaydın! Günlük Kripto Raporu**`, ``, market, ``, gainers, ``, fearGreed].join("\n")
      );
      console.log("📅 Günlük rapor gönderildi.");
    } catch (err) {
      console.error("Günlük rapor gönderilemedi:", err);
    }
  }
}
