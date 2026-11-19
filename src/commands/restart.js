import { visibilityFlags } from '../utils/visibility.js';
import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { restartProcess } from '../services/restart.js';
import { successEmbed } from '../utils/embeds.js';
import { ensureBotController } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('restart')
  .setDescription('Restart Opus System and refresh configured runtime panels');

export async function execute(interaction) {
  if (!(await ensureBotController(interaction))) return;

  await interaction.reply({
    flags: visibilityFlags(interaction),
    embeds: [
      successEmbed(
        'Restarting... The bot boots back on its own within a few seconds and automatically re-runs the full setup. No action is needed.',
        'Restart',
      ),
    ],
  });

  // Give Discord a moment to deliver the reply before the process exits.
  setTimeout(() => {
    restartProcess({ reason: `/restart by ${interaction.user.tag}` });
  }, 1_000);
}
