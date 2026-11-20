export const id = "integrations";
export const title = "External Integrations";
export const purpose = "Opus overlay and external account connections";
export const commands = Object.freeze([]);
export const services = Object.freeze(["overlayBridge", "accountLinkWebhook"]);
export const events = Object.freeze([]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
