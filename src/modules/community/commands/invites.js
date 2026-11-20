import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getInviteStats } from '../../../services/inviteHistory.js';
import { visibilityFlags } from '../../../utils/visibility.js';

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('View how many members you or another user invited')
  .addUserOption(option => option
    .setName('user')
    .setDescription('User to inspect (defaults to yourself)'));

export async function execute(interaction) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });
  const user = interaction.options.getUser('user') ?? interaction.user;
  const stats = getInviteStats(interaction.guildId, user.id);

  let activeLinks = null;
  try {
    const invites = await interaction.guild.invites.fetch();
    const mine = [...invites.values()].filter(invite => invite.inviter?.id === user.id);
    activeLinks = {
      count: mine.length,
      uses: mine.reduce((sum, invite) => sum + (Number(invite.uses) || 0), 0)
    };
  } catch (error) {
    console.warn('[invites] Could not fetch current invite links:', error.message);
  }

  const embed = new EmbedBuilder()
    .setColor(0x8070D9)
    .setAuthor({
      name: (user.globalName ?? user.username) + ' / Invite Statistics',
      iconURL: user.displayAvatarURL({ size: 256 })
    })
    .setTitle('Invite Tracking')
    .setDescription('<@' + user.id + '>\n-# Verified invite attribution, based on new member joins observed by Opus System.')
    .addFields(
      { name: 'Members Invited', value: '**' + stats.total + '**', inline: true },
      { name: 'Still in Server', value: '**' + stats.present + '**', inline: true },
      { name: 'Left Server', value: '**' + stats.left + '**', inline: true }
    )
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  if (activeLinks) {
    embed.addFields({
      name: 'Existing Invite Links',
      value: activeLinks.count + ' active link(s) · ' + activeLinks.uses + ' historical use(s) on those links',
      inline: false
    });
  }
  embed.addFields({
    name: 'Tracking Period',
    value: stats.since
      ? 'Since <t:' + Math.floor(stats.since / 1000) + ':F>\n-# Link uses recorded before tracking began are not treated as verified member invites.'
      : 'Tracking has not started yet.'
  });
  embed.setFooter({ text: 'Opus System · One unique member per inviter · Unattributed joins are excluded' });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
