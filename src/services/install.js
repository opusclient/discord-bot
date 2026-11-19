import { config } from '../config.js';
import { COLORS } from '../constants.js';
import { deleteInstallMessage, getInstallMessage, listInstallMessages, setInstallMessage } from '../db.js';
import { baseEmbed, truncate } from '../utils/embeds.js';
import { AUDIT_LOG_MESSAGE_KEY } from './auditlog.js';
import { STATUS_MESSAGE_KEY, refreshStatusMessage } from './status.js';
import { SERVER_STATS_MESSAGE_KEY } from './serverstats.js';
import { TRAP_MESSAGE_KEY } from './trap.js';
import { TICKET_PANEL_MESSAGE_KEY, refreshTicketPanelMessage } from './tickets.js';
import { VERIFY_MESSAGE_KEY, refreshVerifyMessage } from './verify.js';
import { SELF_ROLES_MESSAGE_KEY, refreshSelfRolesPanelMessage } from './selfroles.js';

export const MUTED_CMDS_MESSAGE_KEY = 'muted_cmds';

export const INSTALL_MESSAGE_LABELS = {
  [TRAP_MESSAGE_KEY]: 'Do-not-type warning message',
  [MUTED_CMDS_MESSAGE_KEY]: 'Muted-commands notice',
  [AUDIT_LOG_MESSAGE_KEY]: 'Audit log notice',
  [STATUS_MESSAGE_KEY]: 'Bot status message',
  [SERVER_STATS_MESSAGE_KEY]: 'Server stats message',
  [TICKET_PANEL_MESSAGE_KEY]: 'Ticket panel message',
  [VERIFY_MESSAGE_KEY]: 'Verification message',
  [SELF_ROLES_MESSAGE_KEY]: 'Self-role panel message',
};

export const INSTALL_DELAYING_STATUSES = new Set(['Failed', 'Not set', 'Mismatch']);

export function buildMutedCmdsNotice(guild) {
  const lines = [
    'You are muted and cannot chat in the other channels.',
    '',
    'Only slash commands are supported. Try:',
    '> `/punishments view` - view your punishment history',
    '> `/help` - list available commands',
    '',
    'Messages here are visible to staff. Breaking the rules here can extend your punishment.',
  ];
  return {
    embeds: [
      baseEmbed(COLORS.mute)
        .setTitle('Muted')
        .setDescription(lines.join('\n'))
        .setFooter({ text: guild.name }),
    ],
  };
}

export async function refreshMutedCmdsNotice(client) {
  const channelId = config.mutedBotCmdsChannelId;
  if (!channelId) return null;
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn('[install] Muted bot commands channel is missing or not text based.');
    return null;
  }

  const payload = buildMutedCmdsNotice(guild);
  const stored = getInstallMessage(guild.id, MUTED_CMDS_MESSAGE_KEY);
  if (stored?.message_id && stored.channel_id === channel.id) {
    const existing = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (existing?.author.id === client.user.id) {
      await existing.edit(payload);
      return existing;
    }
  }

  const sent = await channel.send(payload);
  setInstallMessage(guild.id, MUTED_CMDS_MESSAGE_KEY, channel.id, sent.id);
  return sent;
}

export async function runInstall(client, guild) {
  if (guild.id !== config.guildId) {
    return [{ label: 'Server', status: 'Mismatch', detail: 'Opus System is not configured for this guild.' }];
  }
  const checks = [
    ['Verify panel', () => refreshVerifyMessage(client)],
    ['Ticket panel', () => refreshTicketPanelMessage(client)],
    ['Muted commands notice', () => refreshMutedCmdsNotice(client)],
    ['Status panel', () => refreshStatusMessage(client)],
    ['Self-role panel', () => refreshSelfRolesPanelMessage(client)],
  ];
  const results = [
    {
      label: 'Server configuration',
      status: 'OK',
      detail: 'Opus Manager manages guild roles, categories, channels and permissions.',
    },
  ];
  for (const [label, action] of checks) {
    try {
      const message = await action();
      results.push({
        label,
        status: message ? 'Updated' : 'Not set',
        detail: message ? 'Panel refreshed without changing guild permissions.' : 'No configured panel to refresh.',
      });
    } catch (error) {
      console.error('[install] ' + label + ' failed:', error.message);
      results.push({label,status:'Failed',detail:error.message});
    }
  }
  return results;
}

export async function runUninstall(client, guild) {
  if (guild.id !== config.guildId) {
    return [{label:'Server',status:'Mismatch',detail:'This guild is not configured for Opus System.'}];
  }
  const results = [];
  for (const stored of listInstallMessages(guild.id)) {
    const label = INSTALL_MESSAGE_LABELS[stored.key];
    if (!label) continue;
    try {
      const channel = await guild.channels.fetch(stored.channel_id).catch(() => null);
      const message = channel?.isTextBased()
        ? await channel.messages.fetch(stored.message_id).catch(() => null)
        : null;
      if (message && message.author.id !== client.user.id) {
        results.push({label,status:'Skipped',detail:'The stored message is not owned by Opus System.'});
        continue;
      }
      if (message) await message.delete();
      deleteInstallMessage(guild.id,stored.key);
      results.push({label,status:message?'Removed':'Not found',detail:'Stored panel record cleared.'});
    } catch(error) {
      results.push({label,status:'Failed',detail:error.message});
    }
  }
  if (!results.length) {
    results.push({label:'Installed panels',status:'Not found',detail:'No bot-owned panel records were found.'});
  }
  return results;
}

export function buildSetupSummaryEmbed(results, {title='Opus System',description='',report=false}={}) {
  const counts = new Map();
  for (const row of results) counts.set(row.status,(counts.get(row.status)??0)+1);
  const failed = results.some(row=>INSTALL_DELAYING_STATUSES.has(row.status));
  const embed = baseEmbed(failed?COLORS.warn:COLORS.info)
    .setTitle(title)
    .setDescription(
      [description,report?[...counts].map(([status,count])=>status+': '+count).join(' · '):null]
        .filter(Boolean)
        .join('\n\n')
        .slice(0,4096)
    );
  for(const row of results.slice(0,25)){
    embed.addFields({
      name:truncate(row.label+' · '+row.status,256),
      value:truncate(row.detail??'No details',1024)||'—',
      inline:false,
    });
  }
  return embed;
}
