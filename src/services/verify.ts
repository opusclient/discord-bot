// Verification: the verify channel is the only channel unverified members can see.
// The bot keeps a Verification embed + button there; pressing the button grants the
// Member (verified) role, which carries the unlock allows on every other channel.
// In gate mode (config.verify.gate) /install denies @everyone ViewChannel on all
// other channels/categories, so nobody can view anything until they are verified.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, MessageFlags, PermissionsBitField, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import type { Guild, GuildChannel, Client, GuildMember, Role, ButtonInteraction, ChatInputCommandInteraction, OverwriteResolvable } from 'discord.js';

import { config, updateFileConfig } from '../config.js';
import { COLORS } from '../constants.js';
import { getInstallMessage, listTicketChannelIds, listVoiceChannelIds, setInstallMessage } from '../db.js';
import { baseEmbed } from '../utils/embeds.js';
import { completeVerification } from './accountRoles.js';

export const VERIFY_MESSAGE_KEY = 'verify';
export const VERIFY_BUTTON_ID = 'verify_button';

// Verification is enabled once a verify channel is configured (or created by /install).
export const isVerifyEnabled = () => Boolean(config.verify?.enabled === true && config.verify?.channelId);

export const isGateEnabled = () => !config.serverManagedByOpusManager && isVerifyEnabled() && config.verify?.gate === true;

// The gate never touches these channels: the verify channel itself stays open to
// @everyone (it must be the only thing unverified members can see), the do-not-type
// channel stays open so the trap keeps catching bots, and the muted-commands channel
// keeps its own locked-down overwrites.
function gateExcludedIds() {
  return new Set(
    [config.verify?.channelId, config.doNotType?.channelId, config.mutedBotCmdsChannelId].filter(Boolean),
  );
}

// ---------- Verify channel + message ----------

// Finds or creates the verify channel (config.verify.channelId takes priority; the
// found/created channel id is persisted back, like the auto-created roles).
export async function ensureVerifyChannel(guild: Guild, { reason = 'Verify channel setup' }: { reason?: string } = {}) {
  const name = String(config.verify?.channelName || 'verify');
  let channel = config.verify?.channelId
    ? await guild.channels.fetch(config.verify.channelId).catch(() => null)
    : null;
  if (!channel) {
    const pool = (await guild.channels.fetch().catch(() => null)) ?? guild.channels.cache;
    channel = [...pool.values()].find((c) => c?.isTextBased() && c.name.toLowerCase() === name.toLowerCase()) ?? null;
  }
  if (!channel && config.serverManagedByOpusManager) throw new Error('Verify channel must be configured by Opus Manager');
  if (!channel) {
    channel = await guild.channels.create({ name, type: ChannelType.GuildText, reason });
    console.log(`[verify] Created the "#${channel.name}" channel (${channel.id}).`);
  }
  if (config.verify?.channelId !== channel.id) {
    updateFileConfig({ verify: { channelId: channel.id } });
    console.log(`[verify] Saved verify.channelId=${channel.id} to config.json.`);
  }
  // The verify channel must stay open to @everyone (sending is denied - the button is the gate).
  if (!config.serverManagedByOpusManager && 'permissionOverwrites' in channel) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true, SendMessages: false }, { reason });
  }
  return channel;
}

export function buildVerifyPayload(guild: Guild): { components: ContainerBuilder[]; flags: MessageFlags.IsComponentsV2 } {
  const iconUrl = guild.iconURL({ size: 256 });
  const rulesChannel = guild.channels.cache.find(channel => channel.name === 'rules');
  const rulesLink = rulesChannel ? '<#' + rulesChannel.id + '>' : 'the server rules';
  const title = '## Welcome to Opus Client\nComplete your verification to unlock member-only channels.';
  const details = '**GET STARTED**\n' +
    '1. Review ' + rulesLink + '.\n' +
    '2. Press the button below to verify.\n' +
    '3. Access community discussions, support and bug reports.';
  const footer = '-# By verifying, you agree to follow the server rules. Your account will receive Verified and Unlinked roles.';

  const container = new ContainerBuilder().setAccentColor(0x5865f2);
  if (iconUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  }
  container
    .addSeparatorComponents(separator => separator)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(details),
      new TextDisplayBuilder().setContent(footer),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(VERIFY_BUTTON_ID)
          .setLabel('Verify & Continue')
          .setStyle(ButtonStyle.Primary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// Edits the stored Verification message, or posts a new one when missing. Safe to call often.
export async function refreshVerifyMessage(client: Client) {
  const channelId = config.verify?.channelId;
  if (!isVerifyEnabled() || !channelId) return null;

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[verify] verify channel ${channelId} not found or not text-based.`);
    return null;
  }

  const payload = buildVerifyPayload(guild);
  const stored = getInstallMessage(guild.id, VERIFY_MESSAGE_KEY);

  if (stored?.message_id) {
    const message = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (message && message.author.id === client.user?.id) {
      if (message.flags.has(MessageFlags.IsComponentsV2)) {
        try {
          await message.edit(payload);
          return message;
        } catch (error) {
          console.error('[verify] Could not update the existing verification panel:', (error instanceof Error ? error.message : String(error)));
          return null;
        }
      }
      const updated = await channel.send(payload);
      setInstallMessage(guild.id, VERIFY_MESSAGE_KEY, channel.id, updated.id);
      await message.delete().catch(error => console.error('[verify] Could not remove the previous verification panel:', (error instanceof Error ? error.message : String(error))));
      return updated;
    }
  }

  const sent = await channel.send(payload);
  setInstallMessage(guild.id, VERIFY_MESSAGE_KEY, channel.id, sent.id);
  return sent;
}

function buildVerificationRequiredEmbed(guild: Guild, userId: string, { inDm = false }: { inDm?: boolean } = {}) {
  return baseEmbed(COLORS.warn)
    .setTitle('Verification required')
    .setDescription(
      [
        `Welcome to **${guild.name}**, <@${userId}>.`,
        isGateEnabled() ? 'You cannot see any other channel yet.' : 'Verification is available for your account.',
        inDm
          ? (isGateEnabled() ? 'Press **Verify** below to unlock the server.' : 'Press **Verify** below to complete verification.')
          : (isGateEnabled() ? 'Press **Verify** in the verification channel to unlock the server.' : 'Press **Verify** in the verification channel to complete verification.'),
      ].join('\n'),
    )
    .setFooter({ text: guild.name });
}

export async function sendVerifyNotification(member: GuildMember) {
  if (!isVerifyEnabled() || member.user?.bot) return { sent: false, pinged: false };
  if (config.verifiedRoleId && member.roles.cache.has(config.verifiedRoleId)) {
    return { sent: false, pinged: false };
  }

  let pinged = false;
  const channel = await member.guild.channels.fetch(config.verify.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    try {
      const message = await channel.send({
        content: `<@${member.id}>`,
        allowedMentions: { users: [member.id], roles: [], parse: [] }
      });
      pinged = true;
      try {
        await message.delete();
      } catch (error) {
        console.error('[verify] Could not immediately delete verification mention:', (error instanceof Error ? error.message : String(error)));
      }
    } catch (error) {
      console.error('[verify] Could not send verification mention:', (error instanceof Error ? error.message : String(error)));
    }
  }

  try {
    await member.send({
      embeds: [buildVerificationRequiredEmbed(member.guild, member.id, { inDm: true })],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel('Verify & Continue').setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return { sent: true, pinged };
  } catch (error) {
    console.error('[verify] Could not DM verification reminder:', member.id, (error instanceof Error ? error.message : String(error)));
    return { sent: false, pinged };
  }
}

// Deletes a member's fallback ping from the verify channel after they verify, so the
// channel keeps only the static Verification panel. Scans recent messages for ones
// mentioning the (now verified) member; the panel message itself is never touched.
export async function sweepVerifyPings(member: GuildMember): Promise<number> {
  if (!isVerifyEnabled()) return 0;
  const channel = await member.guild.channels.fetch(config.verify.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return 0;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return 0;

  const panelId = getInstallMessage(member.guild.id, VERIFY_MESSAGE_KEY)?.message_id ?? null;
  let deleted = 0;
  for (const message of messages.values()) {
    // Only the bot's own fallback pings are removed; staff messages mentioning the
    // member (help delivery etc.) and the panel are left alone.
    if (message.author?.id !== member.client.user?.id) continue;
    if (message.id === panelId) continue;
    if (!message.mentions?.users?.has?.(member.id)) continue;
    await message.delete().catch(() => {});
    deleted += 1;
  }
  if (deleted) console.log(`[verify] Removed ${deleted} fallback ping(s) for ${member.id}.`);
  return deleted;
}

// ---------- The Verify button ----------

// Grants the Member (verified) role. Works for presses in the verify channel and for
// the Verify button inside the DM card: in the DM there is no guild/member on the
// interaction, so membership is resolved against the configured guild. No overwrite
// changes are needed - the role already carries the allows that unlock the gate.
export async function verifyMember(interaction: ButtonInteraction | ChatInputCommandInteraction) {
  if (!isVerifyEnabled()) return { error: 'Verification is not configured yet.' };
  let guild = interaction.guild;
  let member = interaction.member as GuildMember | null;
  if (!guild || !member) {
    guild = interaction.client.guilds.cache.get(config.guildId) ?? null;
    member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  }
  if (!guild) return { error: 'Configured Discord server is unavailable.' };
  if (!member) return { error: 'You are no longer a member of the server.' };
  try {
    return await completeVerification(member);
  } catch (error) {
    console.error('[verify] Verification role update failed:', (error instanceof Error ? error.message : String(error)));
    return { error: 'Could not complete verification. Please contact support.' };
  }
}

// ---------- Gate ----------

// The @everyone half of the gate: lose view (and connect on voice channels - hidden
// channels cannot be joined, so the connect deny just makes the lock explicit).
export function gateEveryoneOptions(channel: GuildChannel): { ViewChannel: false; Connect?: false } {
  if (channel.isVoiceBased()) return { ViewChannel: false, Connect: false };
  return { ViewChannel: false };
}

// The verified half: view everywhere (plus connect, so verified members keep joining).
export function gateMemberOptions(channel: GuildChannel): { ViewChannel: true; Connect?: true } {
  if (channel.isVoiceBased()) return { ViewChannel: true, Connect: true };
  return { ViewChannel: true };
}

// Roles that keep explicit allows everywhere the gate locks content: the verified
// (Member) role, the mod role and the Bots role (so bot accounts are never locked out).
export async function gateAllowRoles(guild: Guild, memberRole: Role | null = null): Promise<Role[]> {
  const roles: Role[] = [];
  for (const id of [memberRole?.id, config.verifiedRoleId, config.modRoleId, config.botsRoleId].filter((id): id is string => Boolean(id))) {
    if (roles.some((r) => r.id === id)) continue;
    const role =
      memberRole?.id === id ? memberRole : (guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null)));
    if (role) roles.push(role);
  }
  return roles;
}

// Applies the gate to every existing channel (categories included, so synced channels
// keep inheriting the lock). Returns ok/failed counts.
export async function applyVerifyGate(guild: Guild, memberRole: Role | null, reason: string = 'Apply the verification gate') {
  const allowRoles = await gateAllowRoles(guild, memberRole);
  if (!allowRoles.length) return { ok: 0, failed: 0, skipped: true };

  const excluded = gateExcludedIds();
  let ok = 0;
  let failed = 0;
  for (const channel of guild.channels.cache.values()) {
    // Channels that already hold an @everyone overwrite manage their own visibility
    // (ticket channels, private voice rooms, the sealed muted-commands channel) - the
    // gate must never add a Member allow that would leak them to verified members.
    if (excluded.has(channel.id) || !('permissionOverwrites' in channel) || channel.permissionOverwrites.cache.has(guild.roles.everyone.id)) continue;
    try {
      await applyGateOverwrite(channel, allowRoles, reason);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}

// Overwrites a single channel: @everyone loses view, the verified (Member) role plus
// the mod and Bots roles keep explicit allows so staff and bot accounts are never
// locked out with the rest.
export async function applyGateOverwrite(channel: GuildChannel, allowRoles: Role[], reason: string = 'Apply the verification gate') {
  const guild = channel.guild;
  await channel.permissionOverwrites.edit(guild.roles.everyone, gateEveryoneOptions(channel), { reason });
  for (const role of allowRoles) {
    await channel.permissionOverwrites.edit(role, gateMemberOptions(channel), { reason });
  }
  return channel;
}

// Called when a channel is created: applies the gate so it starts locked too.
// Channels that manage their own visibility (tickets are created with an @everyone
// overwrite) and the always-open channels are left alone.
export async function applyGateOverwriteForNewChannel(channel: GuildChannel) {
  if (!isGateEnabled() || gateExcludedIds().has(channel.id)) return null;
  if (channel.permissionOverwrites.cache.has(channel.guild.roles.everyone.id)) return null;

  const allowRoles = await gateAllowRoles(channel.guild);
  if (!allowRoles.length) return null;
  return applyGateOverwrite(channel, allowRoles, 'Apply the verification gate to the new channel');
}

// Lifts the gate (config.verify.gate set to false): clears the ViewChannel (and voice
// Connect) bits from the @everyone overwrites so the server reopens. The always-open
// channels (verify + trap), the muted-commands seal, ticket channels and spawned voice
// rooms manage their own @everyone overwrites and are left untouched. Re-run via /install.
export async function liftVerifyGate(guild: Guild, reason: string = 'Lift the verification gate') {
  const skip = new Set(
    [
      ...gateExcludedIds(),
      ...listTicketChannelIds(guild.id),
      ...listVoiceChannelIds(guild.id),
    ].filter(Boolean),
  );
  let ok = 0;
  let failed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (skip.has(channel.id) || !('permissionOverwrites' in channel)) continue;
    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        channel.isVoiceBased() ? { ViewChannel: null, Connect: null } : { ViewChannel: null },
        { reason },
      );
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok, failed };
}
