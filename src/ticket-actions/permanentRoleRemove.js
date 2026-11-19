import { visibilityFlags } from '../utils/visibility.js';
import { COLORS } from '../constants.js';
import { sendModLog } from '../services/log.js';
import { removeTicketStaffRole, ticketStaffRoleIds } from '../services/tickets.js';
import { baseEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { ensureBotController, roleAssignabilityError } from '../utils/permissions.js';

export async function execute(interaction) {
  await interaction.deferReply({ flags: visibilityFlags(interaction) });

  if (!(await ensureBotController(interaction))) return;

  const role = interaction.options.getRole('role', true);

  const roleError = roleAssignabilityError(interaction.guild, role);
  if (roleError) return interaction.editReply({ embeds: [errorEmbed(roleError)] });

  const result = await removeTicketStaffRole(
    interaction.guild,
    role,
    `Ticket staff role removed by ${interaction.user.tag}`,
  ).catch((err) => {
    console.error('[ticket:permanent-remove] Failed:', err.message);
    return { error: `Could not update the ticket staff roles: ${err.message}` };
  });
  if (result?.error) return interaction.editReply({ embeds: [errorEmbed(result.error)] });

  const remaining = ticketStaffRoleIds();
  const lines = [];
  if (result.revoked) {
    lines.push(`<@&${role.id}> no longer manages tickets.`);
    lines.push(
      result.ok
        ? `Access revoked on **${result.ok}** open ticket(s)${result.failed ? `, ${result.failed} failed` : ''}.`
        : 'No open tickets needed an update.',
    );
  } else {
    lines.push(`<@&${role.id}> was removed from the extensible list, but it still manages tickets via the legacy staff or mod role.`);
  }
  lines.push(
    remaining.length
      ? `Extensible staff list now: ${remaining.map((id) => `<@&${id}>`).join(', ')}.`
      : 'The extensible staff list is now empty.',
  );

  await sendModLog(
    interaction.guild,
    baseEmbed(COLORS.audit)
      .setTitle('Ticket Staff Updated')
      .setDescription(`**Removed:** <@&${role.id}>\n**By:** <@${interaction.user.id}>`)
      .setTimestamp(Date.now()),
  );
  await interaction.editReply({ embeds: [successEmbed(lines.join('\n'), 'Ticket staff updated')] });
}
