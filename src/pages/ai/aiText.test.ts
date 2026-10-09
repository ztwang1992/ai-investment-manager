import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n';
import { chatErrorText, connectionLabel, conversationMeta, precheck, testResultText, testingText, titleFromQuestion, welcomeText } from './aiText';

const en = MESSAGES.en;
const zh = MESSAGES.zh;
const form = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-abc' };

describe('precheck', () => {
  it('needs a key, an https address and a model before sending anything', () => {
    expect(precheck(form, en)).toBeNull();
    expect(precheck({ ...form, key: '  ' }, en)).toEqual({ status: 'fail', title: 'Connection failed', message: 'Enter an API key first' });
    expect(precheck({ ...form, base: '' }, en)?.message).toBe('Enter the API address first');
    expect(precheck({ ...form, base: 'http://api.deepseek.com' }, en)?.message).toBe('The API address must start with https://');
    expect(precheck({ ...form, model: ' ' }, en)?.message).toBe('Enter a model first');
  });
});

describe('test results (as in prototype lines 810–826)', () => {
  it('shows what is being requested while testing', () => {
    expect(testingText('https://api.deepseek.com', en)).toEqual({
      status: 'testing',
      title: 'Testing the connection…',
      message: 'Requesting https://api.deepseek.com/models',
    });
  });

  it('shows the latency and the models on success', () => {
    expect(testResultText({ kind: 'ok', latencyMs: 142, models: ['deepseek-chat', 'deepseek-reasoner'] }, 'deepseek-chat', en)).toEqual({
      status: 'ok',
      title: 'Connected',
      message: 'Latency 142ms · available models: deepseek-chat, deepseek-reasoner',
    });
    expect(testResultText({ kind: 'ok', latencyMs: 90, models: [] }, 'deepseek-chat', en).message).toBe('Latency 90ms · available models: deepseek-chat');
  });

  it('refuses a model the provider does not offer', () => {
    expect(testResultText({ kind: 'ok', latencyMs: 142, models: ['deepseek-chat'] }, 'deepseek-v9', en)).toEqual({
      status: 'fail',
      title: 'Model not available',
      message: "Connected, but deepseek-v9 isn't among the available models. Available: deepseek-chat",
    });
  });

  it('explains each failure', () => {
    const message = (outcome: Parameters<typeof testResultText>[0]) => testResultText(outcome, 'deepseek-chat', en).message;
    expect(message({ kind: 'http', status: 401 })).toBe('401 unauthorized: the API key is invalid or has expired');
    expect(message({ kind: 'http', status: 402 })).toBe('402 insufficient balance: top up in the DeepSeek console');
    expect(message({ kind: 'http', status: 404 })).toBe('404 request failed: check the API address');
    expect(message({ kind: 'timeout' })).toBe('Connection timed out: check your network or the API address');
    expect(message({ kind: 'network' })).toBe("Can't connect: check your network and the API address");
    expect(testResultText({ kind: 'timeout' }, 'deepseek-chat', en).status).toBe('fail');
  });
});

describe('conversation texts', () => {
  it('greets with the total and the biggest deviation', () => {
    expect(welcomeText({ model: 'deepseek-chat', total: '¥3.10M', offCount: 4, biggest: '10-year Treasuries' }, en)).toBe(
      "Connected to DeepSeek · deepseek-chat. I've read your plan, holdings and returns: total assets about ¥3.10M, 4 assets are off target, the biggest being 10-year Treasuries.\nWhere would you like to start?",
    );
    expect(welcomeText({ model: 'deepseek-chat', total: '••••', offCount: 0, biggest: null }, en)).toBe(
      "Connected to DeepSeek · deepseek-chat. I've read your plan, holdings and returns: total assets about ••••, every asset is within its target range.\nWhere would you like to start?",
    );
  });

  // README: the first 18 characters of the first question. English gets about the same width, cut at a word
  it('titles a new conversation with the start of its first question', () => {
    expect(titleFromQuestion('Where is my risk?')).toBe('Where is my risk?');
    expect(titleFromQuestion("Where is my portfolio's risk concentrated?")).toBe("Where is my portfolio's risk…");
    expect(titleFromQuestion('一二三四五六七八九十一二三四五六七八九十')).toBe('一二三四五六七八九十一二三四五六七八');
    expect(titleFromQuestion('这笔 ¥10 万该怎么投？')).toBe('这笔 ¥10 万该怎么投？');
  });

  // Phase one doesn't really search the web (decision 7), so the wait never claims to be "looking up the latest market news"
  it('describes the conversation and the connection', () => {
    const startedAt = new Date(2026, 8, 12, 21, 40).toISOString();
    expect(conversationMeta({ createdAt: startedAt, count: 2 }, en)).toBe('Sep 12 21:40 · 2 messages');
    expect(conversationMeta({ createdAt: startedAt, count: 1 }, en)).toBe('Sep 12 21:40 · 1 message');
    expect(connectionLabel('deepseek-chat', en)).toBe('DeepSeek · deepseek-chat · connected');
  });
});

describe('when a reply fails', () => {
  it('explains each kind of failure, and nothing for a cancelled question', () => {
    expect(chatErrorText({ kind: 'http', status: 401 }, en)).toBe('401 unauthorized: the API key is invalid or has expired. You can change the key in Conversation history.');
    expect(chatErrorText({ kind: 'http', status: 402 }, en)).toBe('402 insufficient balance: top up in the DeepSeek console');
    expect(chatErrorText({ kind: 'http', status: 429 }, en)).toBe('Too many requests: wait a moment, then ask again');
    expect(chatErrorText({ kind: 'http', status: 503 }, en)).toBe('DeepSeek is unavailable right now (503). Try again later.');
    expect(chatErrorText({ kind: 'http', status: 422 }, en)).toBe('422 request failed: check the API address and model');
    expect(chatErrorText({ kind: 'timeout' }, en)).toBe('No reply in time: check your network and ask again');
    expect(chatErrorText({ kind: 'network' }, en)).toBe("Can't connect to DeepSeek: check your network");
    expect(chatErrorText({ kind: 'broken' }, en)).toBe('The reply was cut off by an unstable network. Ask again.');
    expect(chatErrorText({ kind: 'aborted' }, en)).toBeNull();
    expect(chatErrorText({ kind: 'ok', text: 'Fine' }, en)).toBeNull();
  });
});

describe('in Chinese', () => {
  it('reads as before (prototype lines 810–850)', () => {
    expect(precheck({ ...form, key: '  ' }, zh)).toEqual({ status: 'fail', title: '连接失败', message: '请先填写 API Key' });
    expect(testResultText({ kind: 'ok', latencyMs: 142, models: ['deepseek-chat', 'deepseek-reasoner'] }, 'deepseek-chat', zh).message).toBe(
      '延迟 142ms · 可用模型：deepseek-chat、deepseek-reasoner',
    );
    expect(welcomeText({ model: 'deepseek-chat', total: '¥309.7万', offCount: 4, biggest: '10 年期美债' }, zh)).toBe(
      '已连接 DeepSeek · deepseek-chat。我读取了你的计划、持仓和收益数据：总资产约 ¥309.7万，目前 4 项资产偏离目标，最大的是10 年期美债。\n想从哪里聊起？',
    );
    expect(conversationMeta({ createdAt: new Date(2026, 8, 12, 21, 40).toISOString(), count: 2 }, zh)).toBe('09-12 21:40 · 2 条消息');
    expect(chatErrorText({ kind: 'http', status: 401 }, zh)).toBe('401 鉴权失败：API Key 无效或已过期，可以在历史对话里「更换 Key」');
  });
});
