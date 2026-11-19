import { config } from '../config.js';
import { db } from '../db.js';
import { buildBoostEmbed, isBoostSystemMessage, parseDiscordBoostCount } from './boostFormat.js';

db.exec(`
CREATE TABLE IF NOT EXISTS boost_announcements (
  guild_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  announcement_channel_id TEXT,
  announcement_message_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_boost_announcements_user ON boost_announcements (guild_id, user_id);
`);

const inflight = new Set();

function beginRecord({ guildId, sourceId, userId, occurredAt }) {
  const result = db.prepare(`INSERT OR IGNORE INTO boost_announcements
    (guild_id, source_id, user_id, kind, event_timestamp, created_at)
    VALUES (?, ?, ?, 'live', ?, ?)`
  ).run(guildId, sourceId, userId, occurredAt, Date.now());
  if (result.changes === 0) {
    const previous = db.prepare(
      'SELECT announcement_message_id FROM boost_announcements WHERE guild_id = ? AND source_id = ?'
    ).get(guildId, sourceId);
    return { created: false, previousMessageId: previous?.announcement_message_id ?? null };
  }
  return { created: true };
}

function completeRecord(guildId, sourceId, channelId, messageId) {
  db.prepare(`UPDATE boost_announcements
    SET announcement_channel_id = ?, announcement_message_id = ?
    WHERE guild_id = ? AND source_id = ?`
  ).run(channelId, messageId, guildId, sourceId);
}

async function announce({ guild, sourceId, user, occurredAt, noticeCount = null }) {
  const channelId = config.boosts?.channelId;
  if (!channelId || !user?.id) return { skipped: 'not-configured' };
  const id = guild.id + ':' + sourceId;
  if (inflight.has(id)) return { skipped: 'in-progress' };
  inflight.add(id);
  try {
    const state = beginRecord({ guildId:guild.id, sourceId, userId:user.id, occurredAt });
    if (!state.created) {
      return { skipped: 'already-recorded', previousMessageId: state.previousMessageId };
    }
    const target = await guild.channels.fetch(channelId);
    if (!target?.isTextBased()) throw new Error('Configured boost channel is missing or not text-based');
    const freshGuild = await guild.fetch();
    const embed = buildBoostEmbed({
      guildName:guild.name,
      userId:user.id,
      userAvatar:user.displayAvatarURL?.({size:256}) ?? null,
      totalBoosts:freshGuild.premiumSubscriptionCount,
      noticeCount,
      occurredAt
    });
    const sent = await target.send({
      content:'<@' + user.id + '>',
      embeds:[embed],
      allowedMentions:{parse:[],users:[user.id]}
    });
    completeRecord(guild.id,sourceId,target.id,sent.id);
    console.log('[boosts] New boost announced:',JSON.stringify({userId:user.id,sourceId,messageId:sent.id}));
    return {posted:true,id:sent.id};
  }finally{
    inflight.delete(id);
  }
}

export async function processBoostSystemMessage(message) {
  if (!isBoostSystemMessage(message, config.boosts?.channelId)) {
    return { skipped:'not-boost' };
  }
  const result = await announce({
    guild:message.guild,
    sourceId:message.id,
    user:message.author,
    occurredAt:message.createdTimestamp,
    noticeCount:parseDiscordBoostCount(message.content)
  });
  if (result.posted || result.previousMessageId) {
    await message.delete().catch(error =>
      console.warn('[boosts] Could not remove native boost notice:',error.message)
    );
  }
  return result;
}
