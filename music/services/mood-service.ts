import { logger } from '../../common/logger';

async function getAI() {
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

type AIClient = Awaited<ReturnType<typeof getAI>>;

let aiInstance: AIClient | null = null;

async function getAIInstance(): Promise<AIClient> {
  if (!aiInstance) {
    aiInstance = await getAI();
  }
  return aiInstance;
}

const models = ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'];

/**
 * 일반 분위기별 자동 재생(AI 기반 분위기 노래 선정)
 */
export async function generateSongBatchForMood(
  mood: string,
  excludedTitles: string[] = [],
  count: number = 20
): Promise<string[]> {
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
    const ai = await getAIInstance();
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
    logger.error('ai', '[Gemini Mood Service] Error generating song batch', { error: err instanceof Error ? err.stack : String(err) });
    return [];
  }
}

/**
 * 추천 노래 자동 재생(히스토리 태그 분석 -> 검색 후 재생 가능한 목록 조회)
 */
export async function selectAndCleanSongsFromSearch(
  videoTitles: string[],
  tagsString: string,
  excludedTitles: string[] = [],
  count: number = 20
): Promise<string[]> {
  const model = models[0];
  const excludedList = Array.isArray(excludedTitles) ? excludedTitles.slice(-30).join(', ') : '';

  const prompt = `
유저의 음악 취향 키워드/태그: [${tagsString}]

아래는 유튜브에서 위 태그와 관련해 실시간으로 검색된 실제 존재하는 영상들의 제목 리스트입니다:
${videoTitles.map((title, idx) => `${idx + 1}. ${title}`).join('\n')}

위 리스트 중에서 유저의 취향에 부합하는 곡을 최대 ${count}곡 선정해 주세요.
반드시 아래 조건을 준수해야 합니다:
1. 리스트에 실제로 기재된 영상만 골라야 하며, 절대 실존하지 않는 곡을 지어내거나(Hallucination) 리스트에 없는 곡을 마음대로 추가하지 마세요.
2. 1시간 연속 재생, 모음집, 컴필레이션, 앨범 전곡(Full Album) 같은 여러 곡이 포함된 영상은 제외하고 단일 곡 영상만 선택해주세요.
3. 선택한 영상의 제목을 분석하여, 불필요한 태그/괄호/화질 설명(예: [MV], Official Video, Lyrics, HD, 1080p 등)을 모두 제거하고 오직 '아티스트 - 곡 제목'의 아주 깔끔한 형태로만 한 줄에 하나씩 작성해주세요.
   예: [MV] IU(아이유) _ 밤편지(Through the Night) -> 아이유 - 밤편지
   예: (Lyrics) 볼빨간사춘기 - 우주를 줄게 -> 볼빨간사춘기 - 우주를 줄게
   예: 임영웅 - 사랑은 늘 도망가 [신사와 아가씨 OST] -> 임영웅 - 사랑은 늘 도망가
4. 중복 배제: 다음 곡들은 이미 최근에 감상한 곡들이므로, 검색 결과 리스트에 포함되어 있더라도 절대 선택하지 마세요: [${excludedList}]
5. 같은 아티스트의 노래를 연속으로 재생하지 말고, 적절히 섞어서 작성해주세요.

답변은 부연 설명, 번호 표시나 기호 없이 오직 '아티스트 - 곡 제목' 형식으로만 한 줄에 한 곡씩만 작성해주세요.`;

  try {
    const ai = await getAIInstance();
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.3,
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
    logger.error('ai', '[Gemini Mood Service] Error in selectAndCleanSongsFromSearch', { error: err instanceof Error ? err.stack : String(err) });
    return [];
  }
}
