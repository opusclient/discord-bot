import { Events, AutoModerationActionType } from 'discord.js';
import { config } from '../config.js';
import { COLORS } from '../constants.js';
import { sendAutoModLog } from '../services/log.js';
import { baseEmbed } from '../utils/embeds.js';

export const name=Events.AutoModerationActionExecution;

export async function execute(event){
  if(!event||event.guildId!==config.guildId)return;
  const action={
    [AutoModerationActionType.BlockMessage]:'Message blocked',
    [AutoModerationActionType.SendAlertMessage]:'Alert sent',
    [AutoModerationActionType.Timeout]:'Timeout applied',
    [AutoModerationActionType.BlockMemberInteraction]:'Member interaction blocked'
  }[event.action?.type]??'Automod action';
  const fields=[
    {name:'Member',value:event.userId?'<@'+event.userId+'>':'Unknown',inline:true},
    {name:'Channel',value:event.channelId?'<#'+event.channelId+'>':'Not provided',inline:true},
    {name:'Rule',value:event.ruleId?String.fromCharCode(96)+event.ruleId+String.fromCharCode(96):'Unknown',inline:false}
  ];
  const embed=baseEmbed(COLORS.warn)
    .setAuthor({name:'OPUS CLIENT  /  AUTOMATED MODERATION'})
    .setTitle(action)
    .setDescription('A Discord AutoMod rule was triggered.')
    .addFields(fields)
    .setTimestamp(Date.now());
  if(event.alertSystemMessageId){
    embed.setFooter({text:'Alert ID: '+event.alertSystemMessageId});
  }
  await sendAutoModLog(event.guild,embed);
}
