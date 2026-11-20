import { SlashCommandBuilder } from 'discord.js';
import { getTeamRoleHistory } from '../../../services/teamRoleHistory.js';
import { getInviteStats } from '../../../services/inviteHistory.js';
import { buildMemberProfile } from '../../../services/memberProfile.js';
import { isModerator } from '../../../utils/permissions.js';
import { visibilityFlags } from '../../../utils/visibility.js';
import { errorEmbed } from '../../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('info')
  .setDescription('View a server member profile, positions and recorded role history')
  .addUserOption(option => option
    .setName('user')
    .setDescription('Member to look up (defaults to yourself)')
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  const target = interaction.options.getUser('user') ?? interaction.user;
  const member = await interaction.guild.members.fetch({ user: target.id, force: true })
    .catch(() => null);
  if (!member) {
    await interaction.editReply({
      embeds: [errorEmbed('This user is not currently a member of Opus Client.')]
    });
    return;
  }
  const history = getTeamRoleHistory(interaction.guildId, target.id, 5);
  const invites = getInviteStats(interaction.guildId, target.id);
  const showReasons = visibilityFlags(interaction) !== 0 && isModerator(interaction.member);
  await interaction.editReply({
    embeds: [buildMemberProfile({
      guild: interaction.guild,
      member,
      history,
      invites,
      showReasons
    })],
    allowedMentions: { parse: [] }
  });
}
