import { isDurationInRange } from '../../utils/track-parser';
import { RawTrackInput, FlattenedTrackInfo, RecommendedTrack } from './types';

export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 20;
export const HISTORY_LIMIT = 100;
export const POPULAR_LIMIT = 50;
export const TAG_KEYWORD_LIMIT = 4;
export const KEYWORD_SIMILARITY_THRESHOLD = 0.6;
export const MIN_TAG_KEYWORD_LENGTH = 4;

export function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? (intersection / union) : 0;
}

export function containmentSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;

  let inter = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) inter += 1;
  }
  return Math.max(inter / tokensA.size, inter / tokensB.size);
}

export function keywordSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), containmentSimilarity(a, b));
}

export function isValidTagKeyword(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  const noise = ['official', 'lyrics', 'lyric', '가사', 'music', 'mv', 'audio', 'video'];
  if (noise.some((word) => normalized.includes(word))) return false;

  return normalized.replace(/\s+/g, '').length >= MIN_TAG_KEYWORD_LENGTH;
}

export function dedupeSimilarKeywords(keywords: string[] | null | undefined, threshold: number = KEYWORD_SIMILARITY_THRESHOLD): string[] {
  const selected: string[] = [];
  for (const keyword of keywords || []) {
    const normalized = normalizeText(keyword);
    if (!isValidTagKeyword(normalized)) continue;
    const duplicated = selected.some((picked) => keywordSimilarity(picked, normalized) >= threshold);
    if (!duplicated) {
      selected.push(normalized);
    }
  }
  return selected;
}

export function getTrackInfo(raw: RawTrackInput | null | undefined): FlattenedTrackInfo {
  if (!raw) {
    return { title: 'Unknown title', author: '', uri: '', artworkUrl: null, length: 0, tags: [], identifier: '' };
  }
  const base = (raw.musicInfo || raw) as Record<string, any>;
  const info = (base?.info || {}) as Record<string, any>;
  return {
    title: String(info.title || 'Unknown title'),
    author: String(info.author || ''),
    uri: String(info.uri || ''),
    artworkUrl: info.artworkUrl ? String(info.artworkUrl) : null,
    length: Number(info.length) || 0,
    tags: Array.isArray(base?.tags) ? (base.tags as string[]) : [],
    identifier: String(info.identifier || ''),
  };
}

export function getTrackKey(track: { uri?: string; author?: string; title?: string }): string {
  const uri = normalizeText(track.uri);
  if (uri) return `uri:${uri}`;
  return `meta:${normalizeText(track.author)}|${normalizeText(track.title)}`;
}

export function clampRecommendationCount(input: unknown): number {
  const parsed = Number.parseInt(String(input || DEFAULT_COUNT), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_COUNT;
  return Math.min(parsed, MAX_COUNT);
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '?:??';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function isPrimarySource(source: string | null | undefined): boolean {
  return String(source || '').startsWith('history-tag-1');
}

export function interleaveBySource(tracks: RecommendedTrack[], count: number): RecommendedTrack[] {
  const firstList = tracks.filter((track) => isPrimarySource(track.source));
  const secondList = tracks.filter((track) => !isPrimarySource(track.source));
  const ordered: RecommendedTrack[] = [];
  let useFirst = true;

  while (ordered.length < count && (firstList.length > 0 || secondList.length > 0)) {
    if (useFirst && firstList.length > 0) {
      const item = firstList.shift();
      if (item) ordered.push(item);
    }
    else if (!useFirst && secondList.length > 0) {
      const item = secondList.shift();
      if (item) ordered.push(item);
    }
    else if (firstList.length > 0) {
      const item = firstList.shift();
      if (item) ordered.push(item);
    }
    else if (secondList.length > 0) {
      const item = secondList.shift();
      if (item) ordered.push(item);
    }
    useFirst = !useFirst;
  }

  return ordered.slice(0, count);
}

export function getVideoIdFromUrl(url: string | null | undefined): string | null {
  try {
    const value = String(url || '').trim();
    if (!value) return null;
    const u = new URL(value);
    if (u.hostname.toLowerCase() === 'youtu.be') return u.pathname.replace('/', '') || null;
    if (u.hostname.toLowerCase().includes('youtube.com')) return u.searchParams.get('v');
    return null;
  }
  catch {
    return null;
  }
}

export function isKeywordMatched(tag: string, patterns: string[] | Set<string>): boolean {
  const normTag = normalizeText(tag);
  const threshold = KEYWORD_SIMILARITY_THRESHOLD;
  return Array.from(patterns).some(pattern => {
    const normPattern = normalizeText(pattern);
    if (normTag === normPattern) return true;
    return keywordSimilarity(normTag, normPattern) >= threshold;
  });
}

export function interleaveByKeyword(tracks: RecommendedTrack[], keywords: string[]): RecommendedTrack[] {
  const keywordQueues = new Map<string, RecommendedTrack[]>();
  
  for (const kw of keywords) {
    keywordQueues.set(kw.toLowerCase(), []);
  }
  const unknownQueue: RecommendedTrack[] = [];

  for (const track of tracks) {
    const kw = String(track.keyword || '').toLowerCase();
    if (keywordQueues.has(kw)) {
      keywordQueues.get(kw)!.push(track);
    } else {
      unknownQueue.push(track);
    }
  }

  const ordered: RecommendedTrack[] = [];
  const activeQueues = keywords
    .map(kw => keywordQueues.get(kw.toLowerCase())!)
    .filter(Boolean);

  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const q of activeQueues) {
      if (q.length > 0) {
        ordered.push(q.shift()!);
        hasMore = true;
      }
    }
  }

  if (unknownQueue.length > 0) {
    ordered.push(...unknownQueue);
  }

  return ordered;
}

/**
 * 키워드 풀에서 무작위로 지정된 개수만큼 선택하여 최종 키워드 리스트를 반환합니다. (1위 고정 없음)
 */
export function selectRandomKeywords(
  pinnedKeywords: string[],
  tagKeywords: string[],
  poolSize = 5,
  selectSize = 3
): string[] {
  // 1. 중복 제거된 유니크 고정 핀 확보 (최대 poolSize 개)
  const pins = Array.from(new Set(pinnedKeywords)).slice(0, poolSize);

  // 2. 고정 핀 개수가 요구량을 넘는 경우
  if (pins.length >= selectSize) {
    const shuffledPins = [...pins].sort(() => Math.random() - 0.5);
    return shuffledPins.slice(0, selectSize);
  }

  // 3. 고정 핀 개수가 요구량보다 적은 경우: 고정 핀은 무조건 전체 포함
  const result = [...pins];
  const needed = selectSize - pins.length;

  // 히스토리 키워드 중 고정 핀과 겹치지 않는 키워드 필터링
  const pinnedSet = new Set(pins);
  const remainingTags = tagKeywords.filter(t => !pinnedSet.has(t));

  // 남은 자리만큼 히스토리에서 무작위 선택하여 보충
  const availablePool = remainingTags.slice(0, poolSize - pins.length);
  const shuffledTags = [...availablePool].sort(() => Math.random() - 0.5);
  const selectedTags = shuffledTags.slice(0, needed);

  return [...result, ...selectedTags];
}

/**
 * 인자 값(유저 멘션 또는 ID)으로부터 순수 디스코드 유저 ID 문자열을 파싱합니다.
 */
export function parseUserIdFromArg(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return String((value as { id: unknown }).id);
  }

  const text = String(value).trim();
  if (!text) return null;
  const mention = /^<@!?(\d+)>$/.exec(text);
  if (mention) return mention[1];
  if (/^\d+$/.test(text)) return text;
  return null;
}
