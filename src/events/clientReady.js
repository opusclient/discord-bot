import { ActivityType, Events } from 'discord.js';
import { config } from '../config.js';
import { reconcileVerifiedMembers } from '../services/accountRoles.js';
import { startAccountLinkWebhook } from '../services/accountLinkWebhook.js';
import { startOverlayBridge } from '../services/overlayBridge.js';
import { refreshAuditLogNotice } from '../services/auditlog.js';
import { buildSetupSummaryEmbed, refreshMutedCmdsNotice, runInstall } from '../services/install.js';
import { sendModLog } from '../services/log.js';
import { initScheduler } from '../services/scheduler.js';
import { AUTO_INSTALL_ENV } from '../services/restart.js';
import { refreshStatusMessage, startStatusLoop } from '../services/status.js';
import { refreshServerStatsMessage, startServerStatsLoop } from '../services/serverstats.js';
import { refreshTrapMessage } from '../services/trap.js';
import { refreshVerifyMessage } from '../services/verify.js';
import { refreshSelfRolesPanelMessage } from '../services/selfroles.js';
import { refreshTicketPanelMessage } from '../services/tickets.js';
import { reconcileStaffNicknames } from '../services/staffNicknames.js';
import { reconcileAllRoleBranches } from '../services/roleBranchService.js';
import { syncGuildSlashCommands } from '../services/slashSync.js';
import { inviteTracker } from '../services/inviteTracker.js';
import { initializeLogIntegrity, startLogIntegrityMonitoring } from '../services/logIntegrity.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  console.log(`[bot] Logged in as ${client.user.tag} (${client.guilds.cache.size} guild(s)).`);
  if (!client.guilds.cache.has(config.guildId)) {
    console.warn(`[bot] WARNING: the bot is not in the configured guild (${config.guildId}).`);
  }
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'Opus Client • Moderation', type: ActivityType.Watching }],
  });
  void initializeLogIntegrity(client).catch(error =>
    console.error('[log-integrity] Initialization failed:', error.message));
  startLogIntegrityMonitoring(client);
  const inviteGuild = client.guilds.cache.get(config.guildId);
  if (inviteGuild) {
    await inviteTracker.initialize(inviteGuild)
      .then(count => console.log('[invites] Initial invite snapshot:', count))
      .catch(error => console.error('[invites] Cannot initialize tracking:', error.message));
  }
  initScheduler(client);
  await syncGuildSlashCommands(client).then(result => console.log('[slash-sync] Guild commands:', JSON.stringify(result))).catch(error => console.error('[slash-sync] Synchronization failed:', error.message));
  const guild = client.guilds.cache.get(config.guildId);
  if (guild && config.verify.enabled) {
    await reconcileVerifiedMembers(guild).then(count => console.log('[verify] Account role reconciliation: ' + count)).catch(error => console.error('[verify] Account role reconciliation failed:', error.message));
  }
  startAccountLinkWebhook(client);
  startOverlayBridge(client);
  if (guild) {
    await reconcileAllRoleBranches(guild).then(result => console.log('[role-branch] Startup reconciliation:', JSON.stringify(result))).catch(error => console.error('[role-branch] Startup reconciliation failed:', error.message));
    await reconcileStaffNicknames(guild).then(result => console.log('[staff-nicknames] Startup reconciliation:', JSON.stringify(result))).catch(error => console.error('[staff-nicknames] Startup reconciliation failed:', error.message));
  }

  // Restarted via =restart / restart command: the new instance boots with
  // OPUS_SYSTEM_AUTO_INSTALL=1 and re-runs the full setup automatically. The flag is
  // cleared right away so it can never leak into child processes (deploy, scripts).
  if (process.env[AUTO_INSTALL_ENV] === '1') {
    delete process.env[AUTO_INSTALL_ENV];
    const guild = client.guilds.cache.get(config.guildId);
    if (guild) {
      console.log('[install] Auto-install boot flag found - running the full setup.');
      try {
        const results = await runInstall(client, guild, { installerId: client.user.id });
        const failed = results.filter((r) => r.status === 'Failed').length;
        console.log(`[install] Auto-install finished: ${results.length} step(s), ${failed} failed.`);
        await sendModLog(
          guild,
          buildSetupSummaryEmbed(results, {
            title: 'Auto-Install (Restart)',
            description: 'The setup was re-run automatically after the restart.',
            report: true,
          }),
        );
      } catch (err) {
        console.error('[install] Auto-install failed:', err.message);
      }
    }
  }

  await refreshTrapMessage(client).catch((err) => console.error('[trap] Initial refresh failed:', err.message));
  await refreshVerifyMessage(client).catch((err) => console.error('[verify] Initial refresh failed:', err.message));
  await refreshMutedCmdsNotice(client).catch((err) =>
    console.error('[install] Initial muted-commands notice refresh failed:', err.message),
  );
  await refreshAuditLogNotice(client).catch((err) =>
    console.error('[auditlog] Initial audit log notice refresh failed:', err.message),
  );
  await refreshStatusMessage(client).catch((err) => console.error('[status] Initial refresh failed:', err.message));
  startStatusLoop(client);
  await refreshServerStatsMessage(client).catch((err) =>
    console.error('[serverStats] Initial refresh failed:', err.message),
  );
  startServerStatsLoop(client);
  await refreshTicketPanelMessage(client).catch((err) => console.error('[tickets] Initial panel refresh failed:', err.message));
  await refreshSelfRolesPanelMessage(client).catch((err) =>
    console.error('[selfroles] Initial refresh failed:', err.message),
  );
}
