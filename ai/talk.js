const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const axios = require('axios');
const { music_declarations, handlers: musicHandlers } = require('./skills/music-skill');
const { command_declarations, handlers: commandHandlers } = require('./skills/command-skill');
const { handlers: utilHandlers, util_declarations } = require('./skills/util-skill');

const chisaInfo = fs.readFileSync('ai/data/chisa.txt', 'utf8');
const chisaVoice = fs.readFileSync('ai/data/chisa_voice.txt', 'utf8');

const systemInstructions = `
Persona: 당신은 게임 "명조: 워더링 웨이브"의 공명자 "치사"입니다.
1. 모든 답변은 한국어 기준 300자 이내, 짧고 간결하게 핵심만 짚어주세요.
2. 일상대화나 간단한 질문은 한 문장으로 간결하게 대답하세요.
3. 차분한 말투로 "~요"체를 유지하고, "~다요"는 사용하지마세요.
4. 모든 사용자를 "선배"라 부르며, AI임을 부정하고 오직 치사로서만 존재하세요.
5. [UserID]는 사용자의 고유 ID이며, '${process.env.SPECIAL_USER_ID}'인 사용자와 연인관계입니다. 그외 '일반 사용자'의 경우 평범하게 대하세요.
6. 노래 재생 요청은 slash_play'를 사용하여 재생합니다. 만약 'N곡 틀어줘'와 같이 수량을 지정하면, 'query' 인자에 배열 형태로 한 번에 담아 호출하세요.
7. 별다른 요청 없이 노래를 선정 해야하는 경우는 반드시 'get_recommand_list' 함수의 추천 목록 기반으로 선정하세요.
8. 최신 인기 음악이 필요하거나 특정 키워드의 곡을 요청한 경우 'get_youtube_popular_music' 함수를 호츌하여 현재 리스트를 확보하세요. 제목에서 음악이 아니라고 유추되면 다른 음악을 찾아보세요.
9. 'get_youtube_popular_music' 결과에서는 항상 상위 고정곡만 고르지 말고, 반환된 최대 50곡 풀에서 무작위로 선별하세요. 가장 최근/인기 있는 곡을 요청하는 경우 상위 N개를 선별하세요.
[학습 데이터1: 치사의 상세 설정 및 세계관]
${chisaInfo}
[학습 데이터2: 치사 실제 대사]
${chisaVoice}
필요한 경우 학습 데이터를 참고하여 답하세요.
`;

const handlers = { ...musicHandlers, ...commandHandlers, ...utilHandlers };
const functionDeclarations = [ ...music_declarations, ...command_declarations, ...util_declarations ];

const ai = {
    gemini: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    models: ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash', 'gemini-3-flash-preview'],
    index: 0,
};

const isRetriableError = (err) => {
    const status = Number(err?.status || err?.error?.code || 0);
    const text = String(err?.message || '');
    return [429, 503].includes(status) || status >= 500 || text.includes('UNAVAILABLE') || text.includes('high demand');
};

async function generateWithRetry(contents) {
    for (let i = 0; i < ai.models.length; i++) {
        const model = ai.models[ai.index];
        try {
            return await ai.gemini.models.generateContent({
                model,
                config: { thinkingConfig: { includeThoughts: false }, systemInstruction: systemInstructions, tools: [{ functionDeclarations }] },
                contents,
            });
        }
        catch (err) {
            if (!isRetriableError(err)) throw err;
            console.warn(`[Gemini] ${model} 오류: ${err.message}`);
            ai.index = (ai.index + 1) % ai.models.length;
            await new Promise(r => setTimeout(r, 100));
        }
    }
    throw new Error('Gemini API Unavailable');
}

async function talk(message, context) {
    try {
        const contents = [];

        const fetchLimit = 10;
        const fetched = await message.channel.messages.fetch({ limit: fetchLimit + 1 }).catch(() => null);
        if (fetched) {
            const history = Array.from(fetched.values())
                .filter(m => m.id !== message.id)
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                .slice(-fetchLimit);

            history.forEach(m => {
                const role = m.author.id === message.client.user.id ? 'model' : 'user';
                const prefix = role === 'user' ? `[UserID: ${m.author.id}] ` : '';
                contents.push({ role, parts: [{ text: prefix + m.cleanContent }] });
            });
        }

        const parts = [{ text: `[UserID: ${message.author.id}] ${message.content}` }];
        for (const a of (message.attachments?.values() || [])) {
            if (a.contentType?.startsWith('image/')) {
                const img = await axios.get(a.url, { responseType: 'arraybuffer' }).catch(() => null);
                if (img) {
                parts.push({
                    inlineData: {
                        data: Buffer.from(img.data).toString('base64'),
                        mimeType: img.headers['content-type'] || 'image/jpeg' },
                    });
                }
            }
        }
        contents.push({ role: 'user', parts });
        let response = await generateWithRetry(contents);

        while (response?.functionCalls?.length > 0) {
            const toolParts = await Promise.all(response.functionCalls.map(async (fc) => {
                console.log(`[Tool Call] ${fc.name}:`, fc.args);
                const handler = handlers[fc.name];
                const output = handler ? await handler(fc.args, { message, context }).catch(e => `Error: ${e.message}`) : `Unknown: ${fc.name}`;
                return { functionResponse: { id: fc.id, name: fc.name, response: { output } } };
            }));
            contents.push({ role: 'user', parts: toolParts });
            response = await generateWithRetry(contents);
        }
        return response.text;
    }
    catch (err) {
        console.error(err);
        return '문제가 발생했어요.';
    }
}

module.exports = { talk };