import { DiscordGuildConfig, Settings } from "../settings";
import { System, SystemContext } from "./system";
import { AuditLogEvent, Client, GatewayIntentBits, Guild, GuildMember, PartialGuildMember } from "discord.js";
import { kickWithReason } from "./kickUtil";

type Mp = any; // TODO

const BAN_KICK_REASON = "You were banned from the Discord server.";

export const hasDiscordBanRole = (guildConfig: DiscordGuildConfig, roleIds: string[]): boolean =>
    !!guildConfig.banRoleId && roleIds.includes(guildConfig.banRoleId);

// Who banned or unbanned and why, from the guild's Discord audit log (needs View Audit Log, else found stays false)
export interface BanModerator { found: boolean; discordId?: string; name?: string; bot?: boolean; reason?: string }

// An audit-log entry older than this belongs to an earlier ban of the same member
const AUDIT_ENTRY_MAX_AGE_MS = 2 * 60 * 1000;

const touchesRole = (changes: unknown, roleId: string): boolean =>
    Array.isArray(changes) && changes.some((c: any) => (c?.key === "$add" || c?.key === "$remove") && Array.isArray(c.new) && c.new.some((r: any) => r?.id === roleId));

// The newest entry of this type on this member, read again after each wait because Discord can write it a moment late
export const findBanModerator = async (guild: Guild, type: AuditLogEvent, targetId: string, waitsMs: number[], roleId?: string): Promise<BanModerator> => {
    for (const wait of waitsMs) {
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        let entries: any[];
        try { entries = [...(await guild.fetchAuditLogs({ type, limit: 10 })).entries.values()]; } catch { return { found: false }; }
        const hit = entries.find(e => e?.targetId === targetId && Date.now() - Number(e.createdTimestamp) < AUDIT_ENTRY_MAX_AGE_MS && (!roleId || touchesRole(e.changes, roleId)));
        if (hit) return { found: true, discordId: hit.executorId || undefined, name: hit.executor?.username || undefined, bot: hit.executor?.bot === true, reason: hit.reason || undefined };
    }
    return { found: false };
};

// Discord ban role or guild ban: kick every connection of that Discord account (client closes the game) and disable its characters
export class DiscordBanSystem implements System {
    systemName = "DiscordBanSystem";

    // userId -> Discord id of the login, covers players still in character select
    private discordIdByUser = new Map<number, string>();

    // When the Discord audit log is read for a ban's moderator (ms after the event)
    auditWaitsMs = [0, 2000, 5000];

    disconnect(userId: number): void {
        this.discordIdByUser.delete(userId);
    }

    async initAsync(ctx: SystemContext): Promise<void> {
        ctx.gm.on("spawnAllowed", (userId: number, _profileId: number, _roles: string[], discordId?: string) => {
            if (discordId) this.discordIdByUser.set(userId, String(discordId));
            else this.discordIdByUser.delete(userId);
        });

        const settingsObject = await Settings.get();

        const discordAuth = settingsObject.discordAuth;

        if (settingsObject.offlineMode) {
            return console.log("discord ban system is disabled due to offline mode");
        }
        if (!discordAuth) {
            return console.warn("discordAuth is missing, skipping Discord ban system");
        }
        if (!discordAuth.botToken) {
            return console.warn("discordAuth.botToken is missing, skipping Discord ban system");
        }
        if (!discordAuth.guilds || discordAuth.guilds.length === 0) {
            return console.warn("discordAuth.guilds array is empty or missing, skipping Discord ban system");
        }

        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration] });

        client.on("error", (error) => {
            console.error(error);
        });

        client.on("warn", (message) => {
            console.warn(message);
        });

        const isBanned = (member: GuildMember | PartialGuildMember): boolean => {
            const guildConfig = discordAuth.guilds.find(g => g.guildId === member.guild.id);
            return !!guildConfig && hasDiscordBanRole(guildConfig, [...member.roles.cache.keys()]);
        };

        const banRoleOf = (member: GuildMember | PartialGuildMember): string =>
            discordAuth.guilds.find(g => g.guildId === member.guild.id)?.banRoleId || "";

        client.on("guildMemberUpdate", (oldMember, newMember) => {
            const was = !oldMember.partial && isBanned(oldMember);
            if (!isBanned(newMember)) {
                if (was) this.recordBan("unban", "ban role", newMember.guild, newMember.id, false, banRoleOf(newMember));
                return;
            }
            if (was) return;
            this.banDiscordAccount(ctx, newMember.id, `ban role on guild ${newMember.guild.id}`);
            // An uncached member may have had the role already: only a role change in the audit log makes it a new ban
            this.recordBan("ban", "ban role", newMember.guild, newMember.id, oldMember.partial, banRoleOf(newMember));
        });

        // An uncached member's first update arrives here instead of guildMemberUpdate
        client.on("guildMemberAvailable", (member) => {
            if (isBanned(member)) this.banDiscordAccount(ctx, member.id, `ban role on guild ${member.guild.id}`);
        });

        client.on("guildBanAdd", (ban) => {
            if (!discordAuth.guilds.some(g => g.guildId === ban.guild.id)) return;
            this.banDiscordAccount(ctx, ban.user.id, `guild ban on ${ban.guild.id}`);
            this.recordBan("ban", "guild ban", ban.guild, ban.user.id, false);
        });

        client.on("guildBanRemove", (ban) => {
            if (!discordAuth.guilds.some(g => g.guildId === ban.guild.id)) return;
            this.recordBan("unban", "guild ban", ban.guild, ban.user.id, false);
        });

        try {
            await client.login(discordAuth.botToken);
        } catch (e) {
            return console.error(`Error logging in Discord client: ${e}`);
        }
    }

    private banDiscordAccount(ctx: SystemContext, discordId: string, why: string): void {
        const mp = ctx.svr as unknown as Mp;

        const userIds = new Set<number>();
        this.discordIdByUser.forEach((id, userId) => { if (id === discordId) userIds.add(userId); });

        let actorIds: number[] = [];
        try { actorIds = mp.findFormsByPropertyValue("private.indexed.discordId", discordId) as number[]; } catch { }
        for (const actorId of actorIds) {
            const userId = ctx.svr.getUserByActor(actorId);
            if (userId >= 0 && userId < 0xffff && ctx.svr.getUserActor(userId) === actorId) userIds.add(userId);
        }

        console.log(`DiscordBanSystem: ${why} for ${discordId}, kicking users [${[...userIds].join(", ")}], disabling actors [${actorIds.map(a => a.toString(16)).join(", ")}]`);

        userIds.forEach(userId => {
            if (!ctx.svr.isConnected(userId)) return;
            // The player log's leave reason for the character being played: a session.kick, and the logout reads kicked
            const actorId = ctx.svr.getUserActor(userId);
            try { const h = (globalThis as any).__dboPlogHook; if (actorId && typeof h === "function") h("leave_reason", actorId, "discord_ban"); } catch { }
            try { kickWithReason(mp, userId, BAN_KICK_REASON); } catch { }
        });
        actorIds.forEach(actorId => {
            try { ctx.svr.setEnabled(actorId, false); } catch { }
        });
    }

    // Hands the gamemode (gamemode.js __dboDiscordBan) the ban or unban for its BAN audit line, which the player log reads
    private recordBan(op: "ban" | "unban", via: "guild ban" | "ban role", guild: Guild, discordId: string, needEntry: boolean, roleId?: string): void {
        const type = via === "ban role" ? AuditLogEvent.MemberRoleUpdate : op === "ban" ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove;
        findBanModerator(guild, type, discordId, this.auditWaitsMs, via === "ban role" ? roleId : undefined).then(mod => {
            if (needEntry && !mod.found) return;
            const hook = (globalThis as any).__dboDiscordBan;
            if (typeof hook !== "function") return console.warn(`DiscordBanSystem: no gamemode hook, the ${via} ${op} is not in the audit log`);
            hook({ op, via, discordId, by: mod.found ? { discordId: mod.discordId, name: mod.name, bot: mod.bot } : {}, reason: mod.reason || "" });
            console.log(`DiscordBanSystem: ${via} ${op} sent to the audit log (moderator ${mod.found ? "found" : "not found"} in the Discord audit log)`);
        }).catch(e => console.error(`DiscordBanSystem: ${via} ${op} audit failed: ${e}`));
    }
}
