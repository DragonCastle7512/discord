import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
const axios = require('axios');
const { handlers } = require('../ai/skills/util-skill');

describe('Tavily Search Web Skill Tests', () => {
  let originalPost: any;

  before(() => {
    originalPost = axios.post;
  });

  after(() => {
    axios.post = originalPost;
  });

  it('should return error message when API key is missing', async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const result = await handlers.search_web({ query: 'test query' });
      assert.ok(result.includes('Tavily API Key가 설정되지 않았습니다'));
    } finally {
      process.env.TAVILY_API_KEY = originalKey;
    }
  });

  it('should return formatted search results when API call is successful', async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'mock-key';

    axios.post = async (url: string, data: any) => {
      assert.strictEqual(url, 'https://api.tavily.com/search');
      assert.strictEqual(data.api_key, 'mock-key');
      assert.strictEqual(data.query, 'seoul weather');
      
      return {
        data: {
          results: [
            { title: 'Weather Today', content: 'Sunny and warm', url: 'https://weather.com' }
          ]
        }
      };
    };

    try {
      const result = await handlers.search_web({ query: 'seoul weather' });
      assert.ok(result.includes('Sunny and warm'));
      assert.ok(result.includes('Weather Today'));
      assert.ok(result.includes('https://weather.com'));
    } finally {
      process.env.TAVILY_API_KEY = originalKey;
    }
  });

  it('should handle API exceptions gracefully', async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'mock-key';

    axios.post = async () => {
      throw new Error('Network error');
    };

    try {
      const result = await handlers.search_web({ query: 'test' });
      assert.ok(result.includes('Network error'));
    } finally {
      process.env.TAVILY_API_KEY = originalKey;
    }
  });
});
