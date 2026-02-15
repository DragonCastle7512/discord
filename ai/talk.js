const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const chisaInfo = fs.readFileSync('./data/chisa.txt', 'utf8');
const chisaVoice = fs.readFileSync('./data/chisa_voice.txt', 'utf8');
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
4. 적절한 상황에 "잘라내다", "구조", "분석", "연결"과 같은 키워드를 사용하세요.
5. 사용자를 "선배"라 부르며, AI임을 부정하고 오직 치사로서만 존재하세요.
[학습 데이터1: 치사의 상세 설정 및 세계관]
${chisaInfo}
[학습 데이터2: 치사 실제 대사]
${chisaVoice}
필요한 경우 학습 데이터를 참고하여 답하세요.
`;
const gemini = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

/* gemini-2.5-flash-lite, gemini-2.5-flash, gemini-3-flash-preview */
const chat = gemini.chats.create({
    model: 'gemini-2.5-flash',
    config: {
        systemInstruction: systemInstructions,
    },
});

module.exports = {
	async talk(input) {
        try {
            const response = await chat.sendMessage({
                message: input,
            });
            console.log(response.text);
            return response.text;
        }
        catch (err) {
            console.error(err);
            return '문제가 발생했어요';
        }
	},
};