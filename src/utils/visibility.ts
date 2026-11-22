import { MessageFlags } from 'discord.js';

type VisibilityInput = {
  options?: {
    getBoolean?: (name: string) => boolean | null;
  } | null;
} | null | undefined;

type BooleanOptionBuilder = {
  setName(name: string): BooleanOptionBuilder;
  setDescription(description: string): BooleanOptionBuilder;
};

type HideableBuilder = {
  name?: string;
  options?: HideableBuilder[];
  toJSON?: () => { type: number };
  addBooleanOption?: (configure: (option: BooleanOptionBuilder) => BooleanOptionBuilder) => unknown;
};

function appendHideOption(builder: HideableBuilder): void {
  if (builder.options?.some(option => option.name === 'hide')) return;
  if (typeof builder.addBooleanOption !== 'function') {
    throw new TypeError('Invalid Discord command builder: missing addBooleanOption');
  }
  builder.addBooleanOption(option => option
    .setName('hide')
    .setDescription('Only you can see this response (default: No)')
  );
}

export function visibilityFlags(interaction: VisibilityInput): number {
  return interaction?.options?.getBoolean?.('hide') === true ? MessageFlags.Ephemeral : 0;
}

export function installHideOption<T>(commandBuilder: T): T {
  const builder = commandBuilder as unknown as HideableBuilder;
  const options = builder.options ?? [];
  const children = options.filter(option => option.toJSON?.().type === 1);
  if (children.length) {
    for (const child of children) appendHideOption(child);
  } else {
    appendHideOption(builder);
  }
  return commandBuilder;
}
