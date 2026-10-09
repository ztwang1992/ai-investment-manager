// Checks the preset instruments: reads the codes from a migration file and looks up each name and price on Tencent (US, A-shares) and Sina (mutual funds).
// Only for whoever maintains the preset table; not part of the app. Usage: node scripts/check-presets.mjs [migration file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'supabase/migrations/20261002000000_presets.sql';
const rows = [...readFileSync(file, 'utf8').matchAll(/\(null, '([^']+)', '([^']+)', '(美股|A股|场外基金)', '(USD|CNY)', '([^']+)'/g)].map((m) => ({
  code: m[1],
  name: m[2],
  market: m[3],
  exposure: m[5],
}));
const gbk = new TextDecoder('gbk');
const exchange = (code) => (/^[569]/.test(code) ? 'sh' : 'sz');
const symbol = (r) => (r.market === '美股' ? `us${r.code}` : r.market === 'A股' ? `${exchange(r.code)}${r.code}` : `f_${r.code}`);

const tencent = rows.filter((r) => r.market !== '场外基金');
const funds = rows.filter((r) => r.market === '场外基金');
const found = new Map();
if (tencent.length) {
  const text = gbk.decode(await (await fetch(`https://qt.gtimg.cn/q=${tencent.map(symbol).join(',')}`)).arrayBuffer());
  for (const m of text.matchAll(/v_([^=]+)="([^"]*)"/g)) {
    const f = m[2].split('~');
    found.set(m[1], `${f[1]} ${f[3]}`);
  }
}
if (funds.length) {
  const res = await fetch(`https://hq.sinajs.cn/list=${funds.map(symbol).join(',')}`, { headers: { Referer: 'https://finance.sina.com.cn' } });
  for (const m of gbk.decode(await res.arrayBuffer()).matchAll(/hq_str_([^=]+)="([^"]*)"/g)) {
    const f = m[2].split(',');
    if (m[2]) found.set(m[1], `${f[0]} 净值 ${f[1]} (${f[4]})`);
  }
}
let missing = 0;
for (const r of rows) {
  const got = found.get(symbol(r));
  if (!got) missing += 1;
  console.log(`${r.code.padEnd(8)} ${r.exposure.padEnd(10)} ${r.name.padEnd(22)} → ${got ?? '查不到'}`);
}
console.log(`\n${rows.length} 个，查不到 ${missing} 个`);
process.exitCode = missing ? 1 : 0;
