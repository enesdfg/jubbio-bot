import { pool } from "./db.js";

const BINANCE_PRICE_API = "https://api.binance.com/api/v3/ticker/price";
const STARTING_BALANCE = 10_000;

interface Position {
  symbol: string;
  amount: number;
  avgBuyPrice: number;
}

interface UserAccount {
  userId: string;
  username: string;
  cash: number;
  positions: Map<string, Position>;
  lastDailyClaim: Date | null;
  dailyStreak: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

async function fetchPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_PRICE_API}?symbol=${symbol.toUpperCase()}USDT`);
    if (!res.ok) return null;
    const data = (await res.json()) as { price: string };
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

async function fetchPrices(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();
  const pairs = symbols.map((s) => `${s}USDT`);
  try {
    const res = await fetch(
      `${BINANCE_PRICE_API}?symbols=${encodeURIComponent(JSON.stringify(pairs))}`
    );
    if (!res.ok) return new Map();
    const data = (await res.json()) as Array<{ symbol: string; price: string }>;
    return new Map(data.map((t) => [t.symbol.slice(0, -4), parseFloat(t.price)]));
  } catch {
    return new Map();
  }
}

async function loadAccount(userId: string, username: string): Promise<UserAccount> {
  const client = await pool.connect();
  try {
    // Upsert account row
    const accRes = await client.query(
      `INSERT INTO game_accounts (user_id, username, cash, last_daily_claim, daily_streak)
       VALUES ($1, $2, $3, NULL, 0)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
       RETURNING cash, last_daily_claim, daily_streak`,
      [userId, username, STARTING_BALANCE]
    );
    const row = accRes.rows[0];

    // Load positions
    const posRes = await client.query(
      `SELECT symbol, amount, avg_buy_price FROM game_positions WHERE user_id = $1`,
      [userId]
    );
    const positions = new Map<string, Position>();
    for (const p of posRes.rows) {
      positions.set(p.symbol, {
        symbol: p.symbol,
        amount: parseFloat(p.amount),
        avgBuyPrice: parseFloat(p.avg_buy_price),
      });
    }

    return {
      userId,
      username,
      cash: parseFloat(row.cash),
      positions,
      lastDailyClaim: row.last_daily_claim ? new Date(row.last_daily_claim) : null,
      dailyStreak: row.daily_streak,
    };
  } finally {
    client.release();
  }
}

async function saveAccount(acc: UserAccount): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE game_accounts
       SET cash = $1, last_daily_claim = $2, daily_streak = $3
       WHERE user_id = $4`,
      [acc.cash, acc.lastDailyClaim, acc.dailyStreak, acc.userId]
    );

    // Delete removed positions
    if (acc.positions.size === 0) {
      await client.query(`DELETE FROM game_positions WHERE user_id = $1`, [acc.userId]);
    } else {
      const symbols = [...acc.positions.keys()];
      await client.query(
        `DELETE FROM game_positions WHERE user_id = $1 AND symbol != ALL($2::text[])`,
        [acc.userId, symbols]
      );
      for (const pos of acc.positions.values()) {
        await client.query(
          `INSERT INTO game_positions (user_id, symbol, amount, avg_buy_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, symbol) DO UPDATE
           SET amount = EXCLUDED.amount, avg_buy_price = EXCLUDED.avg_buy_price`,
          [acc.userId, pos.symbol, pos.amount, pos.avgBuyPrice]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export class GameManager {
  async giveWelcomeBonus(userId: string, username: string): Promise<number> {
    const acc = await loadAccount(userId, username);
    acc.cash += 1_000;
    await saveAccount(acc);
    return acc.cash;
  }

  async giveReferralBonus(
    referrerId: string,
    newUserId: string,
    newUsername: string
  ): Promise<{ referrerUsername: string }> {
    const [newAcc, referrerAcc] = await Promise.all([
      loadAccount(newUserId, newUsername),
      pool.query(`SELECT username, cash FROM game_accounts WHERE user_id = $1`, [referrerId]),
    ]);

    newAcc.cash += 500;
    await saveAccount(newAcc);

    if (referrerAcc.rows.length > 0) {
      await pool.query(
        `UPDATE game_accounts SET cash = cash + 500 WHERE user_id = $1`,
        [referrerId]
      );
    }

    return { referrerUsername: referrerAcc.rows[0]?.username ?? referrerId };
  }

  async claimDaily(userId: string, username: string): Promise<string> {
    const acc = await loadAccount(userId, username);
    const now = new Date();

    if (acc.lastDailyClaim) {
      const diffMs = now.getTime() - new Date(acc.lastDailyClaim).getTime();
      const diffHours = diffMs / 3_600_000;

      if (diffHours < 24) {
        const remaining = 24 - diffHours;
        const h = Math.floor(remaining);
        const m = Math.ceil((remaining - h) * 60);
        return [
          `⏰ **Günlük ödülünüzü zaten aldınız!**`,
          ``,
          `🕐 Bir sonraki çark: **${h} saat ${m} dakika** sonra`,
          `🔥 Mevcut seri: **${acc.dailyStreak} gün**`,
        ].join("\n");
      }

      const daysDiff = Math.floor(diffHours / 24);
      acc.dailyStreak = daysDiff <= 1 ? acc.dailyStreak + 1 : 1;
    } else {
      acc.dailyStreak = 1;
    }

    // Weighted wheel spin
    const roll = Math.random() * 100;
    let tier: { label: string; emoji: string; reward: number; isDouble?: boolean };

    if (roll < 1) {
      const bonus = Math.min(acc.cash, 5_000);
      tier = { label: "ÇİFT BAKİYE", emoji: "💫", reward: bonus, isDouble: true };
    } else if (roll < 3) {
      const reward = Math.floor(Math.random() * 2_001) + 3_000;
      tier = { label: "JACKPOT", emoji: "🎯", reward };
    } else if (roll < 10) {
      const reward = Math.floor(Math.random() * 2_001) + 1_000;
      tier = { label: "MEGA ÖDÜL", emoji: "🚀", reward };
    } else if (roll < 25) {
      const reward = Math.floor(Math.random() * 501) + 500;
      tier = { label: "BÜYÜK ÖDÜL", emoji: "💎", reward };
    } else if (roll < 55) {
      const reward = Math.floor(Math.random() * 301) + 200;
      tier = { label: "İyi Ödül", emoji: "🎁", reward };
    } else {
      const reward = Math.floor(Math.random() * 151) + 50;
      tier = { label: "Günlük Ödül", emoji: "🎰", reward };
    }

    const streakBonus = (acc.dailyStreak - 1) * 25;
    const totalReward = tier.reward + streakBonus;

    acc.cash += totalReward;
    acc.lastDailyClaim = now;
    await saveAccount(acc);

    const slots = ["🎰", "💎", "🚀", "🎯", "💫", "🎁"];
    const s = () => slots[Math.floor(Math.random() * slots.length)];
    const wheelRow = `${s()} ${s()} **${tier.emoji}** ${s()} ${s()}`;

    const lines = [
      `🎡 **Şans Çarkı Döndürülüyor...**`,
      ``,
      `┌─────────────────┐`,
      `│  ${wheelRow}  │`,
      `└─────────────────┘`,
      ``,
      `${tier.emoji} **${tier.label}!**`,
      ``,
    ];

    if (tier.isDouble) {
      lines.push(`💫 Nakit bakiyeniz 2'ye katlandı! **+$${fmt(tier.reward)}**`);
    } else {
      lines.push(`💵 Ödül: **+$${fmt(tier.reward)}**`);
    }

    if (streakBonus > 0) lines.push(`⭐ Seri Bonusu (${acc.dailyStreak} gün): **+$${fmt(streakBonus)}**`);
    if (streakBonus > 0 || tier.isDouble) lines.push(`💰 Toplam Kazanç: **+$${fmt(totalReward)}**`);

    lines.push(``, `💰 Nakit Bakiye: **$${fmt(acc.cash)}**`, `🔥 Gün Serisi: **${acc.dailyStreak} gün**`);

    if (acc.dailyStreak >= 7) lines.push(``, `🏅 **7+ gün serisi! Efsane oluyorsunuz!**`);
    if (tier.label === "JACKPOT" || tier.isDouble) lines.push(``, `🎊 Tebrikler! Bu nadir bir ödül!`);

    lines.push(``, `> Çark: 🎰%45 🎁%30 💎%15 🚀%7 🎯%2 💫%1`);
    return lines.join("\n");
  }

  async buy(userId: string, username: string, symbol: string, usdAmount: number): Promise<string> {
    const acc = await loadAccount(userId, username);

    if (usdAmount <= 0) return "❌ Geçersiz miktar.";
    if (acc.cash < usdAmount) {
      return `❌ Yetersiz bakiye! Nakitiniz: **$${fmt(acc.cash)}**, gerekli: **$${fmt(usdAmount)}**`;
    }

    const price = await fetchPrice(symbol);
    if (price === null) {
      return `❌ **${symbol.toUpperCase()}** fiyatı alınamadı. Sembolü kontrol edin.`;
    }

    const tokenAmount = usdAmount / price;
    acc.cash -= usdAmount;

    const upper = symbol.toUpperCase();
    const existing = acc.positions.get(upper);
    if (existing) {
      const totalCost = existing.avgBuyPrice * existing.amount + price * tokenAmount;
      const totalAmount = existing.amount + tokenAmount;
      existing.avgBuyPrice = totalCost / totalAmount;
      existing.amount = totalAmount;
    } else {
      acc.positions.set(upper, { symbol: upper, amount: tokenAmount, avgBuyPrice: price });
    }

    await saveAccount(acc);

    return [
      `✅ **Alış Gerçekleşti!**`,
      ``,
      `🪙 **${tokenAmount.toFixed(6)} ${upper}** alındı`,
      `💲 Fiyat: $${fmtPrice(price)}`,
      `💸 Harcanan: $${fmt(usdAmount)}`,
      `💰 Kalan Nakit: **$${fmt(acc.cash)}**`,
    ].join("\n");
  }

  async sell(userId: string, username: string, symbol: string, usdAmount: number): Promise<string> {
    const acc = await loadAccount(userId, username);
    const upper = symbol.toUpperCase();
    const pos = acc.positions.get(upper);

    if (!pos || pos.amount <= 0) {
      return `❌ Portföyünüzde **${upper}** bulunmuyor.`;
    }

    const price = await fetchPrice(symbol);
    if (price === null) return `❌ **${upper}** fiyatı alınamadı.`;

    const maxUsd = pos.amount * price;
    const sellUsd = Math.min(usdAmount, maxUsd);
    const sellAmount = sellUsd / price;

    const pnlPerToken = price - pos.avgBuyPrice;
    const pnl = pnlPerToken * sellAmount;
    const pnlSign = pnl >= 0 ? "+" : "";
    const pnlEmoji = pnl >= 0 ? "📈" : "📉";

    pos.amount -= sellAmount;
    acc.cash += sellUsd;
    if (pos.amount < 0.000001) acc.positions.delete(upper);

    await saveAccount(acc);

    return [
      `✅ **Satış Gerçekleşti!**`,
      ``,
      `🪙 **${sellAmount.toFixed(6)} ${upper}** satıldı`,
      `💲 Fiyat: $${fmtPrice(price)}`,
      `💵 Kazanılan: $${fmt(sellUsd)}`,
      `${pnlEmoji} K/Z: **${pnlSign}$${fmt(pnl)}** (bu işlem)`,
      `💰 Yeni Nakit: **$${fmt(acc.cash)}**`,
    ].join("\n");
  }

  async getBalance(userId: string, username: string): Promise<string> {
    const acc = await loadAccount(userId, username);
    const symbols = [...acc.positions.keys()];
    const priceMap = await fetchPrices(symbols);

    let investedValue = 0;
    for (const pos of acc.positions.values()) {
      const price = priceMap.get(pos.symbol) ?? pos.avgBuyPrice;
      investedValue += price * pos.amount;
    }

    const total = acc.cash + investedValue;
    const profit = total - STARTING_BALANCE;
    const profitSign = profit >= 0 ? "+" : "";
    const profitEmoji = profit >= 0 ? "📈" : "📉";

    return [
      `💼 **${username} Demo Hesabı**`,
      ``,
      `💵 Nakit: **$${fmt(acc.cash)}**`,
      `📊 Yatırım Değeri: **$${fmt(investedValue)}**`,
      `💰 Toplam: **$${fmt(total)}**`,
      `${profitEmoji} Başlangıca Göre: **${profitSign}$${fmt(profit)}** (${profitSign}${((profit / STARTING_BALANCE) * 100).toFixed(2)}%)`,
      ``,
      `🔥 Gün Serisi: **${acc.dailyStreak} gün** — \`!günlük\` ile ödül al`,
    ].join("\n");
  }

  async getDemoPortfolio(userId: string, username: string): Promise<string> {
    const acc = await loadAccount(userId, username);

    if (acc.positions.size === 0) {
      return [
        `📭 **${username} Demo Portföyü boş.**`,
        ``,
        `\`!al BTC 100\` yazarak $100 ile BTC alabilirsiniz!`,
        `\`!günlük\` ile ücretsiz bonus alabilirsiniz.`,
      ].join("\n");
    }

    const symbols = [...acc.positions.keys()];
    const priceMap = await fetchPrices(symbols);

    let totalInvested = 0;
    let totalCurrent = 0;

    const lines = [...acc.positions.values()].map((pos) => {
      const currentPrice = priceMap.get(pos.symbol) ?? pos.avgBuyPrice;
      const currentValue = currentPrice * pos.amount;
      const costBasis = pos.avgBuyPrice * pos.amount;
      const pnl = currentValue - costBasis;
      const pnlPct = ((currentValue - costBasis) / costBasis) * 100;
      const pnlSign = pnl >= 0 ? "+" : "";
      const pnlEmoji = pnl >= 0 ? "📈" : "📉";

      totalInvested += costBasis;
      totalCurrent += currentValue;

      return [
        `${pnlEmoji} **${pos.symbol}** — ${pos.amount.toFixed(6)} adet`,
        `　 Ort. Maliyet: $${fmtPrice(pos.avgBuyPrice)} | Güncel: $${fmtPrice(currentPrice)}`,
        `　 Değer: $${fmt(currentValue)} | K/Z: **${pnlSign}$${fmt(pnl)}** (${pnlSign}${pnlPct.toFixed(2)}%)`,
      ].join("\n");
    });

    const totalPnl = totalCurrent - totalInvested;
    const totalPnlSign = totalPnl >= 0 ? "+" : "";

    return [
      `📊 **${username} Demo Portföyü**`,
      ``,
      ...lines,
      ``,
      `💰 Nakit: $${fmt(acc.cash)}`,
      `📦 Toplam Yatırım Değeri: $${fmt(totalCurrent)}`,
      `📈 Toplam K/Z: **${totalPnlSign}$${fmt(totalPnl)}** (${totalPnlSign}${totalInvested > 0 ? ((totalPnl / totalInvested) * 100).toFixed(2) : "0.00"}%)`,
    ].join("\n");
  }

  async getLeaderboard(): Promise<string> {
    const res = await pool.query(
      `SELECT a.user_id, a.username, a.cash,
              COALESCE(json_agg(
                json_build_object('symbol', p.symbol, 'amount', p.amount, 'avg_buy_price', p.avg_buy_price)
              ) FILTER (WHERE p.symbol IS NOT NULL), '[]') AS positions
       FROM game_accounts a
       LEFT JOIN game_positions p ON a.user_id = p.user_id
       GROUP BY a.user_id, a.username, a.cash`
    );

    if (res.rows.length === 0) {
      return "🏆 Henüz hiç oyuncu yok! `!günlük` ile başlayın.";
    }

    const symbols = new Set<string>();
    for (const row of res.rows) {
      for (const p of row.positions) symbols.add(p.symbol);
    }

    const priceMap = await fetchPrices([...symbols]);

    const ranked = res.rows
      .map((row) => {
        let invested = 0;
        for (const p of row.positions) {
          const price = priceMap.get(p.symbol) ?? parseFloat(p.avg_buy_price);
          invested += price * parseFloat(p.amount);
        }
        const total = parseFloat(row.cash) + invested;
        return { username: row.username, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const medals = ["🥇", "🥈", "🥉"];
    const lines = ranked.map((r, i) => {
      const medal = medals[i] ?? `${i + 1}.`;
      const profit = r.total - STARTING_BALANCE;
      const sign = profit >= 0 ? "+" : "";
      return `${medal} **${r.username}** — $${fmt(r.total)} (${sign}$${fmt(profit)})`;
    });

    return [`🏆 **Demo Trader Sıralaması**`, ``, ...lines].join("\n");
  }

  async resetAccount(userId: string, username: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE game_accounts SET cash = $1, last_daily_claim = NULL, daily_streak = 0 WHERE user_id = $2`,
        [STARTING_BALANCE, userId]
      );
      await client.query(`DELETE FROM game_positions WHERE user_id = $1`, [userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return `🔄 **Demo hesabınız sıfırlandı!**\n\nYeni bakiye: **$${fmt(STARTING_BALANCE)}**\nİyi işlemler! 🚀`;
  }
}
