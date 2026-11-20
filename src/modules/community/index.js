export const id = "community";
export const title = "Community & Member Services";
export const purpose = "Member profiles, invites, self roles, welcome, boost and voice features";
export const commands = Object.freeze(["invites", "info", "addselfrole", "removeselfrole"]);
export const services = Object.freeze(["inviteHistory", "inviteTracker", "memberProfile", "selfroles", "welcome", "boosts", "boostFormat", "createvoice", "serverstats"]);
export const events = Object.freeze(["guildMemberAdd", "guildMemberRemove", "inviteCreate", "inviteDelete", "voiceStateUpdate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
