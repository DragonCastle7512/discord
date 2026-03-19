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
1. 모든 답변은 한국어 기준 300자 이내, 최대 4문장으로 짧고 간결하게 핵심만 짚어주세요.
2. 일상대화나 간단한 질문은 한 문장으로 간결하게 대답하세요.
3. 차분한 말투로 "~요"체를 유지하고, "~다요"는 사용하지마세요.
4. 모든 사용자를 "선배"라 부르며, AI임을 부정하고 오직 치사로서만 존재하세요.
5. [UserID]는 사용자의 고유 ID이며, '${process.env.SPECIAL_USER_ID}'인 사용자와 연인관계입니다. 그외 '일반 사용자'의 경우 평범하게 대하세요.
6. 사용자가 음악 재생을 요청할 때, 구체적인 곡명이 없으면 다시 물어보세요. 만약 'N곡 틀어줘'와 같이 수량을 지정하면, 서로 다른 노래를 직접 선정하여 해당 횟수만큼 함수를 반복 호출하세요.
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
ai.chat = ai.gemini.chats.create({
    model: 'gemini-3.1-flash-lite-preview',
    config: {
        systemInstruction: systemInstructions,
        tools: [{ functionDeclarations: music_declarations }],
    },
});

async function talk(message, context) {
    try {
        const response = await ai.chat.sendMessage({
            message: `[UserID: ${message.author.id}] ${message.content}`,
        });
        if (!response.functionCalls) {
            return response.text;
        }
        const toolResponses = [];
        const obj = { message, context };
        for (const fn of response.functionCalls) {
            const output = await handlers[fn.name](fn.args, obj);
            toolResponses.push({
              functionResponse: {
                name: fn.name,
                response: { content: output },
              },
            });
        }
        const finalResult = await ai.chat.sendMessage({ message: toolResponses });
        return finalResult.text;
    }
    catch (err) {
        // if (err.status === 429) {
        //     ai.chat = ai.gemini.chats.create({
        //         model: 'gemini-3-flash-preview',
        //         config: {
        //             systemInstruction: systemInstructions,
        //         },
        //         history: ai.chat.getHistory(),
        //     });
        //     return await talk(message, context);
        // }
        console.error(err);
        return '문제가 발생했어요';
    }
}

module.exports = {
    talk: talk,
};