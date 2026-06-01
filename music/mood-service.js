const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const models = ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'];

async function generateSongBatchForMood(mood, excludedTitles = [], count = 20) {
  const model = models[0];
  const excludedList = excludedTitles.slice(-30).join(', ');

  const prompt = `
유저가 요청한 음악 분위기 또는 키워드: "${mood}"

위 분위기에 딱 맞는 실제 유명 한국 대중음악(가요) 또는 유명 팝송 중에서 서로 다른 명곡 ${count}곡을 추천해주세요.
단, 최근에 재생된 다음 곡들은 중복되므로 반드시 제외해야 합니다: [${excludedList}]

답변은 반드시 아래의 예시처럼 번호나 특수 기호(따옴표 등)나 부연 설명 없이 오직 '아티스트 - 곡 제목' 형식으로 한 줄에 한 곡씩만 작성해주세요.
예시:
아이유 - 밤편지
성시경 - 거리에서
볼빨간사춘기 - 우주를 줄게`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.85,
        thinkingConfig: { includeThoughts: false },
      },
    });

    const text = response.text ? response.text.trim() : '';
    if (!text) return [];

    const lines = text.split('\n')
      .map(line => {
        const cleaned = line.replace(/^\d+[\.\-\s]*/, '')
          .replace(/^[\-\*\+\•\s]*/, '')
          .replace(/['"“”]/g, '')
          .trim();
        return cleaned;
      })
      .filter(line => line.includes('-') && line.length > 3);

    return lines;
  }
  catch (err) {
    console.error('[Gemini Mood Service] Error generating song batch:', err);
    return [];
  }
}

module.exports = { generateSongBatchForMood };
