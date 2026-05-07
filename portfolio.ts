const BINANCE_PRICE_API = "https://api.binance.com/api/v3/ticker/price";

interface Position {
  symbol: string;
  amount: number;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatValue(val: number): string {
  return val >= 1000
    ? `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${val.toFixed(2)}`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

export class PortfolioManager {
  private portfolios: Map<string, Map<string, number>> = new Map();

  private getPortfolio(userId: string): Map<string, number> {
    if (!this.portfolios.has(userId)) {
      this.portfolios.set(userId, new Map());
    }
    return this.portfolios.get(userId)!;
  }

  add(userId: string, symbol: string, amount: number): void {
    const portfolio = this.getPortfolio(userId);
    const existing = portfolio.get(symbol.toUpperCase()) ?? 0;
    portfolio.set(symbol.toUpperCase(), existing + amount);
  }

  remove(userId: string, symbol: string): boolean {
    return this.getPortfolio(userId).delete(symbol.toUpperCase());
  }

  reset(userId: string): void {
    this.portfolios.delete(userId);
  }

  getPositions(userId: string): Position[] {
    return Array.from(this.getPortfolio(userId).entries()).map(([symbol, amount]) => ({
      symbol,
      amount,
    }));
  }

  async buildReport(userId: string, username: string): Promise<string> {
    const positions = this.getPositions(userId);

    if (positions.length === 0) {
      return [
        "📭 **Portföyünüz boş.**",
        "",
        "`!portfoy ekle BTC 0.5` ile token ekleyebilirsiniz.",
      ].join("\n");
    }

    const pairs = positions.map((p) => `${p.symbol}USDT`);
    const url = `${BINANCE_PRICE_API}?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;

    let priceMap: Map<string, number>;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Array<{ symbol: string; price: string }>;
      priceMap = new Map(data.map((t) => [t.symbol.slice(0, -4), parseFloat(t.price)]));
    } catch {
      return "Portföy değerleri hesaplanırken hata oluştu.";
    }

    let totalValue = 0;
    const lines = positions.map((p) => {
      const price = priceMap.get(p.symbol);
      if (price === undefined) return `• **${p.symbol}**: ${p.amount} (fiyat alınamadı)`;
      const value = price * p.amount;
      totalValue += value;
      return `• **${p.symbol}**: ${p.amount} × $${formatPrice(price)} = **${formatValue(value)}**`;
    });

    return [
      `💼 **${username} Portföyü** (${timestamp()} TSİ)`,
      ``,
      ...lines,
      ``,
      `💰 **Toplam Değer: ${formatValue(totalValue)}**`,
    ].join("\n");
  }
}
