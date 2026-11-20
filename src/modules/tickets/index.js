export const id = "tickets";
export const title = "Tickets & Support";
export const purpose = "Support channel lifecycle, access, claims and transcripts";
export const commands = Object.freeze(["ticket", "claim", "unclaim"]);
export const services = Object.freeze(["tickets"]);
export const events = Object.freeze(["interactionCreate"]);
export const manifest = Object.freeze({ id, title, purpose, commands, services, events });
