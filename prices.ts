const BINANCE_24HR_API = "https://api.binance.com/api/v3/ticker/24hr";

export const TOKENS: { symbol: string; pair: string }[] = [
  { symbol: "BTC", pair: "BTCUSDT" },
  { symbol: "PHA", pair: "PHAUSDT" },
  { symbol: "BIO", pair: "BIOUSDT" },
  { symbol: "ONT", pair: "ONTUSDT" },
  { symbol: "KAT", pair: "KATUSDT" },
];

const STABLECOINS = new Set([
  "USDC", "BUSD", "TUSD", "USDP", "DAI", "FDUSD", "USDS",
  "EUR", "GBP", "AEUR", "BKRW", "IDRT", "NGN", "RUB", "TRY", "ZAR",
]);

interface BinanceTicker {
  symbol: string;
  price: string;
}

interface Binance24hrTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
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

function rankMedal(i: number): string {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

export async function fetchPrices(): Promise<string> {
  let tickers: Binance24hrTicker[];
  try {
    tickers = await fetchAllUsdtTickers();
  } catch {
    return "Binance API'sine ulaşılamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const top = tickers
    .map((t) => ({
      symbol: t.symbol.slice(0, -4),
      price: parseFloat(t.lastPrice),
      pct: parseFloat(t.priceChangePercent),
      vol: parseFloat(t.quoteVolume),
    }))
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 10);

  const lines = top.map((t) => {
    const sign = t.pct >= 0 ? "+" : "";
    return `• **${t.symbol}**: $${formatPrice(t.price)} (${sign}${t.pct.toFixed(2)}%)`;
  });

  return `💰 **En Popüler Kripto Fiyatları** (${timestamp()} TSİ)\n\n${lines.join("\n")}`;
}

export async function fetchDetailedPrices(): Promise<string> {
  const pairs = TOKENS.map((t) => t.pair);
  const url = `${BINANCE_24HR_API}?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;

  let data: Binance24hrTicker[];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as Binance24hrTicker[];
  } catch {
    return "Binance API'sine ulaşılamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const tickerMap = new Map(data.map((t) => [t.symbol, t]));

  const sections = TOKENS.map(({ symbol, pair }) => {
    const t = tickerMap.get(pair);
    if (!t) return `**${symbol}**: veri yok`;

    const price = parseFloat(t.lastPrice);
    const pct = parseFloat(t.priceChangePercent);
    const high = parseFloat(t.highPrice);
    const low = parseFloat(t.lowPrice);
    const vol = parseFloat(t.quoteVolume);
    const sign = pct >= 0 ? "+" : "";

    return [
      `${changeEmoji(pct)} **${symbol}** — $${formatPrice(price)} (${sign}${pct.toFixed(2)}%)`,
      `　 ↑ ${formatPrice(high)}  ↓ ${formatPrice(low)}  🔄 ${formatVolume(vol)}`,
    ].join("\n");
  });

  return `📊 **24 Saatlik Kripto Detayı** (${timestamp()} TSİ)\n\n${sections.join("\n\n")}`;
}

async function fetchAllUsdtTickers(): Promise<Binance24hrTicker[]> {
  const res = await fetch(BINANCE_24HR_API);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as Binance24hrTicker[];
  return data.filter((t) => {
    if (!t.symbol.endsWith("USDT")) return false;
    const base = t.symbol.slice(0, -4);
    if (STABLECOINS.has(base)) return false;
    if (parseFloat(t.quoteVolume) < 500_000) return false;
    return true;
  });
}

export async function fetchTopGainers(): Promise<string> {
  let tickers: Binance24hrTicker[];
  try {
    tickers = await fetchAllUsdtTickers();
  } catch {
    return "Binance API'sine ulaşılamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const top = tickers
    .map((t) => ({
      symbol: t.symbol.slice(0, -4),
      price: parseFloat(t.lastPrice),
      pct: parseFloat(t.priceChangePercent),
      vol: parseFloat(t.quoteVolume),
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  if (top.length === 0) return "Yeterli veri bulunamadı.";

  const lines = top.map((g, i) => {
    const sign = g.pct >= 0 ? "+" : "";
    return `${rankMedal(i)} **${g.symbol}** — $${formatPrice(g.price)} (${sign}${g.pct.toFixed(2)}%)  🔄 ${formatVolume(g.vol)}`;
  });

  return `🚀 **Binance En Çok Yükselenler** (${timestamp()} TSİ)\n\n${lines.join("\n")}`;
}

export async function fetchTopLosers(): Promise<string> {
  let tickers: Binance24hrTicker[];
  try {
    tickers = await fetchAllUsdtTickers();
  } catch {
    return "Binance API'sine ulaşılamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const top = tickers
    .map((t) => ({
      symbol: t.symbol.slice(0, -4),
      price: parseFloat(t.lastPrice),
      pct: parseFloat(t.priceChangePercent),
      vol: parseFloat(t.quoteVolume),
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 10);

  if (top.length === 0) return "Yeterli veri bulunamadı.";

  const lines = top.map((g, i) => {
    const sign = g.pct >= 0 ? "+" : "";
    return `${rankMedal(i)} **${g.symbol}** — $${formatPrice(g.price)} (${sign}${g.pct.toFixed(2)}%)  🔄 ${formatVolume(g.vol)}`;
  });

  return `🔴 **Binance En Çok Düşenler** (${timestamp()} TSİ)\n\n${lines.join("\n")}`;
}
