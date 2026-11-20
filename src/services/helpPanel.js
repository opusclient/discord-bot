import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} from 'discord.js';

const pages = ['overview', 'moderation', 'team', 'system'];
const labels = {
  overview: 'Overview',
  moderation: 'Moderation',
  team: 'Team',
  system: 'System'
};
const groups = {
  overview: [
    {
      heading: 'GETTING STARTED',
      title: 'General & Support',
      description: 'Open tickets, check your account or get assistance.',
      commands: ['/verify', '/help', '/info', '/invites', '/ticket open', '/ticket status', '/punishments view']
    },
    {
      heading: 'TICKET DESK',
      title: 'Ticket Controls',
      description: 'Manage access and the lifecycle of an open support request.',
      commands: ['/ticket add', '/ticket remove', '/claim', '/unclaim', '/ticket rename', '/ticket close']
    }
  ],
  moderation: [
    {
      heading: 'ENFORCEMENT',
      title: 'Moderation Actions',
      description: 'Warn, restrict or remove members based on the server policy.',
      commands: ['/warning', '/mute', '/unmute', '/kick', '/ban', '/unban', '/purge']
    },
    {
      heading: 'CASE MANAGEMENT',
      title: 'Records & Blacklists',
      description: 'Review history, manage active cases and blacklist records.',
      commands: ['/punishments view', '/punishments clear', '/blacklist']
    }
  ],
  team: [
    {
      heading: 'ROLE OPERATIONS',
      title: 'Team Management',
      description: 'Grant and revoke roles, or move a member within the staff hierarchy.',
      commands: ['/role add', '/role remove', '/promote', '/demote']
    },
    {
      heading: 'SELF-ROLE PANEL',
      title: 'Available Roles',
      description: 'Manage roles displayed in the self-service selector.',
      commands: ['/addselfrole', '/removeselfrole']
    }
  ],
  system: [
    {
      heading: 'RUNTIME',
      title: 'System Operations',
      description: 'Manage the bot runtime and the server installation.',
      commands: ['/install', '/setup', '/uninstall', '/restart']
    },
    {
      heading: 'TICKET ADMINISTRATION',
      title: 'Staff Access',
      description: 'Control which roles can manage support tickets.',
      commands: ['/ticket add role scope:all', '/ticket remove role scope:all']
    }
  ]
};

export function helpPanelId(userId, page) {
  return 'opus_help:' + userId + ':' + page;
}

export function parseHelpPanelId(id) {
  const match = /^opus_help:(\d{17,20}):(overview|moderation|team|system)$/.exec(id ?? '');
  return match ? { userId: match[1], page: match[2] } : null;
}

export function buildHelpPanel({ guildName = 'Opus Client', icon = null, commandCount = 24, userId, page = 'overview', isStaff = false }) {
  const active = pages.includes(page) && (isStaff || page === 'overview') ? page : 'overview';
  const header = [
    '-# OPUS CLIENT  /  SYSTEM CONSOLE',
    '## Command Center',
    active === 'overview'
      ? 'Find the right command without scrolling through a full command dump.'
      : '**' + labels[active] + '**  ·  Quick command reference'
  ].join('\n');
  const container = new ContainerBuilder().setAccentColor(0x8070D9);
  if (icon) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  }
  container.addSeparatorComponents(separator => separator);
  for (const group of groups[active]) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        '-# ' + group.heading,
        '### ' + group.title,
        group.description,
        '',
        group.commands.map(command => '`' + command + '`').join('  ·  ')
      ].join('\n'))
    );
    container.addSeparatorComponents(separator => separator);
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '-# ' + guildName + '  ·  ' + commandCount + ' slash commands\n' +
      '**Visibility:** Public by default. Set `hide: Yes` for a private response.\n' +
      (isStaff ? 'Use the navigation below to browse staff commands.' : 'Staff commands appear for authorized members.')
    )
  );
  const links = (isStaff ? pages : ['overview']).map(choice =>
    new ButtonBuilder()
      .setCustomId(helpPanelId(userId, choice))
      .setLabel(labels[choice])
      .setStyle(choice === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(choice === active)
  );
  if (links.length > 1) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(links));
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}
