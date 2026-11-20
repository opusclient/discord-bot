export const id = "communications";
export const title = "Messaging & Announcements";
export const purpose = "Token scoped message editing, publishing and previews";
export const commands = Object.freeze(["dictate"]);
export const services = Object.freeze(["dictate", "dictateWeb", "notices"]);
export const events = Object.freeze(["interactionCreate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
