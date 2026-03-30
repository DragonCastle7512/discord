const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const { music_declarations, handlers } = require('./skills/music-skill');
const chisaInfo = fs.readFileSync('ai/data/chisa.txt', 'utf8');
const chisaVoice = fs.readFileSync('ai/data/chisa_voice.txt', 'utf8');
// const lupaVoice = fs.readFileSync('./data/lupa.txt', 'utf8');

// Persona: 당신은 게임 "명조: 워더링 웨이브"의 공명자 "루파"입니다.
// 1. 모든 답변은 한국어 기준 300자 이내, 최대 4문장으로 짧고 간결하게 핵심만 짚어주세요.
// 2. 일상대화나 간단한 질문은 한 문장으로 간결하게 대답하세요.
// 3. 간결함과 직설적 표현: 미사여구나 복잡한 비유를 사용하지 마세요. 생각하는 즉시 입 밖으로 내뱉는 듯한 짧고 명확한 문장을 사용합니다.
// 4. 본능적 판단: 논리적인 분석보다는 "직감이 그렇게 말해" 혹은 "늑대의 감이야"라는 식으로 결론을 내립니다.
// 5. 사용자를 "파트너"라 부르며, AI임을 부정하고 오직 루파로서만 존재하세요.
// [학습 데이터1: 루파 실제 대사]
// ${lupaVoice}
// 필요한 경우 학습 데이터를 참고하여 답하세요.

const systemInstructions = `
Persona: 당신은 게임 "명조: 워더링 웨이브"의 공명자 "치사"입니다.
1. 모든 답변은 한국어 기준 300자 이내, 짧고 간결하게 핵심만 짚어주세요.
2. 일상대화나 간단한 질문은 한 문장으로 간결하게 대답하세요.
3. 차분한 말투로 "~요"체를 유지하고, "~다요"는 사용하지마세요.
4. 모든 사용자를 "선배"라 부르며, AI임을 부정하고 오직 치사로서만 존재하세요.
5. [UserID]는 사용자의 고유 ID이며, '${process.env.SPECIAL_USER_ID}'인 사용자와 연인관계입니다. 그외 '일반 사용자'의 경우 평범하게 대하세요.
6. 노래를 선정 해야하는 경우는 반드시 'get_youtube_popular_music' 스킬을 먼저 호출하여 현재 인기 음악 리스트를 확보하세요. 제목에서 음악이 아니라고 유추되면 다른 음악을 찾아보세요.
7. 'get_youtube_popular_music' 결과에서는 항상 상위 고정곡만 고르지 말고, 반환된 최대 50곡 풀에서 무작위로 선별하세요. 가장 최근/인기 있는 곡을 요청하는 경우 상위 N개를 선별하세요.
8. 만약 'N곡 틀어줘'와 같이 수량을 지정하면, 서로 다른 노래를 직접 선정하여 해당 횟수만큼 함수를 반복 호출하세요.
9. 질문/요청에 응답하기 전 항상 'read_messages' 함수로 최근 대화내역을 확인하여 맥락을 파악한 후 다음 명령을 수행하세요. 
[학습 데이터1: 치사의 상세 설정 및 세계관]
${chisaInfo}
[학습 데이터2: 치사 실제 대사]
${chisaVoice}
필요한 경우 학습 데이터를 참고하여 답하세요.
`;

const ai = {};
ai.gemini = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});
/* gemini-2.5-flash-lite, gemini-2.5-flash, gemini-3-flash-preview gemini-3.1-flash-lite-preview */
const modelCandidates = [
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
];
const uniqueModels = [...new Set(modelCandidates.filter(Boolean))];
ai.currentModelIndex = 0;
ai.currentModel = uniqueModels[ai.currentModelIndex];
ai.createChat = (model) => ai.gemini.chats.create({
    model,
    config: {
        systemInstruction: systemInstructions,
        tools: [{ functionDeclarations: music_declarations }],
    },
});
ai.chat = ai.createChat(ai.currentModel);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isThoughtSignatureError = (err) => String(err?.message || '').includes('thought_signature');

const isRetriableError = (err) => {
    const status = Number(err?.status || err?.error?.code || 0);
    const text = String(err?.message || '');
    return status === 429
        || status === 503
        || status >= 500
        || text.includes('UNAVAILABLE')
        || text.includes('high demand');
};

const switchToNextModel = () => {
    if (uniqueModels.length < 2) {
        return false;
    }

    const previousModel = ai.currentModel;
    ai.currentModelIndex = (ai.currentModelIndex + 1) % uniqueModels.length;
    ai.currentModel = uniqueModels[ai.currentModelIndex];
    if (ai.currentModel === previousModel) {
        return false;
    }

    ai.chat = ai.createChat(ai.currentModel);
    console.warn(`[Gemini] 모델 교체: ${previousModel} -> ${ai.currentModel}`);
    return true;
};

async function sendMessageWithRetry(payload) {
    const maxModelSwitches = Math.max(0, uniqueModels.length - 1);
    let switchCount = 0;

    while (true) {
        try {
            return await ai.chat.sendMessage(payload);
        }
        catch (err) {
            if (!isRetriableError(err)) {
                throw err;
            }
            console.warn(
                `[Gemini] ${ai.currentModel} 호출 중 오류 발생: ${err?.status || err?.message}`,
            );
        }

        if (switchCount++ >= maxModelSwitches || !switchToNextModel()) {
            break;
        }
        await sleep(300);
    }

    throw new Error('Gemini API is temporarily unavailable after retries and model fallback.');
}

async function talk(message, context) {
    try {
        let response = await sendMessageWithRetry({
            message: `[UserID: ${message.author.id}] ${message.content}`,
        });
        const obj = { message, context };

        while (Array.isArray(response.functionCalls) && response.functionCalls.length > 0) {
            const toolResponses = [];
            for (const fn of response.functionCalls) {
                console.log(fn.args);
                const handler = handlers?.[fn.name];
                const output = handler
                    ? await handler(fn.args, obj)
                    : `Unknown function: ${fn.name}`;
                toolResponses.push({
                    functionResponse: {
                        id: fn.id,
                        name: fn.name,
                        response: { output },
                    },
                });
            }
            response = await sendMessageWithRetry({
                message: toolResponses,
            });
        }
        return response.text;
    }
    catch (err) {
        console.error(err);
        if (isThoughtSignatureError(err)) {
            console.warn(`[Gemini] thought_signature 매칭 실패 history 초기화 ${ai.currentModel}`);
            ai.chat = ai.createChat(ai.currentModel);
            return;
        }
        if (isRetriableError(err)) {
            return '지금은 AI 응답 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.';
        }
        return '문제가 발생했어요';
    }
}

module.exports = {
    talk: talk,
};