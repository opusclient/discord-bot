export const id = "operations";
export const title = "Bot Operations";
export const purpose = "Setup, runtime control, command registration and server checks";
export const commands = Object.freeze(["help", "install", "setup", "uninstall", "restart"]);
export const services = Object.freeze(["install", "restart", "slashSync", "helpPanel"]);
export const events = Object.freeze(["clientReady", "interactionCreate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
