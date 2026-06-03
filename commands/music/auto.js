import { MOOD_CHOICES } from '../../ai/skills/tool-names';
import { safeReply } from '../../common/reply-util';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto')
    .setDescription('대기열이 비어있을 때 지정된 분위기의 자동 음악 재생 모드를 활성화합니다.')
    .addStringOption(option =>
      option.setName('mood')
        .setDescription('자동 재생할 음악의 분위기/무드를 선택하세요.')
        .setRequired(false)
        .addChoices(...MOOD_CHOICES),
    )
    .addBooleanOption(option =>
      option.setName('enable')
        .setDescription('자동 재생 모드를 직접 활성화(true) 또는 비활성화(false) 합니다.')
        .setRequired(false),
    ),
  async execute(interaction, context) {
    const mood = interaction.options.getString('mood');
    const enableOpt = interaction.options.getBoolean('enable');

    let enable = enableOpt;
    if (enable === null) {
      if (mood !== null) {
        enable = true;
      }
      else {
        enable = null;
      }
    }

    const result = await context.music.auto(interaction, enable, mood);

    if (result.enabled) {
      const activeMood = result.mood || '잔잔한';

      const moodLabelMap = {
        '잔잔한': '잔잔한(발라드)',
        '신나는': '신나는 댄스 & 팝',
        '랩/힙합': '랩/힙합(Hiphop)',
        '재즈': '감성적인 재즈 (Jazz)',
        '록/메탈': '파워풀한 록/메탈(Metal)',
        'Jpop': '일본 대중가요(Jpop)',
        '비오는 날': '비오는 날 어울리는 노래',
        '카페': ' 카페 분위기 BGM',
        '우울한': '우울할 때 듣는 위로송',
        '추천 곡': '추천 곡 (최근 들은 곡 기반)',
      };

      const selectedLabel = moodLabelMap[activeMood] || activeMood;
      await safeReply(interaction, `자동 재생 모드를 \`활성화\`했어요! **[${selectedLabel}]**`);
    }
    else {
      await safeReply(interaction, '자동 재생 모드를 `비활성화`했어요!');
    }
  },
};
