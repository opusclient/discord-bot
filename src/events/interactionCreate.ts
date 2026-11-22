import { reviewAuthorityInteraction } from '../services/roleIntegrity.js';
import { Events, MessageFlags } from 'discord.js';
import type { Interaction, Client, ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

type SystemClient = Client & {
  commands: Map<string, { execute(interaction: ChatInputCommandInteraction, client: Client): Promise<unknown> }>;
};

const permissionError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const actionEmbed = (result: { error?: string; success?: string }): EmbedBuilder =>
  result.error ? errorEmbed(result.error) : successEmbed(result.success ?? 'Action completed.');

import { config } from '../config.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { isConfiguredGuild } from '../utils/permissions.js';
import { buildHelpPanel, parseHelpPanelId } from '../services/helpPanel.js';
import { canViewStaffHelp } from '../commands/help.js';
import { visibilityFlags } from '../utils/visibility.js';
import { handleDictateInteraction } from '../services/dictate.js';
import { TICKET_BUTTON_ID, TICKET_CLOSE_BUTTON_ID, TICKET_CLAIM_BUTTON_ID, TICKET_SELECT_ID, TICKET_PANEL_ACTIONS, buildTicketPanelActionPayload, TICKET_PURPOSE_MODAL_ID, TICKET_PURPOSE_INPUT_ID, TICKET_TYPES, buildTicketPurposeModal, claimTicket, canManageTicket, closeTicket, getTicketForChannel, openTicket, parseTicketButtonType, parseTicketModalType } from '../services/tickets.js';
import { VERIFY_BUTTON_ID, sweepVerifyPings, verifyMember } from '../services/verify.js';
import { SELF_ROLE_BUTTON_PREFIX, sendSelfRolePing, toggleSelfRole } from '../services/selfroles.js';
import {
  CV_INVITE_ID,
  CV_LIMIT_ID,
  CV_PRIVACY_ID,
  CV_RENAME_ID,
  CV_RENAME_MODAL_ID,
  applyVoiceRename,
  inviteVoiceMembers,
  requestVoiceRename,
  setVoiceLimit,
  toggleVoicePrivacy,
} from '../services/createvoice.js';

export const name = Events.InteractionCreate;

// Shared verification flow for the Verify button (verify channel panel and DM card).
// In DMs there is no guild on the interaction - verifyMember resolves the membership
// against the configured guild; the reply stays a normal DM message (a DM channel is
// private by definition, so ephemeral is not needed).
async function handleVerifyInteraction(interaction: ButtonInteraction, client: SystemClient, { fromDm = false }: { fromDm?: boolean } = {}): Promise<void> {
  const result = await verifyMember(interaction).catch((err) => {
    console.error('[verify] Verification failed:', permissionError(err));
    return { error: 'Verification failed. Try again in a moment.' };
  });
  const embed = ('error' in result && result.error)
    ? errorEmbed(result.error)
    : ('already' in result && result.already)
      ? successEmbed('You are already verified - nothing to do.', 'Already verified')
      : successEmbed('Your verification is complete.', 'Verified');
  const options: { embeds: EmbedBuilder[]; flags?: MessageFlags.Ephemeral } = { embeds: [embed] };
  if (!fromDm) options.flags = MessageFlags.Ephemeral;
  await interaction.reply(options).catch(() => {});

  const member = 'member' in result ? result.member : null;
  if ('verified' in result && result.verified && member) {
    // First-time verification only: point the new member at the self-role panel and
    // remove their fallback ping from the verify channel (if the DM failed on join).
    await sendSelfRolePing(member).catch(() => {});
    await sweepVerifyPings(member).catch(() => {});
  }
}

export async function execute(interaction: Interaction, client: SystemClient): Promise<void> {
  // Verify presses from the bot's DMs (the DM card carries the button): run the same
  // verification flow instead of rejecting the interaction with the guild gate below.
  if (!interaction.inGuild()) {
    if (interaction.isButton() && interaction.customId === VERIFY_BUTTON_ID) {
      await handleVerifyInteraction(interaction, client, { fromDm: true });
    }
    return;
  }

  if (!isConfiguredGuild(interaction.guildId)) {
    if (interaction.isRepliable()) {
      const reason = config.guildId
        ? `This bot only operates in the configured server (ID: ${config.guildId}).`
        : 'Open config.json, set `guildId` to your server ID, then restart the bot.';
      await interaction
        .reply({
          embeds: [
            errorEmbed(reason, 'Bot not configured for this server'),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    return;
  }

  if (!interaction.inGuild()) return;
  const cached = interaction as Interaction<'cached'>;
  if (cached.isButton() && await reviewAuthorityInteraction(cached)) return;

  if ((cached.isButton() || cached.isModalSubmit?.()) &&
      await handleDictateInteraction(cached)) return;

  if (cached.isButton()) {
    const help = parseHelpPanelId(cached.customId);
    if (help) {
      if (help.userId !== cached.user.id) {
        await cached.reply({ content: 'Use /help to open your own command guide.', flags: MessageFlags.Ephemeral });
        return;
      }
      const panel = buildHelpPanel({
        guildName: cached.guild?.name || 'Opus Client',
        icon: cached.guild?.iconURL?.({ size: 256 }) || client.user?.displayAvatarURL?.({ size: 256 }) || null,
        commandCount: client.commands.size,
        userId: cached.user.id,
        isStaff: canViewStaffHelp(cached),
        page: help.page
      });
      await cached.update({ components: panel.components });
      return;
    }
  }

  if (cached.isButton() && Object.values(TICKET_PANEL_ACTIONS).some(id => id === cached.customId)) {
    await cached.reply(buildTicketPanelActionPayload(
      cached.customId,
      cached.guildId,
      cached.user.id
    ));
    return;
  }

  if (cached.isStringSelectMenu() && cached.customId === TICKET_SELECT_ID) {
    const typeKey = cached.values[0];
    if (!Object.hasOwn(TICKET_TYPES, typeKey)) {
      await cached.reply({ embeds: [errorEmbed('Invalid ticket category.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await cached.showModal(buildTicketPurposeModal(typeKey));
    return;
  }

  if (cached.isButton() && parseTicketButtonType(cached.customId) !== null) {
    await cached.showModal(buildTicketPurposeModal(parseTicketButtonType(cached.customId)!));
    return;
  }

  if (cached.isModalSubmit() && parseTicketModalType(cached.customId) !== null) {
    const typeKey = parseTicketModalType(cached.customId)!;
    const purpose = cached.fields.getTextInputValue(TICKET_PURPOSE_INPUT_ID).trim();
    if (purpose.length < 10) {
      await cached.reply({ embeds: [errorEmbed('Please describe the purpose in at least 10 characters.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await cached.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await openTicket(cached, client, typeKey, purpose).catch(error => {
      console.error('[tickets] Ticket creation failed:', error.message);
      return { error: 'Opening the ticket failed. Please try again.' };
    });
    const type = TICKET_TYPES[typeKey];
    const embed = 'error' in result && result.error
      ? errorEmbed(result.error)
      : 'channel' in result && result.channel
        ? successEmbed('**' + type.label + '** created: <#' + result.channel.id + '>')
        : errorEmbed('Ticket creation did not return a channel.');
    await cached.editReply({ embeds: [embed] }).catch(() => {});
    return;
  }

  if (cached.isButton() && cached.customId === TICKET_CLAIM_BUTTON_ID) {
    const ticket = getTicketForChannel(cached.guildId, cached.channelId);
    if (!ticket) {
      await cached.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await cached.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await claimTicket(cached.guild, ticket, cached.member, client).catch(error => {
      console.error('[tickets] Claim failed:', error.message);
      return { error: 'Claiming the ticket failed.' };
    });
    await cached.editReply({
      embeds: [
        result.error ? errorEmbed(result.error) :
          successEmbed('claimed' in result && result.claimed ? 'Ticket claimed.' : 'Ticket unclaimed.')
      ],
    }).catch(() => {});
    return;
  }

  // The "Close Ticket" button inside a ticket (owner or staff).
  if (cached.isButton() && cached.customId === TICKET_CLOSE_BUTTON_ID) {
    const ticket = getTicketForChannel(cached.guildId, cached.channelId);
    if (!ticket) {
      await cached.reply({ embeds: [errorEmbed('This channel is not an open ticket.')], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (!canManageTicket(ticket, cached.member)) {
      await cached
        .reply({ embeds: [errorEmbed('Only the ticket owner or staff can close this ticket.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    await cached.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const result = await closeTicket(cached.guild, ticket, cached.member, null, client).catch((err) => {
      console.error('[tickets] Close failed:', err.message);
      return { error: 'Closing the ticket failed. Try again in a moment.' };
    });
    const embed = result?.error
      ? errorEmbed(result.error)
      : successEmbed('Ticket closed. The channel has been deleted - the transcript went to the ticket log.');
    await cached.editReply({ embeds: [embed] }).catch(() => {});
    return;
  }

  // Create-voice panel actions inside a spawned voice channel.
  if (cached.isButton() && cached.customId === CV_RENAME_ID) {
    const result = await requestVoiceRename(cached).catch((err) => {
      console.error('[voice] Rename request failed:', err.message);
      return { error: 'Could not open the rename dialog. Try again in a moment.' };
    });
    if (result?.error) {
      await cached.reply({ embeds: [errorEmbed(result.error)], flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      if ('modal' in result && result.modal) await cached.showModal(result.modal).catch(() => {});
    }
    return;
  }

  if (cached.isModalSubmit() && cached.customId === CV_RENAME_MODAL_ID) {
    const result = await applyVoiceRename(cached).catch((err) => {
      console.error('[voice] Rename failed:', err.message);
      return { error: 'Could not rename the room. Try again in a moment.' };
    });
    const embed = actionEmbed(result);
    await cached.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (cached.isButton() && cached.customId === CV_PRIVACY_ID) {
    const result = await toggleVoicePrivacy(cached).catch((err) => {
      console.error('[voice] Privacy toggle failed:', err.message);
      return { error: 'Could not change the privacy. Try again in a moment.' };
    });
    const embed = actionEmbed(result);
    await cached.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (cached.isStringSelectMenu() && cached.customId === CV_LIMIT_ID) {
    const result = await setVoiceLimit(cached).catch((err) => {
      console.error('[voice] Limit change failed:', err.message);
      return { error: 'Could not set the user limit. Try again in a moment.' };
    });
    const embed = actionEmbed(result);
    await cached.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (cached.isUserSelectMenu() && cached.customId === CV_INVITE_ID) {
    const result = await inviteVoiceMembers(cached).catch((err) => {
      console.error('[voice] Invite failed:', err.message);
      return { error: 'Could not invite members. Try again in a moment.' };
    });
    const embed = actionEmbed(result);
    await cached.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // The "Verify" button on the verification embed (and the DM card, resolved above).
  if (cached.isButton() && cached.customId === VERIFY_BUTTON_ID) {
    await handleVerifyInteraction(cached, client);
    return;
  }

  if (cached.isButton() && cached.customId.startsWith(SELF_ROLE_BUTTON_PREFIX)) {
    const result = await toggleSelfRole(cached).catch((err) => {
      console.error('[selfroles] Toggle failed:', err.message);
      return { error: 'Toggling the role failed. Try again in a moment.' };
    });
    const embed = 'error' in result && result.error
      ? errorEmbed(result.error)
      : 'role' in result && result.role
        ? ('removed' in result && result.removed
          ? successEmbed(`Removed the **${result.role.name}** role.`, 'Role removed')
          : successEmbed(`Added the **${result.role.name}** role.`, 'Role added'))
        : errorEmbed('Role update did not return a role.');
    await cached.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // Display-only counter buttons on the do-not-type warning message.
  if (cached.isButton() && cached.customId.startsWith('trap_stat_')) {
    const key = cached.customId.replace('trap_stat_', '');
    await cached
      .reply({ content: 'This counter is display-only.', flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  if (!cached.isChatInputCommand()) return;

  const command = client.commands.get(cached.commandName);
  if (!command) {
    await cached.reply({
      embeds: [errorEmbed('This command is no longer registered in Opus System. Ask staff to refresh the slash-command registry.')],
      flags: visibilityFlags(cached),
    }).catch(() => {});
    return;
  }

  try {
    await command.execute(cached, client);
  } catch (err) {
    console.error(`[command:${cached.commandName}]`, err);
    const embed = errorEmbed('Something went wrong while running this command. Check the bot logs for details.');
    try {
      if (cached.deferred || cached.replied) await cached.editReply({ embeds: [embed] });
      else await cached.reply({ embeds: [embed], flags: visibilityFlags(cached) });
    } catch {
      // cached already expired
    }
  }
}
