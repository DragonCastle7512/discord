import { 
  Message,
  MessagePayload, 
  MessageReplyOptions, 
  Interaction, 
  CommandInteraction, 
  MessageComponentInteraction,
  InteractionReplyOptions,
  InteractionEditReplyOptions,
  MessageEditOptions,
  BaseGuildTextChannel
} from 'discord.js';

/**
 * 메시지나 인터랙션에 대해 안전하게 응답하거나 수정합니다.
 * 원본 대상이 삭제되었거나 응답할 수 없는 상태인 경우 채널에 일반 메시지로 전송합니다.
 */
export async function safeReply(
  target: Message | Interaction,
  content: string | MessagePayload | MessageReplyOptions | InteractionReplyOptions | InteractionEditReplyOptions,
  existingReply?: Message | null
): Promise<Message | any | null> {
  const isMessage = target instanceof Message;
  const options = typeof content === 'string' ? { content } : content;

  if (isMessage) {
    try {
      if (existingReply && typeof existingReply.edit === 'function') {
        return await existingReply.edit(options as string | MessagePayload | MessageEditOptions);
      }
      return await target.reply(options as MessagePayload | MessageReplyOptions);
    } catch (err) {
      return await fallbackSend(target, options);
    }
  } else {
    // Interaction handling
    const interaction = target as CommandInteraction | MessageComponentInteraction;
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply(options as InteractionEditReplyOptions);
      }
      return await interaction.reply(options as InteractionReplyOptions);
    } catch (err) {
      return await fallbackSend(target, options);
    }
  }
}

/**
 * 채널에 직접 메시지를 전송하는 폴백 로직
 */
async function fallbackSend(target: Message | Interaction, options: any): Promise<Message | null> {
  try {
    const channel = target.channel;
    if (channel && channel.isTextBased() && 'send' in channel) {
      return await (channel as BaseGuildTextChannel).send(options);
    }
  } catch (sendErr) {
    console.error('[SafeReply] Fallback send failed:', sendErr);
  }
  return null;
}
