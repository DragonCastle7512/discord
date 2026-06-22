import { Message } from "discord.js";
import { AppContext, RuntimeResponse } from "../types";
// @ts-ignore
import { ContentListUnion, GenerateContentResponse, GoogleGenAI, Part } from "@google/genai";
import { ToolName } from "./skills/tool-names";
import { safeReply } from "../common/reply-util";
import { logger } from "../common/logger";

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
10. 유저가 '잔잔한', '신나는', '우울한', '조용한', '비오는 날 듣기 좋은' 등 모호한 분위기(무드), 기분, 장르로 노래 재생을 요청하는 경우, 절대 그 분위기 키워드 자체(예: "잔잔한 노래")를 'query'로 넘겨 호출하지 마세요. 당신의 풍부한 음악 지식과 센스를 활용하여, 해당 분위기에 딱 맞는 실제 대중음악 또는 명곡 N곡을 선정하여 구체적인 곡 제목(아티스트 포함)의 배열 형태로 만들어 'slash_play'를 호출하세요. 이때, 매번 동일하거나 식상한 곡만 선별하지 않도록 하위 장르(어쿠스틱, 인디, 재즈, 포크, 알앤비, 시티팝 등)를 넓게 탐색하고 무작위성을 부여하여 매번 색다르고 다채로운 믹스를 구성하세요.
11. 자동 재생 모드를 활성화 시키는 경우 'slash_auto'만 사용하고, 'slash_play'로 별도의 음악을 다시 추가하지 마세요. 
[학습 데이터1: 치사의 상세 설정 및 세계관]
${chisaInfo}
[학습 데이터2: 치사 실제 대사]
${chisaVoice}
필요한 경우 학습 데이터를 참고하여 답하세요.
`;

export const toolStatusMap: Record<ToolName, string> & { [key: string]: string } = {
    [ToolName.GetRecommendList]: '취향에 딱 맞는 노래를 고르고 있어요... 🎵',
    [ToolName.GetYoutubePopular]: '요즘 가장 핫한 인기 곡들을 찾아보고 있어요... 🔥',
    [ToolName.GetRecentPlayed]: '최근에 재생한 노래를 확인하고 있어요... 🔍',
    [ToolName.ReadMessages]: '이전 대화 내용을 살펴보고 있어요... 📖',
    [ToolName.GetQueue]: '현재 재생중인 노래 목록을 확인하고 있어요... 📋',
    [ToolName.GetPlaylist]: '소중한 플레이리스트를 확인하고 있어요... 📂',
    [ToolName.SlashPlay]: '노래를 추가하고 있어요... 🎧',
    [ToolName.React]: '적절한 반응을 추가하고 있어요... ✨',
    [ToolName.Pin]: '잊지 않게 메시지를 고정해 둘게요... 📌',
};

const handlers: Record<string, Function> = { ...musicHandlers, ...commandHandlers, ...utilHandlers };
const functionDeclarations = [ ...music_declarations, ...command_declarations, ...util_declarations ];

interface AI {
    gemini: GoogleGenAI,
    models: string[],
    index: number,
}
const ai: AI = {
    gemini: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    models: ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-2.5-flash', 'gemini-3-flash-preview'],
    index: 0,
};

const isRetriableError = (err: any) => {
    const status = Number(err?.status || err?.error?.code || 0);
    const text = String(err?.message || '');
    return [429, 503].includes(status) || status >= 500 || text.includes('UNAVAILABLE') || text.includes('high demand');
};

async function generateWithRetry(contents: ContentListUnion): Promise<GenerateContentResponse> {
    for (let i = 0; i < ai.models.length; i++) {
        const model = ai.models[ai.index];
        try {
            return await ai.gemini.models.generateContent({
                model,
                config: { thinkingConfig: { includeThoughts: false }, systemInstruction: systemInstructions, tools: [{ functionDeclarations }] },
                contents,
            });
        }
        catch (err: any) {
            if (!isRetriableError(err)) throw err;
            console.warn(`[Gemini] ${model} 오류: ${err.message}`);
            ai.index = (ai.index + 1) % ai.models.length;
            await new Promise(r => setTimeout(r, 100));
        }
    }
    throw new Error('Gemini API Unavailable');
}

async function talk(message: Message, context: AppContext): Promise<RuntimeResponse> {
    let replyMsg = null;
    try {
        const contents: ContentListUnion = [];

        replyMsg = await safeReply(message, '생각 중... 💭');
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

        const parts: Part[] = [{ text: `[UserID: ${message.author.id}] ${message.content}` }];
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
        let response: GenerateContentResponse = await generateWithRetry(contents);

        while (response?.functionCalls && response.functionCalls?.length > 0) {
            const firstTool: string | undefined = response.functionCalls[0].name;
            if(!firstTool) break;
            const statusText = toolStatusMap[firstTool] || '잠시만 기다려주세요... ⏳';
            replyMsg = await safeReply(message, statusText, replyMsg);

            const toolParts = await Promise.all(response.functionCalls.map(async (fc) => {
                logger.info('ai', `Tool called: ${fc.name}`, { args: fc.args });
                if (!fc.name) {
                    logger.error('ai', 'Tool name missing in functionCalls', { fc });
                    return { 
                        functionResponse: { 
                            name: "unknown_function",
                            response: { output: "Error: Function name is missing." } 
                        } 
                    };
                }
                const handler = handlers[fc.name];
                const output = handler ? await handler(fc.args, { message, context }).catch((e: Error) => `Error: ${e.message}`) : `Unknown: ${fc.name}`;
                return { functionResponse: { id: fc.id, name: fc.name, response: { output } } };
            }));
            contents.push({ role: 'user', parts: toolParts });
            response = await generateWithRetry(contents);
        }

        if(replyMsg?.deletable) await replyMsg?.delete();
        if(!response.text) return { ok: false, message: '문제가 발생했어요.' };
        return { ok: true, message: response.text };
    }
    catch (err) {
        console.error(err);
        if(replyMsg?.deletable) await replyMsg?.delete();
        return { ok: false, message: '문제가 발생했어요.' };
    }
}

module.exports = { talk };