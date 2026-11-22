import { EmbedBuilder, MessageType } from 'discord.js';

const types = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3
]);

export function isBoostSystemMessage(message, channelId) {
  return Boolean(channelId && message?.guild && message.channelId === channelId &&
    types.has(message.type) && message.author?.id && !message.author.bot);
}

export function parseDiscordBoostCount(content) {
  const value = String(content ?? '').trim();
  if (!/^\d{1,2}$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function buildBoostEmbed({ guildName = 'Opus Client', userId, userAvatar = null, historical = false, premiumSince = null, totalBoosts = null, noticeCount = null, historicalNumber = null, historicalTotal = null, occurredAt = Date.now() }) {
  const embed = new EmbedBuilder()
    .setColor(0xf47fff)
    .setTitle(historical ? 'Thank You for Boosting Our Discord Server!' : 'New Discord Server Boost!')
    .setDescription(
      historical
        ? `**<@${userId}>** boosted the **${guildName} Discord server**! Thanks for helping our community unlock more server perks.`
        : `**<@${userId}>** just boosted the **${guildName} Discord server**! Thanks for helping our community unlock more server perks.`
    )
    .setFooter({ text: 'Opus Client • Discord Server Boosts' });

  if (!historical) embed.setTimestamp(occurredAt);
  if (userAvatar) embed.setThumbnail(userAvatar);
  if (historical && historicalNumber != null && historicalTotal != null) {
    embed.addFields({ name: 'Boost', value: `${historicalNumber} of ${historicalTotal}`, inline: true });
  }
  if (premiumSince) embed.addFields({ name: 'Boosting Since', value: `<t:${Math.floor(premiumSince / 1000)}:F>`, inline: true });
  if (noticeCount && !historical) embed.addFields({ name: 'Boosts (Discord Notice)', value: String(noticeCount), inline: true });
  if (totalBoosts != null) embed.addFields({ name: 'Current Server Boosts', value: String(totalBoosts), inline: true });
  return embed;
}
