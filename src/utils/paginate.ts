import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, EmbedBuilder, Message, MessageEditOptions } from 'discord.js';

type PageOptions = {
  totalPages: number;
  render: (page: number) => EmbedBuilder;
  timeoutMs?: number;
};

type MessagePageOptions = PageOptions & {
  authorId?: string;
};

type CollectorOptions = Required<PageOptions> & {
  message: Message;
  authorId: string;
  editMessage: (payload: MessageEditOptions) => Promise<unknown>;
};

function buildRow(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('pg_prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId('pg_indicator')
      .setLabel(`${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('pg_next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

function attachCollector({ message, authorId, totalPages, render, timeoutMs, editMessage }: CollectorOptions): void {
  let page = 0;
  const collector = message.createMessageComponentCollector({ time: timeoutMs });
  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== authorId) {
      await interaction.reply({ content: 'Only the command author can flip through pages.', flags: MessageFlags.Ephemeral });
      return;
    }
    page = interaction.customId === 'pg_prev' ? Math.max(0, page - 1) : Math.min(totalPages - 1, page + 1);
    await interaction.update({ embeds: [render(page)], components: [buildRow(page, totalPages)] });
  });
  collector.on('end', () => {
    editMessage({ components: [] }).catch(() => {});
  });
}

export async function paginateInteraction(
  interaction: ChatInputCommandInteraction,
  { totalPages, render, timeoutMs = 120_000 }: PageOptions
): Promise<void> {
  const message = await interaction.editReply({
    embeds: [render(0)],
    components: totalPages > 1 ? [buildRow(0, totalPages)] : [],
  });
  if (totalPages <= 1) return;
  attachCollector({
    message,
    authorId: interaction.user.id,
    totalPages,
    render,
    timeoutMs,
    editMessage: (payload) => interaction.editReply(payload),
  });
}

export async function paginateMessage(
  message: Message,
  { totalPages, render, timeoutMs = 120_000, authorId = message.author?.id }: MessagePageOptions
): Promise<Message> {
  if (totalPages <= 1) return message.edit({ embeds: [render(0)], components: [] });
  await message.edit({ embeds: [render(0)], components: [buildRow(0, totalPages)] });
  attachCollector({
    message,
    authorId,
    totalPages,
    render,
    timeoutMs,
    editMessage: (payload) => message.edit(payload),
  });
  return message;
}
