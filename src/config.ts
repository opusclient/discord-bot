import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || './config.json');

export type NicknameRolePrefix = { roleId: string; prefix: string };

export type SelfRoleEntry = {
  roleId: string;
  label?: string;
  style?: 'Primary' | 'Secondary' | 'Success' | 'Danger';
};

const DEFAULT_FILE_CONFIG = {
  prefix: '=',
  guildId: '',
  muteRoleId: '',
  muteRoleName: 'Muted',
  modRoleId: '',
  moderatorRoleIds: [] as string[],
  teamRoleIds: [] as string[],
  roleBranches: {
    staff: [] as string[],
    development: [] as string[],
    specialties: [] as string[],
    founder: '',
    manager: '',
    principal: '',
    developer: '',
  },
  seniorModeratorRoleIds: [] as string[],

  botControlRoleIds: [] as string[],
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
  protectedRoleIds: [] as string[],
  developmentAccessRoleId: '',
  staffManagementRoleId: '',
  developmentManagementRoleId: '',
  muteInternalCategoryIds: [] as string[],
  mutedBotCmdsChannelId: '',
  botStatusChannelId: '',
  serverStatsChannelId: '',
  serverStatsVoiceChannelId: '',
  tickets: {
    panelChannelId: '',
    staffRoleId: '',
    staffRoleIds: [] as string[],
    supportRoleId: '',
    supportTypeKeys: ['general', 'technical', 'bugs', 'account', 'purchases'],
    generalCategoryId: '',
    generalCategoryName: 'General Tickets',
    applicationCategoryId: '',
    applicationCategoryName: 'Staff Applications',
    logChannelId: '',
    archiveCategoryId: '',
    archiveCategoryName: 'Ticket Archive',
    typeCategoryIds: {} as Record<string, string>,
  },
  createVoice: { lobbyChannelId: '' },
  welcome: { channelId: '' },
  boosts: { channelId: '' },
  nicknames: { enabled: false, rolePrefixes: [] as NicknameRolePrefix[] },
  verify: { enabled: false, channelId: '', channelName: 'verify', gate: null as unknown },
  selfRoles: { channelId: '', channelName: 'self-role', roles: [] as SelfRoleEntry[] },
  botName: 'Opus System',
  developerCredit: '',
  doNotType: { channelId: '', action: 'alert', purgeMinutes: 30, rejoinUrl: '' },
  warnEscalation: { threshold: 0, duration: '1h' },
};

type FileConfig = typeof DEFAULT_FILE_CONFIG;

type ConfigPatch = Partial<Omit<FileConfig, 'logChannels' | 'tickets' | 'selfRoles' | 'verify'>> & {
  logChannels?: Partial<FileConfig['logChannels']>;
  tickets?: Partial<FileConfig['tickets']>;
  selfRoles?: Partial<FileConfig['selfRoles']>;
  verify?: Partial<FileConfig['verify']>;
};

function loadFileConfig(): FileConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<FileConfig>;
    return { ...DEFAULT_FILE_CONFIG, ...raw, logChannels: { ...DEFAULT_FILE_CONFIG.logChannels, ...raw.logChannels }, doNotType: { ...DEFAULT_FILE_CONFIG.doNotType, ...raw.doNotType }, warnEscalation: { ...DEFAULT_FILE_CONFIG.warnEscalation, ...raw.warnEscalation }, tickets: { ...DEFAULT_FILE_CONFIG.tickets, ...raw.tickets }, createVoice: { ...DEFAULT_FILE_CONFIG.createVoice, ...raw.createVoice }, welcome: { ...DEFAULT_FILE_CONFIG.welcome, ...raw.welcome }, boosts: { ...DEFAULT_FILE_CONFIG.boosts, ...raw.boosts }, nicknames: { ...DEFAULT_FILE_CONFIG.nicknames, ...raw.nicknames }, verify: { ...DEFAULT_FILE_CONFIG.verify, ...raw.verify }, selfRoles: { ...DEFAULT_FILE_CONFIG.selfRoles, ...raw.selfRoles }, overlay: { ...DEFAULT_FILE_CONFIG.overlay, ...raw.overlay }, roleBranches: { ...DEFAULT_FILE_CONFIG.roleBranches, ...raw.roleBranches } };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      console.warn('[config] config.json not found, falling back to defaults. Copy config.example.json to config.json.');
      return { ...DEFAULT_FILE_CONFIG };
    }
    throw new Error(`[config] Failed to parse ${CONFIG_PATH}: ${err instanceof Error ? err.message : String(err)}`);
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
export function updateFileConfig(patch: ConfigPatch): void {
  const mutable = config as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = mutable[key];
      const original = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
      mutable[key] = { ...original, ...value };
    } else {
      mutable[key] = value;
    }
  }
  const { token, clientId, dbPath, configPath, ...fileOnly } = config;
  writeFileSync(CONFIG_PATH, `${JSON.stringify(fileOnly, null, 2)}\n`);
}

export function assertConfig({ requireGuild = false }: { requireGuild?: boolean } = {}): void {
  const missing: string[] = [];
  if (!config.token) missing.push('DISCORD_TOKEN (in .env)');
  if (!config.clientId) missing.push('CLIENT_ID (in .env)');
  if (requireGuild && !/^\d{17,20}$/.test(String(config.guildId))) {
    missing.push('guildId (in config.json)');
  }
  if (missing.length) {
    throw new Error(`Missing configuration: ${missing.join(', ')}.`);
  }
}
