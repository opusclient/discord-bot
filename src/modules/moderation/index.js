export const id = "moderation";
export const title = "Moderation & Enforcement";
export const purpose = "Punishment lifecycle, moderation actions and escalations";
export const commands = Object.freeze(["warning", "mute", "unmute", "kick", "ban", "unban", "blacklist", "purge", "punishments"]);
export const services = Object.freeze(["mutes", "escalation", "purge", "scheduler", "historyCommand"]);
export const events = Object.freeze(["autoModerationActionExecution", "guildMemberAdd"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
