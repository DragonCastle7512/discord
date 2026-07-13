import { TrackInfo } from '../types';

export function isUrl(input: string): boolean {
    return /^https?:\/\//i.test(input);
}

export function preprocessSearchQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return trimmed;
    if (isUrl(trimmed)) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    const keywords = ['노래', '음악', 'music', 'song', 'ost', 'playlist', '플레이리스트'];
    const hasMusicKeyword = keywords.some(k => lower.includes(k));
    if (hasMusicKeyword) {
        return trimmed;
    }
    return `${trimmed} 노래`;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeTagToken(value: any): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s#-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function uniqueTags(tags: string[], limit: number = 12): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rawTag of tags) {
        const tag = normalizeTagToken(rawTag);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        result.push(tag);
        if (result.length >= limit) break;
    }
    return result;
}

export function extractTagsFromTrackInfo(info: TrackInfo | null | undefined): string[] {
    const title = String(info?.title || '');
    const author = String(info?.author || '');
    const sourceName = String(info?.sourceName || '');
    const tags: string[] = [];

    if (author) {
        tags.push(author);
    }
    if (sourceName) {
        tags.push(sourceName);
    }

    const hashTags = title.match(/#[\p{L}\p{N}_-]+/gu) || [];
    tags.push(...hashTags.map((tag) => tag.replace(/^#/, '')));

    const bracketParts: string[] = [];
    const bracketRegex = /[\(\[\{]([^\)\]\}]{2,40})[\)\]\}]/g;
    let match;
    while ((match = bracketRegex.exec(title)) !== null) {
        bracketParts.push(match[1]);
    }
    tags.push(...bracketParts);

    const splitParts = title.split(/[-–|:/]/g).map((part) => part.trim()).filter(Boolean);
    tags.push(...splitParts);

    const noise = new Set([
        'lyrics',
        'lyric',
        'official',
        'youtube',
        'music',
        'video',
        'mv',
        'audio',
        'ver',
        'version',
        'feat',
        'remix',
        'live',
        'shorts',
        'translate',
        'translation',
        '가사',
        '번역',
        '독음',
        '파트',
    ]);

    const cleaned = tags
        .map((value) => normalizeTagToken(value))
        .filter((value) => value.length >= 2 && value.length <= 40)
        .filter((value) => {
            if (noise.has(value)) return false;
            if (/^\d+$/.test(value)) return false;
            return true;
        });

    return uniqueTags(cleaned, 12);
}

export function extractYoutubeVideoId(input: string): string | null {
    try {
        const u = new URL(input);
        const host = u.hostname.toLowerCase();

        if (host.includes('youtube.com')) {
            if (u.pathname === '/watch') return u.searchParams.get('v');
            if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
            if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
        }

        if (host === 'youtu.be') return u.pathname.replace('/', '') || null;
    }
    catch (err) {
        console.log(err);
    }

    return null;
}

export const MIN_DURATION_MS = 90 * 1000; // 1m 30s
export const MAX_DURATION_MS = 6 * 60 * 1000; // 6m

export function parseIsoDurationToSeconds(duration: string | null | undefined): number | null {
    if (!duration) return null;
    const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(duration);
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return (hours * 3600) + (minutes * 60) + seconds;
}

/**
 * 곡의 길이가 1분 30초 ~ 6분 범위에 속하는지 검사합니다.
 * @param duration 밀리초 단위 숫자(number) 또는 ISO 8601 duration 문자열(string)
 */
export function isDurationInRange(duration: number | string | null | undefined): boolean {
    if (duration === null || duration === undefined) return false;

    let durationMs: number;
    if (typeof duration === 'number') {
        durationMs = duration;
    } else if (typeof duration === 'string') {
        if (/^\d+$/.test(duration)) {
            durationMs = Number.parseInt(duration, 10);
        } else {
            const seconds = parseIsoDurationToSeconds(duration);
            if (seconds === null) return false;
            durationMs = seconds * 1000;
        }
    } else {
        return false;
    }

    return Number.isFinite(durationMs) && durationMs >= MIN_DURATION_MS && durationMs <= MAX_DURATION_MS;
}

