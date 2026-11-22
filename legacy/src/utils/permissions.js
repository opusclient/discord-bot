import { visibilityFlags } from './visibility.js';
import { MessageFlags, PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { errorEmbed } from './embeds.js';

// ---------- Interaction helpers ----------

export async function replyEphemeral(interaction, embed) {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({ embeds: [embed], flags: visibilityFlags(interaction) });
  } else {
    await interaction.reply({ embeds: [embed], flags: visibilityFlags(interaction) });
  }
}

export function isConfiguredGuild(guildId) {
  return guildId === config.guildId;
}

export function isAdministrator(member) {
  return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator));
}

export function isModRole(member) {
  const roles = [config.modRoleId, ...(config.moderatorRoleIds ?? [])].filter(Boolean);
  return Boolean(member?.roles?.cache && roles.some(id => member.roles.cache.has(id)));
}

export function isSeniorModerator(member) {
  const roles = config.seniorModeratorRoleIds ?? [];
  return Boolean(member?.roles?.cache && roles.some(id => member.roles.cache.has(id)));
}

export function isBotController(member) {
  const ids = config.botControlRoleIds ?? [];
  const roles = member?.roles;
  return ids.some(id => roles?.cache?.has?.(id) || (Array.isArray(roles) && roles.includes(id)));
}

export async function ensureBotController(interaction) {
  if (isConfiguredGuild(interaction.guildId) &&
      (isBotController(interaction.member) || interaction.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild))) {
    return true;
  }
  await replyEphemeral(interaction, errorEmbed('You need the Discord Developer bot-control role or the existing Manage Server authorization.'));
  return false;
}

export function isModerator(member) {
  return isAdministrator(member) || isModRole(member);
}

// Self-serve lookups (history, warnings list): members holding the
// configured Member role may look up their own moderation record without any
// moderator permission. When no member role is configured, any server member
// may self-view. Moderators always pass.
export function canSelfView(member) {
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
export function hasModPermission(member, permissionFlag, { modRoleAllowed = true } = {}) {
  if (member.permissions.has(permissionFlag)) return true;
  if (isAdministrator(member)) return true;
  return isSeniorModerator(member) || (modRoleAllowed && isModRole(member));
}

function deniedMessage(permissionLabel, modRoleAllowed) {
  const base = `You need the **${permissionLabel}** permission`;
  return modRoleAllowed
    ? `${base} (or the configured moderator role) to use this command.`
    : `${base} to use this command - the moderator role is not sufficient.`;
}

// Returns false (and replies with an error) when the caller is not allowed.
export async function ensureModerator(interaction, permissionFlag, permissionLabel, { modRoleAllowed = true } = {}) {
  if (isConfiguredGuild(interaction.guildId) && hasModPermission(interaction.member, permissionFlag, { modRoleAllowed })) {
    return true;
  }
  await replyEphemeral(interaction, errorEmbed(deniedMessage(permissionLabel, modRoleAllowed)));
  return false;
}

export async function ensureBotPermissions(interaction, permissionFlag, permissionLabel) {
  const me = interaction.guild.members.me;
  if (me.permissions.has(permissionFlag)) return true;
  await replyEphemeral(interaction, errorEmbed(`The bot is missing the **${permissionLabel}** permission.`));
  return false;
}

export async function canModerateMember(interaction, targetMember) {
  const me = interaction.guild.members.me;
  const deny = async (text) => {
    await replyEphemeral(interaction, errorEmbed(text));
    return false;
  };

  if (targetMember.id === interaction.user.id) {
    return deny('You cannot moderate yourself.');
  }
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

export function ensureModeratorMessage(message, permissionFlag, permissionLabel, { modRoleAllowed = true } = {}) {
  if (hasModPermission(message.member, permissionFlag, { modRoleAllowed })) return true;
  message.reply({ embeds: [errorEmbed(deniedMessage(permissionLabel, modRoleAllowed))] });
  return false;
}

// Resolves a role from a mention (<@&id>) or a raw role id. Returns Role | null.
export async function resolveRole(guild, input) {
  const text = String(input ?? '').trim();
  const match = text.match(/^<@&(\d{17,20})>$/) ?? (/^\d{17,20}$/.test(text) ? [null, text] : null);
  if (!match) return null;
  return (await guild.roles.fetch(match[1]).catch(() => null)) ?? null;
}

// Shared role-assignment guard for the addrole / removerole commands (and the
// self-role / ticket-role managers): the role must exist, be assignable by the bot and
// not be @everyone. Returns an error string or null when the role is fine.
export function roleAssignabilityError(guild, role) {
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

export function canModerateMemberMessage(message, targetMember) {
  const me = message.guild.members.me;
  const deny = (text) => {
    message.reply({ embeds: [errorEmbed(text)] });
    return false;
  };

  if (targetMember.id === message.author.id) {
    return deny('You cannot moderate yourself.');
  }
  if (targetMember.id === me.id) return deny('The bot cannot moderate itself.');
  if (targetMember.id === message.guild.ownerId) {
    return deny('You cannot moderate the server owner.');
  }
  if (targetMember.roles.highest.position >= me.roles.highest.position) {
    return deny("That member's highest role is equal to or above the bot's highest role.");
  }
  return true;
}
