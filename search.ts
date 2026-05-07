const BINANCE_24HR_API = "https://api.binance.com/api/v3/ticker/24hr";

interface Binance24hrTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  volume: string;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(2)}K`;
  return `$${vol.toFixed(2)}`;
}

function changeEmoji(pct: number): string {
  if (pct >= 5) return "🚀";
  if (pct > 0) return "📈";
  if (pct === 0) return "➡️";
  if (pct > -5) return "📉";
  return "🔴";
}

function timestamp(): string {
  return new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

export async function searchToken(symbol: string): Promise<string> {
  const upper = symbol.toUpperCase();
  const pair = `${upper}USDT`;
  const url = `${BINANCE_24HR_API}?symbol=${pair}`;

  let t: Binance24hrTicker;
  try {
    const res = await fetch(url);
    if (res.status === 400) {
      return `❌ **${upper}** tokeni Binance'ta bulunamadı. Sembolü kontrol edin (örn: \`!ara SOL\`)`;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    t = (await res.json()) as Binance24hrTicker;
  } catch {
    return "Token bilgileri alınamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const price = parseFloat(t.lastPrice);
  const pct = parseFloat(t.priceChangePercent);
  const high = parseFloat(t.highPrice);
  const low = parseFloat(t.lowPrice);
  const vol = parseFloat(t.quoteVolume);
  const sign = pct >= 0 ? "+" : "";

  return [
    `${changeEmoji(pct)} **${upper}/USDT** (${timestamp()} TSİ)`,
    ``,
    `💲 Fiyat: **$${formatPrice(price)}**`,
    `📊 24s Değişim: **${sign}${pct.toFixed(2)}%**`,
    `⬆️ 24s Yüksek: $${formatPrice(high)}`,
    `⬇️ 24s Düşük: $${formatPrice(low)}`,
    `🔄 24s Hacim: ${formatVolume(vol)}`,
  ].join("\n");
}
