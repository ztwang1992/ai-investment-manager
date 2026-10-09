// Data source responses for the tests, captured live on 2026-10-01. Tencent and Sina are GBK, already converted to ASCII by gbkAscii (Chinese characters became "?").
// Yahoo answered this machine with 429 at the time, so its responses are built from the format recorded in phase 0 (docs/phase0-feasibility.md section 5).

export const TENCENT = [
  'v_usVOO="200~??500 ETF-Vanguard~VOO.AM~700.86~702.46~704.58~9876125~0~0~703.61~280~0~0~0~0~0~0~0~0~703.70~320~0~0~0~0~0~0~0~0~~2026-09-30 16:00:01~-1.60~-0.23~707.20~700.56~USD~9876125~6955068418~~~~~~0.95~~~Vanguard Index Funds S&P 500 Etf Usd~~714.53~575.28~-40~~~~12.72~-0.69~GP-ETF~~~1.36~0.34~2.27~~~1.10~~~704.23~~~~1462278000~";',
  'v_usBRK.B="200~????B~BRK.B.N~497.95~502.35~501.43~7050909~0~0~498.25~280~0~0~0~0~0~0~0~0~498.65~80~0~0~0~0~0~0~0~0~~2026-09-30 16:05:57~-4.40~-0.88~502.12~497.95~USD~7050909~3518830955~0.33~12.52~~16.04~~0.83~6212.48999~10659.66442~Berkshire Hathaway Inc. New~39.77~537.74~464.01~200~1.43~~10659.66442~-0.94~-1.82~GP~12.11~7.07~-4.20~-0.87~-1.20~2140709794~1247613213~1.93~15.01~~499.06~~~~~";',
  'v_sh513500="1~??500ETF??~513500~2.688~2.690~2.687~994951~502921~492030~2.687~890~2.686~9465~2.685~3947~2.684~474~2.683~520~2.688~26687~2.690~70~2.693~90~2.699~202~2.700~245~~20260930161435~-0.002~-0.07~2.711~2.686~2.688/994951/268249988~994951~26825~0.96~~~2.711~2.686~0.93~277.53~277.53~0.00~2.959~2.421~0.94~-11998~2.696~~~~~~26824.9988~33.9763~1264~   A~ETF~10.53~-1.43~~~~2.778~2.130~1.82~-1.03~6.33~10324638600~10324638600~-28.17~8.91~10324638600~9.85~2.4470~17.69~-0.74~2.4469~CNY~0~___D__F__Y~2.680~3901~";',
  'v_sz159915="51~???ETF???~159915~3.154~3.162~3.174~13081793~5520186~7561607~3.154~6726~3.153~15754~3.152~19580~3.151~11260~3.150~29270~3.155~5772~3.156~10794~3.157~5394~3.158~4469~3.159~5298~~20260930161421~-0.008~-0.25~3.192~3.142~3.154/13081793/4142874903~13081793~414287~6.31~~~3.192~3.142~1.58~653.84~653.84~0.00~3.794~2.530~0.78~50863~3.167~~~~~~414287.4903~713.5294~22623~   A~ETF~-1.00~-7.78~~~~4.395~2.873~-3.49~-7.56~-19.79~20730454936~20730454936~44.49~-3.87~20730454936~-0.06~3.1560~-1.96~0.00~3.1551~CNY~0~~3.145~8434~";',
  'v_sh600519="1~????~600519~1258.62~1235.58~1239.53~38331~21633~16698~1258.62~14~1258.44~1~1258.16~1~1258.05~2~1258.00~41~1258.65~2~1258.66~3~1258.68~1~1258.69~2~1258.75~80~~20260930161458~23.04~1.86~1268.00~1236.05~1258.62/38331/4797246636~38331~479725~0.31~19.32~~1268.00~1236.05~2.59~15733.78~15733.78~6.26~1359.14~1112.02~1.36~-29~1251.53~17.67~19.11~~~0.06~479724.6636~453.1032~36~   A~GP-A~-6.71~0.38~4.13~32.41~27.30~1539.98~1151.01~-1.11~-3.15~5.87~1250081601~1250081601~-19.73~-9.97~1250081601~~~-9.58~0.16~~CNY~0~___D__F__N~1257.93~15~";',
  '',
].join('\n');

/** The response to looking up a single code Tencent doesn't know; when looking up several, unknown ones are simply absent */
export const TENCENT_NONE = 'v_pv_none_match="1";\n';

export const SINA = [
  'var hq_str_gb_voo="Vanguard??500??ETF,700.8600,-0.23,2026-10-01 09:42:58,-1.6000,704.5800,707.2000,700.5600,716.3900,576.4980,9876125,10813434,1026743790032,0.00,--,0.00,0.00,0.00,0.00,1464977014,0,703.6700,0.40,2.81,Sep 30 07:59PM EDT,Sep 30 04:00PM EDT,702.4600,2189301,1,2026,6947864965.0000,704.7978,663.6937,1535122413.8974,700.6900,702.4600";',
  'var hq_str_gb_brk$b="????B,497.9500,-0.88,2026-10-01 09:46:25,-4.4000,501.4300,502.1200,497.9500,537.7400,464.0100,7050904,5149268,1065966454371,33.59,14.820000,0.00,0.00,0.00,0.00,2140709819,69,498.6400,0.14,0.69,Sep 30 07:59PM EDT,Sep 30 04:04PM EDT,502.3500,2661011,1,2026,3518909958.0000,523.0963,478.6422,1325229485.5929,498.1100,502.4200";',
  'var hq_str_sh513500="??500ETF??,2.687,2.690,2.688,2.711,2.686,2.687,2.688,99495124,268249988.000,89000,2.687,946500,2.686,394700,2.685,47400,2.684,52000,2.683,2668700,2.688,7000,2.690,9000,2.693,20200,2.699,24462,2.700,2026-09-30,15:34:59,00,D|126400|339763.20";',
  'var hq_str_sz159915="???,3.174,3.162,3.154,3.192,3.142,3.154,3.155,1308179333,4142874902.909,672577,3.154,1575400,3.153,1958000,3.152,1126000,3.151,2927000,3.150,577200,3.155,1079400,3.156,539400,3.157,446900,3.158,529800,3.159,2026-09-30,16:29:15,00,D|2262300|7135294.200";',
  'var hq_str_f_050025="????500ETF??A(???),5.563,5.622,5.571,2026-09-29,11.7739";',
  'var hq_str_f_000216="????ETF??A,3.1359,3.1359,3.103,2026-09-30,31.9511";',
  'var hq_str_gb_nope1="";',
  'var hq_str_f_999999="";',
  'var hq_str_fx_susdcny="03:00:00,6.7050000000,6.7072000000,6.7050000000,51.0000000000,6.7050000000,6.7072000000,6.7021000000,6.7050000000,?????,0.0000,0.0000,0.0051,????????????,0.0000,0.0000,,2026-10-01";',
  'var hq_str_fx_shkdcny="11:16:43,0.8544890583,0.8544890583,0.8544817568,1.6794200000,0.8544452514,0.8545912917,0.8544233497,0.8544890583,??????,0.0009,0.0000,0.0002,????????????,0.0000,0.0000,,2026-10-01";',
  '',
].join('\n');

export const FUND_APP = {
  Datas: [
    { FCODE: '050025', SHORTNAME: '博时标普500ETF联接A', PDATE: '2026-09-29', NAV: '5.5630', ACCNAV: '5.6220', NAVCHGRT: '-0.14', GSZ: null },
    { FCODE: '000216', SHORTNAME: '华安黄金ETF联接A', PDATE: '2026-09-30', NAV: '3.1359', ACCNAV: '3.1359', NAVCHGRT: '1.06', GSZ: null },
  ],
  ErrCode: 0,
  Success: true,
  TotalCount: 3,
};

export const F10 = {
  Data: { LSJZList: [{ FSRQ: '2026-09-29', DWJZ: '5.5630', LJJZ: '5.6220', JZZZL: '-0.14', SGZT: '暂停申购', SHZT: '开放赎回' }], FundType: '007' },
  ErrCode: 0,
  TotalCount: 3392,
  PageSize: 1,
  PageIndex: 1,
};

/** A fund F10 can't find */
export const F10_EMPTY = { Data: { LSJZList: [], FundType: '' }, ErrCode: 0, TotalCount: 0, PageSize: 1, PageIndex: 1 };

/** frankfurter's current rate: 10-01's isn't published yet, so it returns 09-30's */
export const FRANKFURTER_LATEST = { amount: 1.0, base: 'USD', date: '2026-09-30', rates: { CNY: 6.7045, HKD: 7.8463 } };

/** frankfurter asked for a Sunday (09-27) returns the previous business day (09-25) */
export const FRANKFURTER_WEEKEND = { amount: 1.0, base: 'USD', date: '2026-09-25', rates: { CNY: 6.7132, HKD: 7.844 } };

const yahooChart = (meta: Record<string, unknown>, timestamp: number[] = [], close: (number | null)[] = []) => ({
  chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] } }], error: null },
});

/** 2026-09-30 16:00:01 New York = 20:00:01 UTC */
export const YAHOO_VOO = yahooChart({ currency: 'USD', symbol: 'VOO', regularMarketPrice: 700.86, regularMarketTime: 1790798401 });
export const YAHOO_BRK = yahooChart({ currency: 'USD', symbol: 'BRK-B', regularMarketPrice: 497.95, regularMarketTime: 1790798757 });
/** 2026-09-30 15:00 Beijing = 07:00 UTC */
export const YAHOO_513500 = yahooChart({ currency: 'CNY', symbol: '513500.SS', regularMarketPrice: 2.688, regularMarketTime: 1790751600 });
export const YAHOO_NOT_FOUND = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } };

/** USD/CNY daily bars. FX bars are stamped 23:00 UTC the day before: 1790204400 = 09-23 23:00 UTC, which is 09-24's data */
export const YAHOO_CNY_DAILY = yahooChart(
  { currency: 'CNY', symbol: 'CNY=X', regularMarketPrice: 6.7052, regularMarketTime: 1790751600 },
  [1790204400, 1790290800, 1790550000, 1790636400, 1790722800],
  [6.712, 6.7132, null, 6.706, 6.7045],
);
export const YAHOO_HKD_DAILY = yahooChart(
  { currency: 'CNY', symbol: 'HKDCNY=X', regularMarketPrice: 0.8545, regularMarketTime: 1790751600 },
  [1790204400, 1790290800, 1790550000, 1790636400, 1790722800],
  [0.8556, 0.8558, 0.855, 0.8547, 0.8545],
);
export const YAHOO_CNY = yahooChart({ currency: 'CNY', symbol: 'CNY=X', regularMarketPrice: 6.7052, regularMarketTime: 1790751600 });
export const YAHOO_HKD = yahooChart({ currency: 'CNY', symbol: 'HKDCNY=X', regularMarketPrice: 0.8545, regularMarketTime: 1790751600 });
