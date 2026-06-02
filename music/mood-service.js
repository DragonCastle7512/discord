const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const models = ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'];

async function generateSongBatchForMood(mood, excludedTitles = [], count = 20) {
  const model = models[0];
  const excludedList = excludedTitles.slice(-30).join(', ');
  const randomSeed = Math.random().toString(36).substring(7);

  const prompt = `
유저가 요청한 음악 분위기/장르/키워드: "${mood}"

위 분위기/장르/키워드에 가장 부합하는 실제 존재하는 유명 명곡 ${count}곡을 추천해주세요. 
단, 아래 조건을 철저히 준수해야 합니다:
1. 장르 및 언어 일치성: 요청된 분위기나 키워드(예: J-POP 또는 일본 대중가요인 경우 반드시 실제 일본 음악, 재즈인 경우 재즈 음악, 팝송인 경우 해외 팝송, 한국 가요인 경우 한국 가요 등)에 완전히 부합하는 음악이어야 합니다. 분위기와 관계없는 엉뚱한 국가나 장르의 음악을 추천해서는 안 됩니다.
2. 다양성 및 무작위화: 매번 동일한 곡만 나오지 않도록 대중적인 메가 히트곡뿐만 아니라 다양한 연도(1990년대 ~ 현재), 다양한 아티스트의 숨은 명작들까지 다채롭고 신선하게 섞어서 추천해주세요. (고유 시드: ${randomSeed})
3. 중복 배제: 최근에 재생된 다음 곡들은 중복되므로 반드시 제외해야 합니다: [${excludedList}]

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
