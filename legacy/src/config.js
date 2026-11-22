import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || './config.json');

const DEFAULT_FILE_CONFIG = {
  prefix: '=',
  guildId: '',
  muteRoleId: '',
  muteRoleName: 'Muted',
  modRoleId: '',
  moderatorRoleIds: [],
  teamRoleIds: [],
  seniorModeratorRoleIds: [],

  botControlRoleIds: [],
  modLogChannelId: '',
  auditLogChannelId: '',
  logChannels: { automodChannelId: '', blacklistChannelId: '' },
  botRoleId: '',
  botRoleName: 'Opus System',
  botPermsRoleId: '',
  botPermsRoleName: 'Opus System Perms',
  botsRoleId: '',
  botsRoleName: 'Bots',
  verifiedRoleId: '',
  verifiedRoleName: 'Verified',
  unlinkedRoleId: '',
  linkedRoleId: '',
  serverManagedByOpusManager: true,
  overlay: { enabled: true, eventChannelId: '' },
  protectedRoleIds: [],
  developmentAccessRoleId: '',
  staffManagementRoleId: '',
  developmentManagementRoleId: '',
  muteInternalCategoryIds: [],
  mutedBotCmdsChannelId: '',
  botStatusChannelId: '',
  serverStatsChannelId: '',
  serverStatsVoiceChannelId: '',
  tickets: {
    panelChannelId: '',
    staffRoleId: '',
    staffRoleIds: [],
    supportRoleId: '',
    supportTypeKeys: ['general', 'technical', 'bugs', 'account', 'purchases'],
    generalCategoryId: '',
    generalCategoryName: 'General Tickets',
    applicationCategoryId: '',
    applicationCategoryName: 'Staff Applications',
    logChannelId: '',
    archiveCategoryId: '',
    archiveCategoryName: 'Ticket Archive',
    typeCategoryIds: {},
  },
  createVoice: { lobbyChannelId: '' },
  welcome: { channelId: '' },
  boosts: { channelId: '' },
  nicknames: { enabled: false, rolePrefixes: [] },
  verify: { enabled: false, channelId: '', channelName: 'verify', gate: null },
  selfRoles: { channelId: '', channelName: 'self-role', roles: [] },
  botName: 'Opus System',
  developerCredit: '',
  doNotType: { channelId: '', action: 'alert', purgeMinutes: 30, rejoinUrl: '' },
  warnEscalation: { threshold: 0, duration: '1h' },
};

function loadFileConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_FILE_CONFIG, ...raw, logChannels: { ...DEFAULT_FILE_CONFIG.logChannels, ...raw.logChannels }, doNotType: { ...DEFAULT_FILE_CONFIG.doNotType, ...raw.doNotType }, warnEscalation: { ...DEFAULT_FILE_CONFIG.warnEscalation, ...raw.warnEscalation }, tickets: { ...DEFAULT_FILE_CONFIG.tickets, ...raw.tickets }, createVoice: { ...DEFAULT_FILE_CONFIG.createVoice, ...raw.createVoice }, welcome: { ...DEFAULT_FILE_CONFIG.welcome, ...raw.welcome }, boosts: { ...DEFAULT_FILE_CONFIG.boosts, ...raw.boosts }, nicknames: { ...DEFAULT_FILE_CONFIG.nicknames, ...raw.nicknames }, verify: { ...DEFAULT_FILE_CONFIG.verify, ...raw.verify }, selfRoles: { ...DEFAULT_FILE_CONFIG.selfRoles, ...raw.selfRoles }, overlay: { ...DEFAULT_FILE_CONFIG.overlay, ...raw.overlay } };
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[config] config.json not found, falling back to defaults. Copy config.example.json to config.json.');
      return { ...DEFAULT_FILE_CONFIG };
    }
    throw new Error(`[config] Failed to parse ${CONFIG_PATH}: ${err.message}`);
  }
}

export const fileConfig = loadFileConfig();

export const config = {
  token: process.env.DISCORD_TOKEN?.trim() || '',
  clientId: process.env.CLIENT_ID?.trim() || '',
  dbPath: process.env.DB_PATH?.trim() || './data/bot.sqlite',
  configPath: CONFIG_PATH,
  ...fileConfig,
};

// Persist a patch (top-level or nested one level) back to config.json.
export function updateFileConfig(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      config[key] = { ...(config[key] ?? {}), ...value };
    } else {
      config[key] = value;
    }
  }
  const { token, clientId, dbPath, configPath, ...fileOnly } = config;
  writeFileSync(CONFIG_PATH, `${JSON.stringify(fileOnly, null, 2)}\n`);
}

export function assertConfig({ requireGuild = false } = {}) {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN (in .env)');
  if (!config.clientId) missing.push('CLIENT_ID (in .env)');
  if (requireGuild && !/^\d{17,20}$/.test(String(config.guildId))) {
    missing.push('guildId (in config.json)');
  }
  if (missing.length) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }
}
