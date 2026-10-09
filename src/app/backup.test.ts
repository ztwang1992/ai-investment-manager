import { describe, expect, it } from 'vitest';
import { backupJson, csvCell, transactionsCsv } from './backup';
import { MESSAGES } from '../i18n';
import type { Transaction } from '../domain/types';
import * as mock from '../mock';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 't',
  date: '2026-09-02',
  createdAt: '2026-09-02T01:00:00.000Z',
  type: 'buy',
  accountId: 'futu',
  instrumentCode: 'VOO',
  qty: 10,
  price: 528,
  fee: 0,
  fxToCny: 7.1,
  ...over,
});
const names: Record<string, string> = { futu: 'Futu', ibkr: 'IBKR', odd: 'Tiger, US' };
const accountName = (id: string) => names[id] ?? id;
const en = MESSAGES.en;

describe('csvCell', () => {
  it('leaves plain values alone and quotes commas, quotes and line breaks', () => {
    expect(csvCell('Futu')).toBe('Futu');
    expect(csvCell(528)).toBe('528');
    expect(csvCell('Tiger, US')).toBe('"Tiger, US"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
});

describe('transactionsCsv', () => {
  it('starts with a header and names the types in the interface language', () => {
    const [header, row] = transactionsCsv([tx({})], accountName, en).split('\r\n');
    expect(header).toBe('Date,Type,Account,Code,Quantity,Price,Fee,Remark');
    expect(row).toBe('2026-09-02,Buy,Futu,VOO,10,528,,');
  });

  // The prototype's header and type names
  it('writes the header and types in Chinese for the Chinese interface', () => {
    const [header, row] = transactionsCsv([tx({})], (id) => (id === 'futu' ? '富途' : id), MESSAGES.zh).split('\r\n');
    expect(header).toBe('日期,类型,账户,代码,数量,价格,手续费,备注');
    expect(row).toBe('2026-09-02,买入,富途,VOO,10,528,,');
  });

  it('lists transactions oldest first', () => {
    const csv = transactionsCsv(
      [tx({ id: 'b', date: '2026-09-03', type: 'sell' }), tx({ id: 'a', date: '2026-09-01', type: 'deposit', instrumentCode: 'USD', qty: 100, price: 1, reason: 'Salary' })],
      accountName,
      en,
    );
    expect(csv.split('\r\n').slice(1)).toEqual(['2026-09-01,Deposit,Futu,USD,100,1,,Salary', '2026-09-03,Sell,Futu,VOO,10,528,,']);
  });

  it('escapes awkward account names and strips floating-point noise', () => {
    const csv = transactionsCsv([tx({ accountId: 'odd', qty: 7.000000000000001, fee: 1.5 })], accountName, en);
    expect(csv.split('\r\n')[1]).toBe('2026-09-02,Buy,"Tiger, US",VOO,7,528,1.5,');
  });

  it('exports the whole sample ledger with a row per transaction', () => {
    const csv = transactionsCsv(mock.transactions, (id) => (id === 'futu' ? 'Futu' : id), en);
    expect(csv.split('\r\n')).toHaveLength(mock.transactions.length + 1);
    expect(csv).toContain(',Opening balance,');
    // A remark the app wrote reads like it does on screen
    expect(csv).toContain(',Calibration,Futu,VOO,110,0,,Dividends reinvested');
  });
});

describe('backupJson', () => {
  it('writes everything needed to rebuild the portfolio, and reads back unchanged', () => {
    const data = {
      exportedAt: '2026-09-30T08:00:00.000Z',
      accounts: mock.accounts,
      exposures: mock.exposures,
      instruments: mock.instruments,
      transactions: mock.transactions,
      targets: mock.targets,
      ownStock: mock.ownStock,
      plan: mock.plan,
    };
    const parsed = JSON.parse(backupJson(data));
    expect(parsed).toMatchObject({ app: 'invest-manager', version: 1, ...data });
  });
});
