import { describe, it, expect } from 'vitest';
import { AiConfigInputSchema } from '../src/ai-config.js';
import { AiInputSchema } from '../src/instance-settings.js';

describe('AI input schemas — OpenRouter baseUrl guard', () => {
  it('rejects a baseUrl when the provider is openrouter (its endpoint is fixed)', () => {
    for (const schema of [AiConfigInputSchema, AiInputSchema]) {
      const parsed = schema.safeParse({ enabled: true, provider: 'openrouter', baseUrl: 'https://example.com/v1', apiKey: 'k' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path.includes('baseUrl'))).toBe(true);
      }
    }
  });

  it('accepts openrouter WITHOUT a baseUrl', () => {
    for (const schema of [AiConfigInputSchema, AiInputSchema]) {
      expect(schema.safeParse({ enabled: true, provider: 'openrouter', apiKey: 'k' }).success).toBe(true);
    }
  });

  it('still accepts a baseUrl for the OpenAI-compatible provider', () => {
    for (const schema of [AiConfigInputSchema, AiInputSchema]) {
      expect(schema.safeParse({ enabled: true, provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }).success).toBe(true);
    }
  });
});
