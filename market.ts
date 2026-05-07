const COINGECKO_API = "https://api.coingecko.com/api/v3/global";
const FNG_API = "https://api.alternative.me/fng/?limit=1";
const EXCHANGE_API = "https://open.er-api.com/v6/latest/USD";

function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
  return `$${(cap / 1e6).toFixed(2)}M`;
}

function timestamp(): string {
  return new Date().toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

interface CoinGeckoGlobal {
  data: {
    total_market_cap: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    market_cap_change_percentage_24h_usd: number;
    active_cryptocurrencies: number;
  };
}

interface FNGData {
  data: Array<{ value: string; value_classification: string }>;
}

interface ExchangeRateData {
  rates: Record<string, number>;
}

export async function fetchMarketOverview(): Promise<string> {
  let data: CoinGeckoGlobal;
  try {
    const res = await fetch(COINGECKO_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as CoinGeckoGlobal;
  } catch {
    return "Piyasa verileri alınamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const { total_market_cap, market_cap_percentage, market_cap_change_percentage_24h_usd, active_cryptocurrencies } = data.data;
  const totalCap = total_market_cap["usd"] ?? 0;
  const btcDominance = market_cap_percentage["btc"] ?? 0;
  const change24h = market_cap_change_percentage_24h_usd;
  const sign = change24h >= 0 ? "+" : "";
  const changeEmoji = change24h >= 0 ? "📈" : "📉";

  return [
    `🌍 **Kripto Piyasa Özeti** (${timestamp()} TSİ)`,
    ``,
    `${changeEmoji} Toplam Piyasa Değeri: **${formatMarketCap(totalCap)}** (${sign}${change24h.toFixed(2)}%)`,
    `₿ BTC Dominansı: **${btcDominance.toFixed(1)}%**`,
    `🪙 Aktif Token Sayısı: **${active_cryptocurrencies.toLocaleString("tr-TR")}**`,
  ].join("\n");
}

export async function fetchFearGreed(): Promise<string> {
  let data: FNGData;
  try {
    const res = await fetch(FNG_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as FNGData;
  } catch {
    return "Korku & Açgözlülük verisi alınamadı.";
  }

  const item = data.data[0];
  if (!item) return "Korku & Açgözlülük verisi alınamadı.";

  const value = parseInt(item.value);
  const classification = item.value_classification;

  let emoji = "😐";
  if (value >= 80) emoji = "🤑";
  else if (value >= 60) emoji = "😃";
  else if (value >= 40) emoji = "😐";
  else if (value >= 20) emoji = "😰";
  else emoji = "😱";

  const translations: Record<string, string> = {
    "Extreme Fear": "Aşırı Korku",
    "Fear": "Korku",
    "Neutral": "Nötr",
    "Greed": "Açgözlülük",
    "Extreme Greed": "Aşırı Açgözlülük",
  };
  const label = translations[classification] ?? classification;
  const filled = Math.round(value / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);

  return [
    `${emoji} **Korku & Açgözlülük Endeksi** (${timestamp()} TSİ)`,
    ``,
    `**${value}/100** — ${label}`,
    `\`${bar}\``,
  ].join("\n");
}

export async function fetchDolarRate(): Promise<string> {
  let data: ExchangeRateData;
  try {
    const res = await fetch(EXCHANGE_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as ExchangeRateData;
  } catch {
    return "Döviz kurları alınamadı. Lütfen daha sonra tekrar deneyin.";
  }

  const tryRate = data.rates["TRY"] ?? 0;
  const eurRate = data.rates["EUR"] ?? 1;
  const eurTry = tryRate / eurRate;
  const gbpRate = data.rates["GBP"] ?? 1;
  const gbpTry = tryRate / gbpRate;

  return [
    `💵 **Güncel Döviz Kuru** (${timestamp()} TSİ)`,
    ``,
    `• 1 USD = **${tryRate.toFixed(2)} TRY**`,
    `• 1 EUR = **${eurTry.toFixed(2)} TRY**`,
    `• 1 GBP = **${gbpTry.toFixed(2)} TRY**`,
  ].join("\n");
}
