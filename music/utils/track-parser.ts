import { TrackInfo } from '../types';

export function isUrl(input: string): boolean {
    return /^https?:\/\//i.test(input);
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
