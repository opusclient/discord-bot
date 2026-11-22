import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { visibilityFlags } from '../utils/visibility.js';
import { config } from '../config.js';
import { addTicketStaffRole, ticketStaffRoleIds, logTicketActivity } from '../services/tickets.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { ensureBotController, roleAssignabilityError } from '../utils/permissions.js';

export async function execute(interaction: ChatInputCommandInteraction<'cached'>) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });

  if (!(await ensureBotController(interaction))) return;

  const role = interaction.options.getRole('role', true);

  const roleError = roleAssignabilityError(interaction.guild, role);
  if (roleError) return interaction.editReply({ embeds: [errorEmbed(roleError)] });

  const result = await addTicketStaffRole(
    interaction.guild,
    role,
    `Ticket staff role added by ${interaction.user.tag}`,
  ).catch((err) => {
    console.error('[ticket:permanent-add] Failed:', err.message);
    return { error: `Could not update the ticket staff roles: ${err.message}` };
  });
  if (result?.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

  if (!('stats' in result) || !result.stats) return interaction.editReply({ embeds: [errorEmbed('Ticket staff update did not return results.')] });
  const staff = ticketStaffRoleIds();
  const lines = [
    `<@&${role.id}> can now view and manage every **open and future** ticket.`,
    `Ticket staff roles: ${staff.map((id) => `<@&${id}>`).join(', ') || '(none)'}` +
      (config.modRoleId ? ` + <@&${config.modRoleId}> (mod)` : ''),
    result.stats.ok
      ? `Access re-applied to **${result.stats.ok}** open ticket(s)${result.stats.failed ? `, **${result.stats.failed}** failed` : ''}.`
      : 'No open tickets to update - new tickets get the allow when they are created.',
    `Remove permanent access with \`/ticket remove role:@Role scope:All tickets\`. Temporary access uses \`scope:Current ticket\`.`,
  ];

  await logTicketActivity(interaction.guild, null, 'Staff Access Granted', interaction.user.id, '<@&' + role.id + '>');
  await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), 'Ticket staff updated')] });
}
