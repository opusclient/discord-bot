import { visibilityFlags } from '../utils/visibility.js';
import { MessageFlags, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { createCase, getActiveCases, getCaseByNumber, setCaseStatus } from '../db.js';
import { logCase, sendBlacklistLog } from '../services/log.js';
import { removeMute } from '../services/mutes.js';
import { cancelCaseTimer } from '../services/scheduler.js';
import { executeHistory, TYPE_CHOICES } from '../services/historyCommand.js';
import { buildAuditEmbed, buildCaseEmbed, errorEmbed } from '../utils/embeds.js';
import { canModerateMember, ensureBotPermissions, ensureModerator } from '../utils/permissions.js';

const CLEAR_TYPES = ['warn', 'mute', 'ban', 'blacklisted'];

export const data = new SlashCommandBuilder()
  .setName('punishments')
  .setDescription('View punishment records and clear active cases')
  .addSubcommand(s => s.setName('view').setDescription('View all cases, including warnings and blacklist records')
    .addUserOption(o => o.setName('user').setDescription('User to inspect (omit for yourself)'))
    .addStringOption(o => o.setName('type').setDescription('Filter case type').addChoices(...TYPE_CHOICES)))
  .addSubcommand(s => s.setName('clear').setDescription('Clear one active case by its case number')
    .addIntegerOption(o => o.setName('caseid').setDescription('Guild case number').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('type').setDescription('Expected punishment type').addChoices(
      { name: 'Warning', value: 'warn' },
      { name: 'Mute', value: 'mute' },
      { name: 'Ban', value: 'ban' },
      { name: 'Blacklist', value: 'blacklisted' }
    ))
    .addStringOption(o => o.setName('reason').setDescription('Reason for clearing').setMaxLength(500)));

export async function execute(interaction, client) {
  if (interaction.options.getSubcommand() === 'view') {
    await executeHistory(interaction, client);
    return;
  }
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  if (!(await ensureModerator(interaction, PermissionsBitField.Flags.ManageGuild, 'Manage Server', { modRoleAllowed: false }))) return;

  const number = interaction.options.getInteger('caseid', true);
  const caseRow = getCaseByNumber(interaction.guildId, number);
  if (!caseRow || caseRow.hidden || !CLEAR_TYPES.includes(caseRow.type)) {
    await interaction.editReply({ embeds: [errorEmbed('No clearable case exists with that number.')] });
    return;
  }
  const expectedType = interaction.options.getString('type');
  if (expectedType && expectedType !== caseRow.type) {
    await interaction.editReply({ embeds: [errorEmbed('Case type mismatch: this case is ' + caseRow.type + '.')] });
    return;
  }
  if (caseRow.status !== 'active') {
    await interaction.editReply({ embeds: [errorEmbed('This case is not active.')] });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(caseRow.user_id).catch(() => null);
  if (targetMember && !(await canModerateMember(interaction, targetMember))) return;
  const reason = interaction.options.getString('reason') || 'Case #' + number + ' cleared by staff';
  const activeSameType = getActiveCases(interaction.guildId, caseRow.user_id, caseRow.type);
  if ((caseRow.type === 'mute' || caseRow.type === 'ban') && activeSameType.length !== 1) {
    await interaction.editReply({ embeds: [errorEmbed('Multiple active cases of this type exist. Resolve them individually before clearing enforcement.')] });
    return;
  }
  try {
    if (caseRow.type === 'mute') {
      if (!(await ensureBotPermissions(interaction, PermissionsBitField.Flags.ManageRoles, 'Manage Roles'))) return;
      const member = await interaction.guild.members.fetch(caseRow.user_id).catch(() => null);
      if (member && config.muteRoleId && member.roles.cache.has(config.muteRoleId)) {
        await member.roles.remove(config.muteRoleId, 'Clear Case #' + number + ' by ' + interaction.user.tag);
      }
      const done = await removeMute(interaction.guild, {
        userId: caseRow.user_id,
        member,
        moderatorId: interaction.user.id,
        reason,
        clientId: client.user.id
      });
      if (!done) throw new Error('Could not revoke the active mute.');
    } else if (caseRow.type === 'ban') {
      if (!(await ensureBotPermissions(interaction, PermissionsBitField.Flags.BanMembers, 'Ban Members'))) return;
      const existing = await interaction.guild.bans.fetch(caseRow.user_id).catch(() => null);
      if (existing) {
        await interaction.guild.bans.remove(caseRow.user_id, 'Clear Case #' + number + ' by ' + interaction.user.tag);
      }
      cancelCaseTimer(caseRow.id);
      setCaseStatus(caseRow.id, 'removed');
      const undo = createCase({
        guildId: interaction.guildId, userId: caseRow.user_id, moderatorId: interaction.user.id,
        type: 'unban', reason
      });
      await logCase(interaction.guild, undo, { clientId: client.user.id });
    } else {
      setCaseStatus(caseRow.id, 'removed');
      const note = createCase({
        guildId: interaction.guildId, userId: caseRow.user_id, moderatorId: interaction.user.id,
        type: 'note', reason: 'Cleared Case #' + number + ' (' + caseRow.type + '): ' + reason
      });
      if (caseRow.type === 'blacklisted') {
        await sendBlacklistLog(interaction.guild, buildAuditEmbed({
          title: 'Blacklist case cleared',
          description: 'Case #' + number + ' for <@' + caseRow.user_id + '> was cleared.\n' +
            '**Authorized by:** <@' + interaction.user.id + '>\n**Reason:** ' + reason
        }));
      } else {
        await logCase(interaction.guild, note, { clientId: client.user.id });
      }
    }
    await interaction.editReply({
      embeds: [buildCaseEmbed(getCaseByNumber(interaction.guildId, number), { clientId: client.user.id })]
    });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed('Could not clear Case #' + number + ': ' + error.message)] });
  }
}
