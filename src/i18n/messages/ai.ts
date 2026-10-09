// The AI advisor: connecting a model, the chat, the conversation drawer, and what is sent to the model
// (the portfolio summary and the system prompt). The model answers in the interface language.
import type { Period, UndefinedMode } from '../../domain/types';
import { en as commonEn } from './common';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const PERIOD_NOUNS_EN: Record<Period, string> = { month: 'month', quarter: 'quarter', year: 'year' };
const PERIODS_ZH: Record<Period, string> = { month: '月', quarter: '季度', year: '年' };

export const en = {
  title: 'AI advisor',
  newTitle: 'New conversation',
  suggestions: [
    "Where is my portfolio's risk concentrated?",
    'How should I invest ¥100,000?',
    'Should I rebalance the overweight Treasuries now?',
    'How far am I from my retirement target?',
  ],
  me: 'Me',
  avatarMe: 'Me',
  history: 'Conversation history',
  newConversation: '+ New conversation',
  dataRead: 'Read Plan · Holdings · Returns',
  web: (on: boolean) => `Web analysis · ${on ? 'on' : 'off'}`,
  ask: 'Ask about your portfolio',
  askPlaceholder: 'Ask about your portfolio…',
  send: 'Send',
  busy: 'The AI advisor is thinking…',
  changeKey: 'Change key',
  keyNotSaved: "The key couldn't be saved on this device; you'll need to enter it again next time",
  /** "Sep 12 21:40 · 2 messages" */
  meta: (month: number, day: number, time: string, messages: number) =>
    `${commonEn.shortDate(month, day)} ${time} · ${count(messages, 'message', 'messages')}`,
  connection: (provider: string, model: string) => `${provider} · ${model} · connected`,
  welcome: (provider: string, model: string, total: string, offCount: number, biggest: string | null) =>
    `Connected to ${provider} · ${model}. I've read your plan, holdings and returns: total assets about ${total}, ${
      offCount > 0 && biggest ? `${count(offCount, 'asset is', 'assets are')} off target, the biggest being ${biggest}` : 'every asset is within its target range'
    }.\nWhere would you like to start?`,

  setup: {
    title: 'Connect your own model',
    text: 'After you enter an API key, the AI advisor reads your plan, holdings and returns to help you analyze your portfolio.',
    promises: [
      '· The key is encrypted and kept on this device only, never uploaded to our servers',
      '· In a conversation, data goes straight from your phone to the model provider you chose',
      '· You can disconnect or change it here at any time',
    ],
    provider: 'Model provider',
    providers: [
      { name: 'DeepSeek', desc: 'China · OpenAI-compatible API', tag: 'Available' },
      { name: 'Qwen · Kimi · Zhipu', desc: 'China', tag: 'Coming soon' },
      { name: 'Claude · OpenAI · Gemini', desc: 'International', tag: 'Coming soon' },
    ],
    base: 'API address (OpenAI-compatible)',
    model: 'Model',
    consent: (provider: string) =>
      `During conversations I agree to send a summary of my plan, holdings and returns to ${provider} for analysis. Account numbers and login details are never sent.`,
    testing: 'Testing…',
    test: 'Test connection',
    start: 'Start a conversation',
  },

  test: {
    failTitle: 'Connection failed',
    needKey: 'Enter an API key first',
    needBase: 'Enter the API address first',
    needHttps: 'The API address must start with https://',
    needModel: 'Enter a model first',
    testingTitle: 'Testing the connection…',
    testingMessage: (url: string) => `Requesting ${url}`,
    modelMissingTitle: 'Model not available',
    modelMissing: (wanted: string, models: readonly string[]) => `Connected, but ${wanted} isn't among the available models. Available: ${models.join(', ')}`,
    okTitle: 'Connected',
    ok: (latencyMs: number, models: readonly string[]) => `Latency ${latencyMs}ms · available models: ${models.join(', ')}`,
    unauthorized: '401 unauthorized: the API key is invalid or has expired',
    noBalance: (provider: string) => `402 insufficient balance: top up in the ${provider} console`,
    failed: (status: number) => `${status} request failed: check the API address`,
    timeout: 'Connection timed out: check your network or the API address',
    network: "Can't connect: check your network and the API address",
  },

  chatError: {
    unauthorized: '401 unauthorized: the API key is invalid or has expired. You can change the key in Conversation history.',
    noBalance: (provider: string) => `402 insufficient balance: top up in the ${provider} console`,
    tooMany: 'Too many requests: wait a moment, then ask again',
    unavailable: (provider: string, status: number) => `${provider} is unavailable right now (${status}). Try again later.`,
    failed: (status: number) => `${status} request failed: check the API address and model`,
    timeout: 'No reply in time: check your network and ask again',
    network: (provider: string) => `Can't connect to ${provider}: check your network`,
    broken: 'The reply was cut off by an unstable network. Ask again.',
  },

  summary: {
    /** Amounts for the model, always in CNY */
    money: (v: number) => {
      const abs = Math.abs(v);
      const text =
        abs >= 1e6 ? `¥${Number((abs / 1e6).toFixed(2))}M` : abs >= 1e4 ? `¥${Number((abs / 1e3).toFixed(1))}K` : `¥${Math.round(abs)}`;
      return v < 0 && text !== '¥0' ? `-${text}` : text;
    },
    sep: '; ',
    totals: (total: string, invested: string, gain: string, gainPct: string | null) =>
      `Total assets about ${total}, net invested ${invested}, cumulative gain ${gain}${gainPct ? ` (${gainPct})` : ''}.`,
    targets: (items: string) => `Target vs current: ${items}`,
    slot: (name: string, current: string, target: string) => `${name} ${current}%/${target}%`,
    slotNoTarget: (name: string, current: string) => `${name} ${current}% (no target)`,
    untargeted: (mode: UndefinedMode) =>
      `; assets without a target are ${mode === 'sell' ? 'suggested for sale when rebalancing' : 'left out of rebalancing'}`,
    rules: (threshold: string, period: Period, checked: boolean, untargeted: string) =>
      `Drift threshold ±${threshold}%, checked every ${PERIOD_NOUNS_EN[period]}, ${checked ? 'already checked' : 'not checked yet'} this ${PERIOD_NOUNS_EN[period]}${untargeted}.`,
    accounts: (items: string) => `Accounts: ${items}`,
    account: (name: string, kind: string, pct: string) => `${name} (${kind}) ${pct}%`,
    kinds: { bank: 'bank', usdBroker: 'USD broker', cnyBroker: 'CNY broker' },
    performance: (since: string | null, items: string) => `${since ? `Since ${since}` : 'Over the last year'}, by asset: ${items}`,
    reached: 'already reached',
    unreachable: 'out of reach on current assumptions',
    expected: (year: number) => `expected in ${year}`,
    retirement: (spend: string, target: string, returnPct: string, inflationPct: string, when: string) =>
      `Retirement goal: spending ${spend} a year, target ${target}, expected return ${returnPct}% a year, inflation ${inflationPct}%, ${when}.`,
  },

  /** The system prompt: how to answer (as in the prototype), the web line, then the summary */
  prompt: (web: boolean, summary: string) =>
    `You are the user's private investment advisor: calm, professional and direct. Answer in English in 2–4 points, under 150 words, without markdown headings or bold. ${
      web ? 'You may draw on what you know of recent markets and the economy.' : "Answer from the user's data only."
    } End with a very short reminder that this is not investment advice.\n\nThe user's portfolio:\n${summary}`,
};

export const zh: typeof en = {
  title: 'AI 投顾',
  newTitle: '新对话',
  suggestions: ['我的组合风险集中在哪？', '这笔 ¥10 万该怎么投？', '美债超配要不要现在调？', '离退休目标还差多少？'],
  me: '我',
  avatarMe: '我',
  history: '历史对话',
  newConversation: '+ 新对话',
  dataRead: '已读取 计划 · 持仓 · 收益',
  web: (on) => `联网分析 · ${on ? '开' : '关'}`,
  ask: '问问你的组合',
  askPlaceholder: '问问你的组合…',
  send: '发送',
  busy: 'AI 投顾正在分析…',
  changeKey: '更换 Key',
  keyNotSaved: 'Key 没能保存在这台设备上，下次需要重新填写',
  meta: (month, day, time, messages) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${time} · ${messages} 条消息`,
  connection: (provider, model) => `${provider} · ${model} · 已连接`,
  welcome: (provider, model, total, offCount, biggest) =>
    `已连接 ${provider} · ${model}。我读取了你的计划、持仓和收益数据：总资产约 ${total}，${
      offCount > 0 && biggest ? `目前 ${offCount} 项资产偏离目标，最大的是${biggest}` : '目前各项资产都在目标范围内'
    }。\n想从哪里聊起？`,

  setup: {
    title: '连接你自己的大模型',
    text: '填入 API Key 后，AI 投顾会读取你的计划、持仓和收益，帮你分析组合。',
    promises: ['· Key 只加密保存在本机，不上传到我们的服务器', '· 对话时，数据直接从手机发给你选的模型服务商', '· 随时可以在这里断开或更换'],
    provider: '模型服务商',
    providers: [
      { name: 'DeepSeek', desc: '国内 · OpenAI 兼容接口', tag: '第一期' },
      { name: '通义千问 · Kimi · 智谱', desc: '国内', tag: '即将支持' },
      { name: 'Claude · OpenAI · Gemini', desc: '海外', tag: '即将支持' },
    ],
    base: '接口地址（OpenAI 兼容格式）',
    model: '模型',
    consent: (provider) => `我同意在对话时，把计划、持仓、收益的汇总数据发送给 ${provider} 用于分析。不会发送账户号和登录信息。`,
    testing: '测试中…',
    test: '测试连接',
    start: '开始对话',
  },

  test: {
    failTitle: '连接失败',
    needKey: '请先填写 API Key',
    needBase: '请先填写接口地址',
    needHttps: '接口地址要以 https:// 开头',
    needModel: '请先填写模型',
    testingTitle: '正在测试连通性…',
    testingMessage: (url) => `请求 ${url}`,
    modelMissingTitle: '模型不可用',
    modelMissing: (wanted, models) => `连接成功，但可用模型里没有 ${wanted}。可用模型：${models.join('、')}`,
    okTitle: '连接成功',
    ok: (latencyMs, models) => `延迟 ${latencyMs}ms · 可用模型：${models.join('、')}`,
    unauthorized: '401 鉴权失败：API Key 无效或已过期',
    noBalance: (provider) => `402 余额不足：请到 ${provider} 控制台充值`,
    failed: (status) => `${status} 请求失败：请检查接口地址`,
    timeout: '连接超时：请检查网络或接口地址',
    network: '无法连接：请检查网络和接口地址',
  },

  chatError: {
    unauthorized: '401 鉴权失败：API Key 无效或已过期，可以在历史对话里「更换 Key」',
    noBalance: (provider) => `402 余额不足：请到 ${provider} 控制台充值`,
    tooMany: '请求太频繁：稍等一会儿再问',
    unavailable: (provider, status) => `${provider} 暂时不可用（${status}），稍后再试`,
    failed: (status) => `${status} 请求失败：请检查接口地址和模型`,
    timeout: '等待回复超时：请检查网络后再问一次',
    network: (provider) => `无法连接 ${provider}：请检查网络`,
    broken: '回复中断：网络不稳定，请再问一次',
  },

  summary: {
    /** Under 10,000 as whole yuan; otherwise in 「万」 (one decimal place, with no .0 on whole numbers) */
    money: (v) => {
      const abs = Math.abs(v);
      const text = abs >= 1e4 ? `¥${Number((abs / 1e4).toFixed(1))} 万` : `¥${Math.round(abs)}`;
      return v < 0 && text !== '¥0' ? `-${text}` : text;
    },
    sep: '；',
    totals: (total, invested, gain, gainPct) => `总资产约 ${total}，净投入 ${invested}，累计收益 ${gain}${gainPct ? `（${gainPct}）` : ''}。`,
    targets: (items) => `目标组合 vs 当前：${items}`,
    slot: (name, current, target) => `${name} ${current}%/${target}%`,
    slotNoTarget: (name, current) => `${name} ${current}%（未设目标）`,
    untargeted: (mode) => `；未设目标的资产${mode === 'sell' ? '再平衡时建议卖出' : '不参与再平衡'}`,
    rules: (threshold, period, checked, untargeted) =>
      `偏离阈值 ±${threshold}%，${PERIODS_ZH[period]}检查，本${PERIODS_ZH[period]}${checked ? '已检查' : '还没检查'}${untargeted}。`,
    accounts: (items) => `账户：${items}`,
    account: (name, kind, pct) => `${name}（${kind}）占 ${pct}%`,
    kinds: { bank: '银行', usdBroker: '美元券商', cnyBroker: '人民币券商' },
    performance: (since, items) => `${since ? `自 ${since} 以来` : '近 1 年'}各资产表现：${items}`,
    reached: '已经达成',
    unreachable: '按当前假设无法达成',
    expected: (year) => `预计 ${year} 年达成`,
    retirement: (spend, target, returnPct, inflationPct, when) =>
      `退休目标：年支出 ${spend}，目标 ${target}，预期年化 ${returnPct}%，通胀 ${inflationPct}%，${when}。`,
  },

  prompt: (web, summary) =>
    `你是用户的私人投资顾问，风格冷静、专业、直接。用中文回答，分 2-4 个要点，总长不超过 200 字，不用 markdown 标题和加粗。${
      web ? '可以结合你了解的近期市场与宏观情况。' : '只基于用户数据回答。'
    }最后一句提醒这不构成投资建议（很短）。\n\n用户组合数据：\n${summary}`,
};
