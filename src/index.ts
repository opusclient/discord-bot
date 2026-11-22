import { Client, Collection, GatewayIntentBits } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig, config } from './config.js';
import { loadCommands, loadEvents } from './utils/loaders.js';
import type { SlashCommandModule } from './utils/loaders.js';

type OpusClient = Client & {
  commands: Collection<string, SlashCommandModule>;
};

if (process.env.OPUS_TS_CUTOVER !== '1') {
  throw new Error('TypeScript runtime is staged. OPUS_TS_CUTOVER=1 is required after stopping the legacy instance.');
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
assertConfig({ requireGuild: true });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
  ],
}) as OpusClient;

client.commands = new Collection<string, SlashCommandModule>();
await loadCommands(path.join(dirname, 'commands'), client.commands);
await loadEvents(client, path.join(dirname, 'events'));

process.on('unhandledRejection', (error: unknown) => {
  console.error('[unhandledRejection]', error);
});

await client.login(config.token).catch((error: Error) => {
  console.error('[login] Failed to log in:', error.message);
  process.exit(1);
});
