import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ChannelType, EmbedBuilder, PermissionsBitField
} from 'discord.js';
import { config } from '../config.js';
import {
  canDictate, buildDictateMessage, validateDictateDraft
} from './dictate.js';
import { sendAuditLog } from './auditlog.js';

const ttl = 15 * 60 * 1000;
const sessions = new Map();
const root = fileURLToPath(new URL('../../web/dictate/', import.meta.url));
const assets = new Map([
  ['/dictate/', ['index.html', 'text/html; charset=utf-8']],
  ['/dictate/editor.css', ['editor.css', 'text/css; charset=utf-8']],
  ['/dictate/editor.js', ['editor.js', 'text/javascript; charset=utf-8']]
]);
let server;

export function dictateWebBaseUrl() {
  let runtimeUrl = '';
  if (!process.env.DICTATE_EDITOR_PUBLIC_URL) {
    try {
      const filename = path.resolve(path.dirname(path.resolve(config.dbPath)), 'dictate-editor-public-url');
      runtimeUrl = readFileSync(filename, 'utf8').trim();
    } catch {}
  }
  const value = String(process.env.DICTATE_EDITOR_PUBLIC_URL || runtimeUrl).replace(/\/+$/, '');
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (!['https:', ...(loopback ? ['http:'] : [])].includes(parsed.protocol) ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.pathname !== '/') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function createDictateWebSession(interaction) {
  if (!canDictate(interaction)) throw new Error('Not authorized to use Dictate');
  const baseUrl = dictateWebBaseUrl();
  if (!baseUrl) throw new Error('Editor URL not configured');
  for (const [key, session] of sessions) {
    if (session.expiresAt < Date.now() || session.state === 'published') sessions.delete(key);
  }
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  sessions.set(hash, {
    guildId: interaction.guildId, userId: interaction.user.id,
    issuedAt: Date.now(), expiresAt: Date.now() + ttl, state: 'active'
  });
  return { url: baseUrl + '/dictate/#token=' + encodeURIComponent(token), expiresAt: Date.now() + ttl };
}

function verifySession(req) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice(7);
  if (!/^[A-Za-z0-9_-]{42,64}$/.test(token)) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const session = sessions.get(hash);
  if (!session || session.expiresAt < Date.now() || session.state !== 'active') return null;
  return session;
}

function write(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.byteLength;
    if (length > 25000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function safeName(value) {
  return String(value ?? '').slice(0, 100);
}

async function membership(guild, userId) {
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  return member && canDictate({
    guildId: guild.id, guild, user: { id: userId }, member
  }) ? member : null;
}

async function editorContext(client, session) {
  const guild = client.guilds.cache.get(session.guildId);
  if (!guild || guild.id !== config.guildId) throw new Error('Guild unavailable');
  const actor = await membership(guild, session.userId);
  if (!actor) throw new Error('Your permission to use Dictate has changed');
  const bot = guild.members.me ?? await guild.members.fetchMe();
  const channels = [...guild.channels.cache.values()]
    .filter(channel =>
      [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) &&
      ![config.auditLogChannelId, config.modLogChannelId,
        config.logChannels?.automodChannelId, config.logChannels?.blacklistChannelId,
        config.tickets?.logChannelId].includes(channel.id) &&
      channel.permissionsFor(actor)?.has(PermissionsBitField.Flags.ViewChannel) &&
      channel.permissionsFor(bot)?.has(PermissionsBitField.Flags.SendMessages) &&
      channel.permissionsFor(bot)?.has(PermissionsBitField.Flags.ViewChannel))
    .sort((a, b) =>
      (a.parent?.rawPosition ?? 0) - (b.parent?.rawPosition ?? 0) ||
      a.rawPosition - b.rawPosition)
    .map(channel => ({ id: channel.id, label: safeName(channel.name) }));
  const mentionChannels = [...guild.channels.cache.values()]
    .filter(channel =>
      [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
        ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type) &&
      channel.permissionsFor?.(actor)?.has(PermissionsBitField.Flags.ViewChannel))
    .sort((a, b) =>
      (a.parent?.rawPosition ?? 0) - (b.parent?.rawPosition ?? 0) ||
      a.rawPosition - b.rawPosition)
    .map(channel => ({ id: channel.id, label: safeName(channel.name) }));
  const roles = [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id && !role.managed &&
      (role.mentionable || actor.permissions.has(PermissionsBitField.Flags.MentionEveryone)))
    .sort((a, b) => b.position - a.position)
    .map(role => ({ id: role.id, label: safeName(role.name), mentionable: role.mentionable }));
  const members = await guild.members.fetch({ limit: 1000 }).catch(() => guild.members.cache);
  const users = [...members.values()].filter(member => !member.user?.bot)
    .map(member => ({
      id: member.id, label: safeName(member.displayName ?? member.user?.username),
      username: safeName(member.user?.username)
    })).sort((a, b) => a.label.localeCompare(b.label));
  return { guild, actor, bot, channels, mentionChannels, roles, users };
}

async function publish(client, session, data) {
  if (session.state !== 'publishing') throw new Error('Session already used');
  const { guild, actor, bot, channels, roles } = await editorContext(client, session);
  const draft = {
    channelId: String(data.channelId ?? ''),
    format: data.format,
    content: data.content,
    title: data.title,
    color: data.color
  };
  const invalid = validateDictateDraft(draft);
  if (invalid) throw new Error(invalid);
  if (!channels.some(channel => channel.id === draft.channelId)) {
    throw new Error('You cannot publish in that channel');
  }
  const target = await guild.channels.fetch(draft.channelId).catch(() => null);
  if (!target || !target.permissionsFor(actor)?.has(PermissionsBitField.Flags.ViewChannel) ||
      !target.permissionsFor(bot)?.has(PermissionsBitField.Flags.SendMessages) ||
      !target.permissionsFor(bot)?.has(PermissionsBitField.Flags.ViewChannel)) {
    throw new Error('Destination permission has changed');
  }
  const output = buildDictateMessage(draft);
  for (const roleId of output.allowedMentions.roles) {
    const role = guild.roles.cache.get(roleId);
    if (!role || !roles.some(item => item.id === roleId)) {
      throw new Error('Invalid role mention');
    }
    if (!role.mentionable &&
        !actor.permissions.has(PermissionsBitField.Flags.MentionEveryone)) {
      throw new Error('You cannot mention this protected role');
    }
  }
  for (const userId of output.allowedMentions.users) {
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member) throw new Error('User mention is not a member of this server');
  }
  for (const match of draft.content.matchAll(/<#(\d{16,23})>/g)) {
    const channel = guild.channels.cache.get(match[1]);
    if (!channel || !channel.permissionsFor(actor)?.has(PermissionsBitField.Flags.ViewChannel)) {
      throw new Error('Invalid or inaccessible channel mention');
    }
  }
  let sent;
  try {
    sent = await target.send(output);
  } catch (error) {
    throw new Error('Discord rejected the message: ' + error.message);
  }
  session.state = 'published';
  const audit = new EmbedBuilder().setColor(0x5865F2)
    .setTitle('Dictate Published')
    .addFields(
      { name: 'Published by', value: '<@' + session.userId + '>', inline: true },
      { name: 'Destination', value: '<#' + target.id + '>', inline: true },
      { name: 'Format', value: draft.format, inline: true },
      { name: 'Message', value: '[Open published message](' + sent.url + ')' }
    ).setFooter({ text: 'Message ID: ' + sent.id }).setTimestamp();
  const logged = await sendAuditLog(guild, audit).catch(() => null);
  return { url: sent.url, messageId: sent.id, auditLogged: Boolean(logged) };
}

export function createDictateWebHandler(client, { requireOrigin = dictateWebBaseUrl() } = {}) {
  return async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
      "img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && assets.has(pathname)) {
      const [name, contentType] = assets.get(pathname);
      const text = await readFile(path.join(root, name)).catch(() => null);
      if (!text) return write(res, 404, { error: 'Editor asset unavailable' });
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(text);
    }
    if (pathname !== '/dictate/api/session' && pathname !== '/dictate/api/publish') {
      return write(res, 404, { error: 'Not found' });
    }
    if (requireOrigin) {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (host && new URL(requireOrigin).host !== host && !['127.0.0.1', 'localhost'].includes(host.split(':')[0])) {
        return write(res, 403, { error: 'Invalid host' });
      }
      if (req.headers.origin && req.headers.origin !== requireOrigin) {
        return write(res, 403, { error: 'Invalid origin' });
      }
      if (req.method === 'POST' && req.headers.origin !== requireOrigin) {
        return write(res, 403, { error: 'Origin is required' });
      }
    }
    const session = verifySession(req);
    if (!session) return write(res, 401, { error: 'Editor link expired. Run /dictate again.' });
    if (pathname.endsWith('/session') && req.method === 'GET') {
      try {
        const context = await editorContext(client, session);
        return write(res, 200, {
          expiresAt: session.expiresAt,
          guildName: context.guild.name,
          channelOptions: context.channels, mentionChannelOptions: context.mentionChannels,
          roleOptions: context.roles, userOptions: context.users,
          userName: context.actor.displayName
        });
      } catch (error) {
        return write(res, 403, { error: error.message });
      }
    }
    if (pathname.endsWith('/publish') && req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return write(res, 415, { error: 'JSON required' });
      }
      if (session.state !== 'active') return write(res, 409, { error: 'Session already published' });
      session.state = 'publishing';
      try {
        const data = await readBody(req);
        const result = await publish(client, session, data);
        return write(res, 200, result);
      } catch (error) {
        if (session.state === 'publishing') session.state = 'active';
        return write(res, 400, { error: error.message });
      }
    }
    return write(res, 405, { error: 'Method not allowed' });
  };
}

export function startDictateWebServer(client) {
  if (server) return server;
  const port = Number(process.env.DICTATE_EDITOR_PORT ?? '8791');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid DICTATE_EDITOR_PORT');
  }
  server = createServer((req, res) => {
    void createDictateWebHandler(client)(req, res).catch(error => {
      console.error('[dictate-web] Request failed:', error.message);
      if (!res.headersSent) write(res, 500, { error: 'Internal server error' });
      else res.end();
    });
  });
  server.listen(port, '127.0.0.1');
  server.on('error', error => console.error('[dictate-web] Server error:', error.message));
  return server;
}
