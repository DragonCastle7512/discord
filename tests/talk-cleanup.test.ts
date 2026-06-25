import test, { describe, it } from 'node:test';
import assert from 'node:assert';
const { cleanResponseText } = require('../ai/talk');

describe('Talk Cleanup Tests', () => {
  it('should remove bracketed slash_play function calls from response text', () => {
    const input = "선배가 요청하신 노래들을 재생목록에 추가할게요! [slash_play(query=['검정치마 - Antifreeze', '백예린 - 산책'])] 즐감하세요!";
    const expected = "선배가 요청하신 노래들을 재생목록에 추가할게요!  즐감하세요!";
    assert.strictEqual(cleanResponseText(input), expected.trim());
  });

  it('should remove multiple different bracketed function calls', () => {
    const input = "먼저 대기열을 비우고 [slash_clear()] 노래를 추가할게요 [slash_play(query=['죠지 - Boat'])]";
    const expected = "먼저 대기열을 비우고  노래를 추가할게요";
    assert.strictEqual(cleanResponseText(input), expected.trim());
  });

  it('should handle multi-line function calls', () => {
    const input = `[slash_play(query=[
      '우효 - 민들레',
      '실리카겔 - No Pain'
    ])]
    노래를 추가해 드렸어요!`;
    const expected = "노래를 추가해 드렸어요!";
    assert.strictEqual(cleanResponseText(input), expected.trim());
  });

  it('should return empty string or preserve normal text if no bracketed calls exist', () => {
    const input = "선배, 오늘 날씨가 참 맑네요.";
    assert.strictEqual(cleanResponseText(input), input);
  });

  it('should preserve unregistered or normal bracketed function-like notations to avoid false positives', () => {
    const input = "이 코드는 [process(data)] 함수를 실행합니다. 그리고 [참고(링크)]를 확인하세요.";
    assert.strictEqual(cleanResponseText(input), input);
  });
});
