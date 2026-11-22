import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildDictateModal, canDictate, startDictateSession } from '../services/dictate.js';
import { createDictateWebSession, dictateWebBaseUrl } from '../services/dictateWeb.js';

export const data = new SlashCommandBuilder()
  .setName('dictate')
  .setDescription('Compose and publish a bot-authored announcement with a preview');

export async function execute(interaction) {
  if (!canDictate(interaction)) {
    await interaction.reply({
      content: 'Only Administrator, Manager, or Founder can use /dictate.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (dictateWebBaseUrl()) {
    const { url } = createDictateWebSession(interaction);
    await interaction.reply({
      content: '**Opus System · Dictate Editor**\nOpen your private editor to compose, insert mentions, preview, and publish. This link expires after 15 minutes and can only be used once. Do not share it.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open Web Editor')
      )],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  const id = startDictateSession(interaction);
  await interaction.showModal(buildDictateModal(id));
}
