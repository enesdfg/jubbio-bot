import { Client, GatewayIntentBits, type GuildMember } from "@jubbio/core";
import { fetchPrices, fetchDetailedPrices, fetchTopGainers, fetchTopLosers } from "./prices.js";
import { fetchMarketOverview, fetchFearGreed, fetchDolarRate } from "./market.js";
import { searchToken } from "./search.js";
import { AlertManager } from "./alerts.js";
import { PortfolioManager } from "./portfolio.js";
import { DailyReportScheduler } from "./scheduler.js";
import { getHelpText } from "./help.js";
import { GameManager } from "./game.js";
import { ReferralManager } from "./referral.js";

const botToken = process.env.JUBBIO_BOT_TOKEN;
if (!botToken) {
  console.error("JUBBIO_BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const alertManager = new AlertManager();
const portfolioManager = new PortfolioManager();
const scheduler = new DailyReportScheduler();
const gameManager = new GameManager();
const referralManager = new ReferralManager();

let welcomeChannelId: string | null = null;
let welcomeClient: Client | null = null;

function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildInvites,
    ],
  });

  client.on("ready", () => {
    console.log(`✅ Bot hazır: ${client.user?.username}`);
    alertManager.startChecking(client);
    welcomeClient = client;
    // Cache existing invites for all guilds
    for (const [guildId] of client.guilds) {
      referralManager.cacheGuildInvites(guildId, client.rest).catch(() => undefined);
    }
  });

  client.on("guildMemberAdd", async (member: GuildMember) => {
    const guildId: string | undefined = (member as unknown as { guild?: { id?: string }; guildId?: string }).guild?.id
      ?? (member as unknown as { guildId?: string }).guildId;

    // Detect which invite was used (must happen before cache refresh)
    const referrerId = guildId
      ? await referralManager.detectReferrer(guildId, client.rest)
      : null;

    if (!welcomeChannelId || !welcomeClient) return;
    try {
      const channel = welcomeClient.channels.get(welcomeChannelId);
      if (!channel || !("send" in channel)) return;

      const mention = member.toString();
      const name = member.user?.username ?? mention;
      const userId = member.user?.id ?? "";

      // Welcome bonus ($1000)
      const newBalance = await gameManager.giveWelcomeBonus(userId, name);

      const lines = [
        `🎉 **Finansın renkli dünyasına hoşgeldiniz, ${mention}!** 🎊`,
        ``,
        `👋 Merhaba **${name}**, aramıza katıldığına sevindik!`,
        ``,
        `🎁 Demo hesabına **$1.000 hoşgeldin bonusu** yatırıldı!`,
      ];

      // Referral bonus ($500 each)
      if (referrerId && referrerId !== userId) {
        const referrerAcc = await gameManager.giveReferralBonus(referrerId, userId, name);
        referralManager.recordReferral(referrerId);
        lines.push(`🤝 **Arkadaş daveti bonusu: +$500!** (sizi davet eden de $500 kazandı 🎊)`);
        lines.push(`💰 Toplam demo bakiyeniz: **$${(newBalance + 500).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**`);
        console.log(`Referral bonus: ${referrerAcc.referrerUsername} → ${name}`);
      } else {
        lines.push(`💰 Toplam demo bakiyeniz: **$${newBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**`);
      }

      lines.push(``, `📊 Kripto fiyatları için \`!fiyat\``, `🎮 Demo trading için \`!al BTC 500\``, `📋 Tüm komutlar için \`!yardım\``);

      await (channel as { send(content: string): Promise<unknown> }).send(lines.join("\n"));
    } catch (err) {
      console.error("Karşılama mesajı gönderilemedi:", err);
    }
  });

  client.on("messageCreate", async (message) => {
    if (message.author?.bot) return;

    const raw = message.content.trim();
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    try {
      if (cmd === "!yardım" || cmd === "!yardim" || cmd === "!help") {
        await message.reply(getHelpText());
        return;
      }

      if (cmd === "!fiyat") {
        await message.reply(await fetchPrices());
        return;
      }

      if (cmd === "!detay") {
        await message.reply(await fetchDetailedPrices());
        return;
      }

      if (cmd === "!yukselenler") {
        await message.reply(await fetchTopGainers());
        return;
      }

      if (cmd === "!dusenler") {
        await message.reply(await fetchTopLosers());
        return;
      }

      if (cmd === "!piyasa") {
        await message.reply(await fetchMarketOverview());
        return;
      }

      if (cmd === "!korku") {
        await message.reply(await fetchFearGreed());
        return;
      }

      if (cmd === "!dolar") {
        await message.reply(await fetchDolarRate());
        return;
      }

      if (cmd === "!ara") {
        const symbol = parts[1];
        if (!symbol) {
          await message.reply("Kullanım: `!ara <token>` — örn: `!ara SOL`");
          return;
        }
        await message.reply(await searchToken(symbol));
        return;
      }

      if (cmd === "!alarm") {
        const sub = parts[1]?.toLowerCase();

        if (sub === "listesi") {
          const list = alertManager.list(message.author.id);
          if (list.length === 0) {
            await message.reply("⚠️ Aktif alarmınız yok.\n\nÖrn: `!alarm BTC 100000`");
            return;
          }
          const lines = list.map((a) => {
            const dir = a.direction === "above" ? "≥" : "≤";
            return `• **${a.symbol}** ${dir} $${a.targetPrice.toLocaleString("en-US")}`;
          });
          await message.reply(`⚠️ **Aktif Alarmlarınız**\n\n${lines.join("\n")}`);
          return;
        }

        if (sub === "sil") {
          const symbol = parts[2];
          if (!symbol) {
            await message.reply("Kullanım: `!alarm sil <token>` — örn: `!alarm sil BTC`");
            return;
          }
          const removed = alertManager.remove(message.author.id, symbol);
          await message.reply(
            removed > 0
              ? `✅ **${symbol.toUpperCase()}** alarmı silindi.`
              : `❌ **${symbol.toUpperCase()}** için aktif alarm bulunamadı.`
          );
          return;
        }

        const symbol = parts[1]?.toUpperCase();
        const targetPrice = parseFloat(parts[2] ?? "");
        if (!symbol || isNaN(targetPrice)) {
          await message.reply(
            "Kullanım:\n`!alarm BTC 100000` — yükseliş alarmı\n`!alarm BTC 80000 altı` — düşüş alarmı"
          );
          return;
        }
        const direction = parts[3]?.toLowerCase() === "altı" ? "below" : "above";
        alertManager.add({
          userId: message.author.id,
          username: message.author.username,
          symbol,
          targetPrice,
          direction,
          channelId: message.channelId,
        });
        const dir = direction === "above" ? "üstüne çıktığında" : "altına düştüğünde";
        await message.reply(
          `✅ **${symbol}** $${targetPrice.toLocaleString("en-US")} ${dir} alarm verilecek!`
        );
        return;
      }

      if (cmd === "!portfoy" || cmd === "!portföy") {
        const sub = parts[1]?.toLowerCase();

        if (!sub) {
          await message.reply(await portfolioManager.buildReport(message.author.id, message.author.username));
          return;
        }

        if (sub === "ekle") {
          const symbol = parts[2]?.toUpperCase();
          const amount = parseFloat(parts[3] ?? "");
          if (!symbol || isNaN(amount) || amount <= 0) {
            await message.reply("Kullanım: `!portfoy ekle BTC 0.5`");
            return;
          }
          portfolioManager.add(message.author.id, symbol, amount);
          await message.reply(`✅ **${amount} ${symbol}** portföyünüze eklendi.`);
          return;
        }

        if (sub === "çıkar" || sub === "cikar") {
          const symbol = parts[2]?.toUpperCase();
          if (!symbol) {
            await message.reply("Kullanım: `!portfoy çıkar BTC`");
            return;
          }
          const removed = portfolioManager.remove(message.author.id, symbol);
          await message.reply(
            removed
              ? `✅ **${symbol}** portföyünüzden çıkarıldı.`
              : `❌ Portföyünüzde **${symbol}** bulunamadı.`
          );
          return;
        }

        if (sub === "sıfırla" || sub === "sifirla") {
          portfolioManager.reset(message.author.id);
          await message.reply("✅ Portföyünüz sıfırlandı.");
          return;
        }

        await message.reply("Geçersiz komut. `!yardım` yazarak tüm komutları görebilirsiniz.");
        return;
      }

      if (cmd === "!günlük" || cmd === "!gunluk") {
        await message.reply(gameManager.claimDaily(message.author.id, message.author.username));
        return;
      }

      if (cmd === "!bakiye") {
        await message.reply(await gameManager.getBalance(message.author.id, message.author.username));
        return;
      }

      if (cmd === "!al") {
        const symbol = parts[1];
        const usdAmount = parseFloat(parts[2] ?? "");
        if (!symbol || isNaN(usdAmount) || usdAmount <= 0) {
          await message.reply("Kullanım: `!al <token> <dolar>` — örn: `!al BTC 100`");
          return;
        }
        await message.reply(await gameManager.buy(message.author.id, message.author.username, symbol, usdAmount));
        return;
      }

      if (cmd === "!sat") {
        const symbol = parts[1];
        const usdAmount = parseFloat(parts[2] ?? "");
        if (!symbol || isNaN(usdAmount) || usdAmount <= 0) {
          await message.reply("Kullanım: `!sat <token> <dolar>` — örn: `!sat BTC 100`");
          return;
        }
        await message.reply(await gameManager.sell(message.author.id, message.author.username, symbol, usdAmount));
        return;
      }

      if (cmd === "!demo") {
        await message.reply(await gameManager.getDemoPortfolio(message.author.id, message.author.username));
        return;
      }

      if (cmd === "!sıralama" || cmd === "!siralama") {
        await message.reply(await gameManager.getLeaderboard());
        return;
      }

      if (cmd === "!demo-sifirla") {
        await message.reply(await gameManager.resetAccount(message.author.id, message.author.username));
        return;
      }

      if (cmd === "!davet") {
        const guildId = (message as unknown as { guildId?: string }).guildId;
        if (!guildId) {
          await message.reply("❌ Bu komut sadece sunucularda çalışır.");
          return;
        }
        const code = await referralManager.getOrCreateInvite(
          message.author.id,
          guildId,
          message.channelId,
          client.rest
        );
        if (!code) {
          await message.reply("❌ Davet linki oluşturulamadı. Botun `Davet Oluştur` yetkisi olduğundan emin olun.");
          return;
        }
        const inviteCount = referralManager.getInviteCount(message.author.id);
        await message.reply(
          [
            `🔗 **Kişisel Davet Linkin**`,
            ``,
            `\`https://jubbio.com/invite/${code}\``,
            ``,
            `🤝 Şimdiye kadar davet ettiğin kişi: **${inviteCount}**`,
            ``,
            `💰 Her başarılı davet → **sen +$500 + arkadaşın +$500** kazanır!`,
            `> Arkadaşın linki kullanarak sunucuya katılmalıdır.`,
          ].join("\n")
        );
        return;
      }

      if (cmd === "!hosgeldin-kur" || cmd === "!hoşgeldin-kur") {
        const sub = parts[1]?.toLowerCase();
        if (sub === "kapat") {
          welcomeChannelId = null;
          await message.reply("✅ Karşılama mesajları kapatıldı.");
          return;
        }
        welcomeChannelId = message.channelId;
        await message.reply(
          "✅ **Karşılama mesajları aktif!** Yeni üyeler bu kanala hoşgeldin mesajıyla karşılanacak.\n\nKapatmak için: `!hosgeldin-kur kapat`"
        );
        return;
      }

      if (cmd === "!rapor-kur") {
        const sub = parts[1]?.toLowerCase();
        if (sub === "kapat") {
          scheduler.disable();
          await message.reply("✅ Günlük rapor kapatıldı.");
          return;
        }
        scheduler.setChannel(message.channelId, client);
        await message.reply(
          "✅ **Günlük rapor aktif!** Her sabah 09:00'da (TSİ) bu kanala piyasa özeti gönderilecek.\n\nKapatmak için: `!rapor-kur kapat`"
        );
        return;
      }
    } catch (err) {
      console.error(`Komut hatası (${cmd}):`, err);
      await message.reply("Bir hata oluştu. Lütfen tekrar deneyin.").catch(() => undefined);
    }
  });

  client.on("error", (err: Error) => {
    console.error("Bot hatası:", err.message);
    console.log("60 saniye sonra yeniden bağlanılıyor...");
    setTimeout(() => createClient(), 60_000);
  });

  client.login(botToken!);
  return client;
}

process.on("uncaughtException", (err) => {
  console.error("Yakalanmamış hata:", err.message);
  console.log("60 saniye sonra yeniden başlatılıyor...");
  setTimeout(() => createClient(), 60_000);
});

process.on("unhandledRejection", (reason) => {
  console.error("Yakalanmamış promise reddi:", reason);
});

createClient();
