export const id = "verification";
export const title = "Verification & Onboarding";
export const purpose = "Member verification, role onboarding and private account validation";
export const commands = Object.freeze(["verify"]);
export const services = Object.freeze(["verify", "accountLinkWebhook"]);
export const events = Object.freeze(["guildMemberAdd", "interactionCreate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
