import { Interaction, Collection, Client } from 'discord.js';
import { MusicRuntime } from './music/types';

/**
 * 응답 객체 공통 인터페이스
 */
export interface RuntimeResponse {
  ok: boolean;
  message: string;
}

/**
 * TTS 실행부 인터페이스 (tts/runtime.js 기반)
 */
export interface TtsRuntime {
  playTts: (interaction: Interaction, query: string, input: string) => Promise<RuntimeResponse>;
  createPlayableUrl: (audioBuffer: Buffer) => string | null;
}

/**
 * 애플리케이션 전체 컨텍스트
 */
export interface AppContext {
  music: MusicRuntime;
  tts: TtsRuntime;
  slashCommands?: any;
}

/**
 * Discord Client 확장 타입
 */
export type MyClient = Client & {
  commands: Collection<string, any>;
};
