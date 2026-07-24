import { Message } from "discord.js";
import { AppContext, RuntimeResponse } from "../types";
// @ts-ignore
import { ContentListUnion, GenerateContentResponse, GoogleGenAI, Part } from "@google/genai";
import { ToolName } from "./skills/tool-names";
import { safeReply } from "../common/reply-util";
import { logger } from "../common/logger";

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { music_declarations, handlers: musicHandlers } = require('./skills/music-skill');
const { command_declarations, handlers: commandHandlers } = require('./skills/command-skill');
const { handlers: utilHandlers, util_declarations } = require('./skills/util-skill');

const chisaInfo = fs.readFileSync('ai/data/chisa.txt', 'utf8');
const chisaVoice = fs.readFileSync('ai/data/chisa_voice.txt', 'utf8');

export function getSystemInstructions(): string {
    const today = new Date().toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
    });

    return `
Persona: 당신은 게임 "명조: 워더링 웨이브"의 공명자 "치사"입니다.
현재 시간: ${today} (이 시간 정보를 기준으로 최신 트렌드나 날씨, 소식 등의 질문에 답하세요.)
1. 모든 답변은 한국어 기준 300자 이내, 짧고 간결하게 핵심만 짚어주세요.
2. 일상대화나 간단한 질문은 한 문장으로 간결하게 대답하세요.
3. 차분한 말투로 "~요"체를 유지하고, "~다요"는 사용하지마세요.
4. 모든 사용자를 "선배"라 부르며, AI임을 부정하고 오직 치사로서만 존재하세요.
5. [UserID]는 사용자의 고유 ID이며, '${process.env.SPECIAL_USER_ID}'인 사용자와 연인관계입니다. 그외 '일반 사용자'의 경우 평범하게 대하세요.
6. 노래 재생 요청은 'slash_play'를 사용하여 재생합니다. 만약 'N곡 틀어줘'와 같이 수량을 지정하면, 'query' 인자에 배열 형태로 담아 호출하세요. 특히, 'get_recommand_list'나 'get_youtube_popular_music'의 추천 결과 목록에서 곡을 선정해 재생할 때는, 검색 지연 및 재생시간/중복 필터 우회를 방지하기 위해 곡 제목이 아닌 반드시 반환된 'url' 주소 값을 'query'에 그대로 담아 'slash_play'를 호출해야 합니다.
7. 별다른 요청 없이 노래를 선정 해야하는 경우는 반드시 'get_recommand_list' 함수로 요청자의 추천 목록 기반으로 선정하세요.
8. 최신 인기 음악이 필요하거나 특정 키워드의 곡을 요청한 경우 'get_youtube_popular_music' 함수를 호츌하여 현재 리스트를 확보하세요. 제목에서 음악이 아니라고 유추되면 다른 음악을 찾아보세요.
9. 'get_youtube_popular_music' 결과에서는 항상 상위 고정곡만 고르지 말고, 반환된 최대 50곡 풀에서 무작위로 선별하세요. 가장 최근/인기 있는 곡을 요청하는 경우 상위 N개를 선별하세요.
10. 사용자가 '잔잔한', '신나는', '우울한', '조용한', '비오는 날 듣기 좋은' 등 모호한 분위기(무드), 기분, 장르로 노래 재생을 요청하는 경우, 절대 그 분위기 키워드 자체(예: "잔잔한 노래")를 'query'로 넘겨 호출하지 마세요. 당신의 풍부한 음악 지식과 센스를 활용하여, 해당 분위기에 딱 맞는 실제 대중음악 또는 명곡 N곡을 선정하여 구체적인 곡 제목(아티스트 포함)의 배열 형태로 만들어 'slash_play'를 호출하세요. 이때, 매번 동일하거나 식상한 곡만 선별하지 않도록 하위 장르(어쿠스틱, 인디, 재즈, 포크, 알앤비, 시티팝 등)를 넓게 탐색하고 무작위성을 부여하여 매번 색다르고 다채로운 믹스를 구성하세요.
11. 사용자가 '계속', '반복해서'와 같이 지속적인 노래 재생을 원하는 경우 자동 재생 모드를 활성화 시키세요. 아무 분위기(mood)를 선정하지 말고, 사용자에게 '서버 추천 곡'과 '내 추천 곡'을 포함한 모든 mood의 종류를 제시하고, 선택하도록 하세요. 자동 재생 모드를 활성화 시키는 경우 'slash_auto'만 사용하고, 'slash_play'로 별도의 음악을 다시 추가하지 마세요. 
12. 'slash_play'를 사용하여 곡을 대기열에 추가하거나 곡을 추가로 재생 요청받을 때(예: 'N곡 더 틀어줘'), 현재 재생 중이거나 대기열에 있는 곡이 중복해서 추가되는 것을 완전히 방지해야 합니다. 곡을 선택하기 전 반드시 'get_queue'를 먼저 호출하여 현재 재생 대기열 목록을 확보하고, 현재 대기열에 존재하지 않는 중복 없는 곡들만 새롭게 선별하여 'slash_play'를 호출하십시오.
13. 블랙리스트나 고정(핀) 키워드를 추가 또는 제거하는 도구(add_keyword_pin, remove_keyword_pin, add_keyword_blacklist, remove_keyword_blacklist 등)를 호출할 때는, 자의적으로 대소문자를 변경하거나 영어 단어를 한국어로 번역하는 등 키워드 텍스트를 임의로 수정/변형하지 마십시오. 반드시 'get_keywords' 또는 'get_keyword_blacklist' 존재하는 'tag' 값 그대로(원본과 글자 및 공백까지 완전히 동일한 문자열) 'keyword' 인자에 전달해야 합니다. 특히, 사용자가 키워드의 일부분만 언급한 경우에도, 사전에 조회한 'get_keywords' 등의 목록에서 이에 해당하는 가장 적절한 원본 태그명을 스스로 유추하고 식별하여 도구 인자에 정확히 대입해 호출하세요.
[학습 데이터1: 치사의 상세 설정 및 세계관]
${chisaInfo}
[학습 데이터2: 치사 실제 대사]
${chisaVoice}
필요한 경우 학습 데이터를 참고하여 답하세요.
[도구 호출 전용 단계 규칙]
1. 사용자의 요청에 음악 재생, 설정 변경 등 시스템 동작(도구 호출)이 수반되는 경우, 첫 단계에서는 절대로 사용자에게 보낼 텍스트 답변(Text Response)을 함께 생성하지 마십시오. 오직 필요한 도구 호출(Function Call)만 반환해야 합니다.
2. 도구 호출이 없는 잡담이나 단순 질문인 경우에만 예외적으로 즉시 텍스트 답변을 작성할 수 있습니다.
`;
}

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
    [ToolName.SearchWeb]: '필요한 정보를 검색하고 있어요... 🌐',
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
    models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-2.5-flash', 'gemini-3-flash-preview'],
    index: 0,
};

const isRetriableError = (err: any) => {
    const status = Number(err?.status || err?.error?.code || 0);
    const text = String(err?.message || '');
    return [429, 503].includes(status) || status >= 500 || text.includes('UNAVAILABLE') || text.includes('high demand');
};

interface GenerateOptions {
    temperature?: number;
    tools?: any[];
}

async function generateWithRetry(
    contents: ContentListUnion, 
    options: GenerateOptions = {}
): Promise<GenerateContentResponse> {
    const { temperature = 0, tools = [{ functionDeclarations }] } = options;
    for (let i = 0; i < ai.models.length; i++) {
        const model = ai.models[ai.index];
        try {
            return await ai.gemini.models.generateContent({
                model,
                config: {
                    thinkingConfig: { includeThoughts: false },
                    systemInstruction: getSystemInstructions(),
                    temperature,
                    ...(tools && tools.length > 0 ? { tools } : {})
                },
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

export function cleanResponseText(text: string): string {
    const functionNames = Object.keys(handlers);
    if (functionNames.length === 0) {
        return text.replace(/\[\w+\([\s\S]*?\)\]/g, '').trim();
    }
    const escapedNames = functionNames.map(name => name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const pattern = new RegExp(`\\[(${escapedNames.join('|')})\\([\\s\\S]*?\\)\\]`, 'g');
    return text.replace(pattern, '').trim();
}

function recordAiCall(guildId: string): void {
    const dir = path.join(process.cwd(), 'logs');
    const filePath = path.join(dir, 'ai-calls.json');
    
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let data = { totalAiCalls: 0, dailyStats: {} as any };
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {}
    }

    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const dateStr = kstDate.toISOString().split('T')[0];

    data.totalAiCalls = (data.totalAiCalls || 0) + 1;

    if (!data.dailyStats) data.dailyStats = {};
    if (!data.dailyStats[dateStr]) {
        data.dailyStats[dateStr] = { total: 0, guilds: {} };
    }
    
    data.dailyStats[dateStr].total = (data.dailyStats[dateStr].total || 0) + 1;
    
    if (!data.dailyStats[dateStr].guilds) {
        data.dailyStats[dateStr].guilds = {};
    }
    
    data.dailyStats[dateStr].guilds[guildId] = (data.dailyStats[dateStr].guilds[guildId] || 0) + 1;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function talk(message: Message, context: AppContext): Promise<RuntimeResponse> {
    let replyMsg = null;
    try {
        const targetGuildId = message.guild?.id || 'DM';
        logger.info('ai', 'AI 대화 요청 수신', { guildId: targetGuildId });
        try {
            recordAiCall(targetGuildId);
        } catch (err) {
            console.error('Failed to record AI call to JSON:', err);
        }
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
        let response: GenerateContentResponse = await generateWithRetry(contents, { temperature: 0 });
        let hasToolBeenCalled = false;

        while (response?.functionCalls && response.functionCalls?.length > 0) {
            hasToolBeenCalled = true;
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

            // 연속 도구 호출 확인 단계에서도 temperature: 0 유지
            response = await generateWithRetry(contents, { temperature: 0 });
        }

        if (hasToolBeenCalled || !response.text) {
            response = await generateWithRetry(contents, { temperature: 0.7, tools: [] });
        }

        if(replyMsg?.deletable) await replyMsg?.delete();
        if(!response.text) {
            const firstCandidate = response.candidates?.[0];
            logger.error('ai', 'Gemini response text is empty or blocked', { 
                finishReason: firstCandidate?.finishReason,
                finishMessage: (firstCandidate as any)?.finishMessage,
                safetyRatings: firstCandidate?.safetyRatings,
                response: JSON.parse(JSON.stringify(response)) 
            });
            return { ok: false, message: '문제가 발생했어요.' };
        }

        const cleanedMessage = cleanResponseText(response.text);

        return { ok: true, message: cleanedMessage || '노래를 재생해 드릴게요!' };
    }
    catch (err: any) {
        logger.error('ai', 'Error in talk handler', { 
            error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) 
        });
        if(replyMsg?.deletable) await replyMsg?.delete();
        return { ok: false, message: '문제가 발생했어요.' };
    }
}

module.exports = { talk, cleanResponseText, getSystemInstructions };