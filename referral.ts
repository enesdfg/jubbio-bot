interface InviteData {
  code: string;
  uses: number;
  inviter?: { id: string; username: string };
  guild_id?: string;
  channel_id?: string;
}

interface RestClient {
  getGuildInvites(guildId: string): Promise<InviteData[]>;
  createInvite(
    guildId: string,
    channelId: string,
    data?: { max_uses?: number; max_age?: number }
  ): Promise<InviteData>;
}

const REFERRAL_BONUS = 500;

export class ReferralManager {
  // guildId -> (inviteCode -> uses)
  private inviteCache: Map<string, Map<string, number>> = new Map();

  // userId -> inviteCode they created
  private userInviteCode: Map<string, string> = new Map();

  // inviteCode -> inviter userId
  private codeToInviter: Map<string, string> = new Map();

  // userId -> how many successful referrals they've made
  private referralCounts: Map<string, number> = new Map();

  async cacheGuildInvites(guildId: string, rest: RestClient): Promise<void> {
    try {
      const invites = await rest.getGuildInvites(guildId);
      const map = new Map<string, number>();
      for (const inv of invites) {
        map.set(inv.code, inv.uses ?? 0);
        if (inv.inviter?.id) {
          this.codeToInviter.set(inv.code, inv.inviter.id);
          // Track which code belongs to which user (first found wins)
          if (!this.userInviteCode.has(inv.inviter.id)) {
            this.userInviteCode.set(inv.inviter.id, inv.code);
          }
        }
      }
      this.inviteCache.set(guildId, map);
    } catch {
      // Silently ignore — bot may not have MANAGE_GUILD permission
    }
  }

  async detectReferrer(
    guildId: string,
    rest: RestClient
  ): Promise<string | null> {
    const cachedMap = this.inviteCache.get(guildId);
    if (!cachedMap) return null;

    try {
      const freshInvites = await rest.getGuildInvites(guildId);
      let referrerId: string | null = null;

      for (const inv of freshInvites) {
        const oldUses = cachedMap.get(inv.code) ?? 0;
        if ((inv.uses ?? 0) > oldUses) {
          referrerId = inv.inviter?.id ?? this.codeToInviter.get(inv.code) ?? null;
          // Update cache
          cachedMap.set(inv.code, inv.uses ?? 0);
          break;
        }
      }

      // Refresh full cache
      const newMap = new Map<string, number>();
      for (const inv of freshInvites) {
        newMap.set(inv.code, inv.uses ?? 0);
        if (inv.inviter?.id) {
          this.codeToInviter.set(inv.code, inv.inviter.id);
        }
      }
      this.inviteCache.set(guildId, newMap);

      return referrerId;
    } catch {
      return null;
    }
  }

  async getOrCreateInvite(
    userId: string,
    guildId: string,
    channelId: string,
    rest: RestClient
  ): Promise<string | null> {
    // If user already has a code, return it
    const existing = this.userInviteCode.get(userId);
    if (existing) return existing;

    try {
      const inv = await rest.createInvite(guildId, channelId, {
        max_uses: 0,
        max_age: 0,
      });
      this.userInviteCode.set(userId, inv.code);
      this.codeToInviter.set(inv.code, userId);
      // Add to cache
      const guildMap = this.inviteCache.get(guildId) ?? new Map();
      guildMap.set(inv.code, inv.uses ?? 0);
      this.inviteCache.set(guildId, guildMap);
      return inv.code;
    } catch {
      return null;
    }
  }

  getReferralBonus(): number {
    return REFERRAL_BONUS;
  }

  getInviteCount(userId: string): number {
    const code = this.userInviteCode.get(userId);
    if (!code) return 0;
    // Count across all guild caches: find uses of this user's code vs original 0
    // We track this separately
    return this.referralCounts.get(userId) ?? 0;
  }

  recordReferral(referrerId: string): void {
    this.referralCounts.set(referrerId, (this.referralCounts.get(referrerId) ?? 0) + 1);
  }
}
