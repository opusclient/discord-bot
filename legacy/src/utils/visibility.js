import { MessageFlags } from 'discord.js';

export function visibilityFlags(interaction) {
  return interaction?.options?.getBoolean?.('hide') === true ? MessageFlags.Ephemeral : 0;
}

export function installHideOption(commandBuilder) {
  const append = builder => {
    if (builder.options?.some(option => option.name === 'hide')) return;
    builder.addBooleanOption(option => option
      .setName('hide')
      .setDescription('Only you can see this response (default: No)')
    );
  };
  const options = commandBuilder.options ?? [];
  const children = options.filter(option => option.toJSON?.().type === 1);
  if (children.length) {
    for (const child of children) append(child);
  } else {
    append(commandBuilder);
  }
  return commandBuilder;
}
