import { visibilityFlags } from './visibility.js';
import { MessageFlags, PermissionsBitField } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember, Guild, Role, Message, PermissionResolvable, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { errorEmbed } from './embeds.js';

// ---------- Interaction helpers ----------

export async function replyEphemeral(interaction: ChatInputCommandInteraction<'cached'>, embed: EmbedBuilder): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({ embeds: [embed], flags: visibilityFlags(interaction) });
  } else {
    await interaction.reply({ embeds: [embed], flags: visibilityFlags(interaction) });
  }
}

export function isConfiguredGuild(guildId: string | null): boolean {
  return guildId === config.guildId;
}

export function isAdministrator(member: GuildMember | null | undefined): boolean {
  return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
}

export function isModRole(member: GuildMember | null | undefined): boolean {
  const roles = [config.modRoleId, ...(config.moderatorRoleIds ?? [])].filter(Boolean);
  return Boolean(member?.roles?.cache && roles.some(id => member.roles.cache.has(id)));
}

export function isSeniorModerator(member: GuildMember | null | undefined): boolean {
  const roles = config.seniorModeratorRoleIds ?? [];
  return Boolean(member?.roles?.cache && roles.some(id => member.roles.cache.has(id)));
}

export function isBotController(member: GuildMember | null | undefined): boolean {
  const ids = config.botControlRoleIds ?? [];
  const roles = member?.roles as GuildMember['roles'] | string[] | undefined;
  return ids.some(id => Array.isArray(roles) ? roles.includes(id) : Boolean(roles?.cache.has(id)));
}

export async function ensureBotController(interaction: ChatInputCommandInteraction<'cached'>): Promise<boolean> {
  if (isConfiguredGuild(interaction.guildId) &&
      (isBotController(interaction.member) || interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild))) {
    return true;
  }
  await replyEphemeral(interaction, errorEmbed('You need the Discord Developer bot-control role or the existing Manage Server authorization.'));
  return false;
}

export function isModerator(member: GuildMember | null | undefined): boolean {
  return isAdministrator(member) || isModRole(member);
}

// Self-serve lookups (history, warnings list): members holding the
// configured Member role may look up their own moderation record without any
// moderator permission. When no member role is configured, any server member
// may self-view. Moderators always pass.
export function canSelfView(member: GuildMember | null | undefined): boolean {
  if (!member) return false;
  if (isModerator(member)) return true;
  if (config.verifiedRoleId) return member.roles.cache.has(config.verifiedRoleId);
  return true;
}

export const selfViewDeniedText = () =>
  config.verifiedRoleId
    ? `Members can look up only their own moderation record - it needs the <@&${config.verifiedRoleId}> role or a moderator.`
    : 'Members can look up only their own moderation record.';

// Commands can opt out of the moderator-role bypass (modRoleAllowed: false)
// to require the actual Discord permission.
export function hasModPermission(member: GuildMember | null | undefined, permissionFlag: PermissionResolvable, { modRoleAllowed = true }: { modRoleAllowed?: boolean } = {}): boolean {
  if (!member) return false;
  if (member.permissions.has(permissionFlag)) return true;
  if (isAdministrator(member)) return true;
  return isSeniorModerator(member) || (modRoleAllowed && isModRole(member));
}

function deniedMessage(permissionLabel: string, modRoleAllowed: boolean): string {
  const base = `You need the **${permissionLabel}** permission`;
  return modRoleAllowed
    ? `${base} (or the configured moderator role) to use this command.`
    : `${base} to use this command - the moderator role is not sufficient.`;
}

// Returns false (and replies with an error) when the caller is not allowed.
export async function ensureModerator(interaction: ChatInputCommandInteraction<'cached'>, permissionFlag: PermissionResolvable, permissionLabel: string, { modRoleAllowed = true }: { modRoleAllowed?: boolean } = {}): Promise<boolean> {
  if (isConfiguredGuild(interaction.guildId) && hasModPermission(interaction.member, permissionFlag, { modRoleAllowed })) {
    return true;
  }
  await replyEphemeral(interaction, errorEmbed(deniedMessage(permissionLabel, modRoleAllowed)));
  return false;
}

export async function ensureBotPermissions(interaction: ChatInputCommandInteraction<'cached'>, permissionFlag: PermissionResolvable, permissionLabel: string): Promise<boolean> {
  const me = interaction.guild.members.me;
  if (me?.permissions.has(permissionFlag)) return true;
  await replyEphemeral(interaction, errorEmbed(`The bot is missing the **${permissionLabel}** permission.`));
  return false;
}

export async function canModerateMember(interaction: ChatInputCommandInteraction<'cached'>, targetMember: GuildMember): Promise<boolean> {
  const me = interaction.guild.members.me;
  const deny = async (text: string): Promise<boolean> => {
    await replyEphemeral(interaction, errorEmbed(text));
    return false;
  };

  if (targetMember.id === interaction.user.id) {
    return deny('You cannot moderate yourself.');
  }
  if (!me) return deny('The bot member is unavailable.');
  if (targetMember.id === me.id) return deny('The bot cannot moderate itself.');
  if (targetMember.id === interaction.guild.ownerId) {
    return deny('You cannot moderate the server owner.');
  }
  if (targetMember.roles.highest.position >= me.roles.highest.position) {
    return deny("That member's highest role is equal to or above the bot's highest role.");
  }
  if (interaction.user.id !== interaction.guild.ownerId &&
      targetMember.roles.highest.position >= interaction.member.roles.highest.position) {
    return deny('You cannot moderate a member at or above your own role hierarchy.');
  }
  return true;
}

// ---------- Message (prefix command) helpers ----------

export function ensureModeratorMessage(message: Message<true>, permissionFlag: PermissionResolvable, permissionLabel: string, { modRoleAllowed = true }: { modRoleAllowed?: boolean } = {}): boolean {
  if (hasModPermission(message.member, permissionFlag, { modRoleAllowed })) return true;
  message.reply({ embeds: [errorEmbed(deniedMessage(permissionLabel, modRoleAllowed))] });
  return false;
}

// Resolves a role from a mention (<@&id>) or a raw role id. Returns Role | null.
export async function resolveRole(guild: Guild, input: unknown): Promise<Role | null> {
  const text = String(input ?? '').trim();
  const match = text.match(/^<@&(\d{17,20})>$/) ?? (/^\d{17,20}$/.test(text) ? [null, text] : null);
  if (!match) return null;
  return (await guild.roles.fetch(match[1]).catch(() => null)) ?? null;
}

// Shared role-assignment guard for the addrole / removerole commands (and the
// self-role / ticket-role managers): the role must exist, be assignable by the bot and
// not be @everyone. Returns an error string or null when the role is fine.
export function roleAssignabilityError(guild: Guild, role: Role | null | undefined): string | null {
  if (!role) return 'That role does not exist. Mention it (`<@&role>`) or provide a role ID.';
  if (role.id === guild.roles.everyone.id) return 'That is the @everyone role - pick a specific role.';
  if (role.managed) return `The **${role.name}** role is managed by an integration and cannot be assigned.`;
  const me = guild.members.me;
  if (me?.permissions.has(PermissionsBitField.Flags.Administrator)) return null;
  if (me && role.position >= me.roles.highest.position) {
    return `The **${role.name}** role is at or above my highest role - I cannot assign it.`;
  }
  return null;
}

export function canModerateMemberMessage(message: Message<true>, targetMember: GuildMember): boolean {
  const me = message.guild.members.me;
  const deny = (text: string): boolean => {
    message.reply({ embeds: [errorEmbed(text)] });
    return false;
  };

  if (targetMember.id === message.author.id) {
    return deny('You cannot moderate yourself.');
  }
  if (!me) return deny('The bot member is unavailable.');
  if (targetMember.id === me.id) return deny('The bot cannot moderate itself.');
  if (targetMember.id === message.guild.ownerId) {
    return deny('You cannot moderate the server owner.');
  }
  if (targetMember.roles.highest.position >= me.roles.highest.position) {
    return deny("That member's highest role is equal to or above the bot's highest role.");
  }
  return true;
}
