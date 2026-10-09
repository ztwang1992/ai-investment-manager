# 阶段 0 可行性验证结果

2026-09-30。测试用 Worker `spike-phase0` 绑定过 api.example.com 和 app.example.com。验证完已经删掉了 Worker、两个域名的绑定和 `spikes/` 代码，所以现在这两个地址打不开，阶段 4 和阶段 7 部署正式版时再绑定。本文件保留结论和接入细节，供阶段 4 使用。

## 1. 验收结论

- [x] 手机 4G 能打开 app.example.com 和 api.example.com
- [x] 每类数据都有在 Worker 里能稳定访问的主用源和备用源（见第 3 节）
- [x] 手机 4G 访问 Supabase（新加坡）的延迟可以接受：之后的请求中位数 113 ms

## 2. 访问速度

**手机**：iPhone（iOS 18.7），中国电信 4G（上海，ASN 4134），不连 Wi-Fi。

| 访问 | 进入的 Cloudflare 机房 | 第 1 次（含建连） | 之后中位数 |
|---|---|---|---|
| 打开 app 页面 | DFW（达拉斯） | 701 ms | — |
| api /ping | AMS（阿姆斯特丹） | 764 ms | 179 ms（6 次里有 1 次 759 ms） |
| Supabase（新加坡） | — | 652 ms | 113 ms |

**本机**（国内网络，直连和走代理都一样）：两个域名都进入 SJC（圣何塞），首次约 0.9–1.1 秒。Google、阿里、DNSPod、114 的公共 DNS 都能解析。

免费计划在国内没有机房，国内用户会被分到海外机房，而且不固定（这次是 DFW、AMS、SJC）。所以选数据源时，要选各个机房都能访问的。

## 3. 推荐

主用和备用来自不同的服务商，一家出问题不会同时失效。

| 类别 | 主用 | 备用 | 第三 |
|---|---|---|---|
| 美股 / 美股 ETF | 腾讯 | Yahoo | 新浪 |
| A股 / A股 ETF | 腾讯 | Yahoo | 新浪 |
| 场外基金净值 | 新浪 | 天天基金 App 接口 | 天天基金 F10 |
| 汇率（当前 + 历史） | frankfurter（欧央行） | Yahoo | 新浪即期（只有当前值） |

汇率为什么用欧央行：
- 当前汇率、每日快照、「记账当天的汇率」三处用同一个源、同一种价格，本金线和市值才对得上。
- 它能按日期查历史，和市场价只差约 0.02%。
- 缺点是每个工作日只更新一次，周末和节假日沿用上一个工作日的汇率。对长期持仓的记账够用。

外汇交易中心的中间价从 SJC 能访问，但从 AMS 返回 403，不作为备用。

阶段 4 可以考虑：交易时段用 Cron 定时预取行情写进 KV。从海外机房请求国内数据源要 0.8–2 秒，预取后用户打开 App 时基本都能直接命中缓存。

## 4. 数据源实测明细

- **SJC**：共 12 轮，每一轮所有源各请求一次，同时最多 4 个连接；「Yahoo」一行只测了 3 轮。
- **AMS**：手机那次 1 轮。
- 延迟是 Worker 到数据源的时间，SJC 取中位数。

| 类别 | 来源 | SJC 成功 | SJC 延迟 | AMS | 请求头 | 备注 |
|---|---|---|---|---|---|---|
| 美股 | 腾讯 | 12/12 | 238 ms | ✓ 1948 ms | 无 | 可批量；GBK；时间为美东时间 |
| 美股 | Yahoo | 15/15 | 75 ms | ✓ 100 ms | 建议带 UA | 一次一个代码；本机经代理时遇到过 429 |
| 美股 | 新浪 | 12/12 | 578 ms | ✓ 2249 ms | Referer | 可批量；时间字段是服务器时间，不是成交时间 |
| 美股 | 东方财富 push2 | 0/12 | — | ✗ 502 | — | 不能用 |
| 美股 | Stooq | 0/12 | — | ✗ 404 | — | 接口已下线，不能用 |
| A股 | 腾讯 | 12/12 | 238 ms | ✓ 790 ms | 无 | 可批量；GBK |
| A股 | Yahoo | 3/3 | 45 ms | ✓ 49 ms | 建议带 UA | 代码加 .SS / .SZ；一次一个代码 |
| A股 | 新浪 | 12/12 | 608 ms | ✓ 2051 ms | Referer | 可批量 |
| A股 | 东方财富 push2 | 1/12 | — | ✗ 502 | — | 大多返回 502，不能用 |
| 基金净值 | 新浪 | 12/12 | 156 ms | ✓ 2197 ms | Referer | 可批量；带净值日期 |
| 基金净值 | 天天基金 App 接口 | 12/12 | 1.3 s | ✓ 1752 ms | 无 | 可批量；JSON |
| 基金净值 | 天天基金 F10 | 12/12 | 1.5 s | ✓ 1871 ms | Referer | 一次一只；能查历史净值 |
| 基金净值 | 天天估值 | 0/12 | — | ✗ | — | QDII 基金（如 050025）没有估值，不能用 |
| 汇率 | frankfurter（欧央行） | 12/12 | 24 ms | ✓ 88 ms | 无 | 能查历史；本身在 Cloudflare 上 |
| 汇率 | Yahoo CNY=X | 3/3 | 48 ms | ✓ 43 ms | 建议带 UA | 实时；能查历史 |
| 汇率 | 新浪即期 | 12/12 | 157 ms | ✓ 191 ms | Referer | 实时；不方便查历史 |
| 汇率 | 腾讯即期 | 12/12 | 228 ms | ✓ 768 ms | 无 | 实时；不方便查历史 |
| 汇率 | 外汇交易中心中间价 | 12/12 | 590 ms | ✗ 403 | 无 | 官方中间价；部分海外机房被拒 |
| 汇率 | er-api | 12/12 | 10 ms | ✓ 15 ms | 无 | 每天 00:00 UTC 更新；免费版不能查历史；条款要求署名 |
| 汇率 | 东方财富 push2 | 0/12 | — | ✗ 502 | — | 不能用 |

数据时效（测试时，北京时间 9 月 30 日晚）：
- 美股开盘前是上一个收盘（09-29 16:00 美东）。开盘后（21:42–21:44 在 SJC 测了 3 轮），腾讯、新浪、Yahoo 都是实时的，成交时间比请求时间晚 10–20 秒，三家价格一致。腾讯偶尔很慢（最慢 4.4 秒）。
- A股是当日收盘。10 月 1–7 日休市，盘中时效没测；新浪、腾讯的 A 股行情一般是实时的。
- 050025 的净值日期是 09-29。
- 欧央行汇率是 09-29 的。
- 中间价是 09-30 9:15 的。
- 即期和 Yahoo 汇率是实时的。

同一时刻的 USD/CNY：中间价 6.7351，新浪/腾讯即期 6.7046，Yahoo 6.6965，欧央行 6.7034（09-29）。中间价和市场价差了约 0.45%。

限流：SJC 的 12 轮和 AMS 的 1 轮里，没有遇到 429（东方财富的 502、中间价的 403 除外）。阶段 4 按 README 用 KV 缓存（交易时段 15 分钟，其他 6 小时），每天对每个源只有几十到一两百次请求。

Worker 运行时能解码 GBK（`new TextDecoder('gbk')` 可用）。

## 5. 接入细节（阶段 4 用）

- **腾讯** `https://qt.gtimg.cn/q=usVOO,sh513500,sz159915,whUSDCNY`
  - 返回 GBK 文本，每行 `v_代码="字段~字段~…"`。
  - [2] 是代码，[3] 是现价。
  - 美股的成交时间是美东时间 `YYYY-MM-DD HH:MM:SS`，A股的 [30] 是北京时间 `YYYYMMDDHHMMSS`。
  - 汇率的 [5] 是时间。
  - 代码规则：美股 `us`+代码；上交所 `sh`（6、5 开头），深交所 `sz`（0、3、1 开头）；汇率 `whUSDCNY`、`whHKDCNY`。
- **新浪** `https://hq.sinajs.cn/list=gb_voo,sh513500,f_050025,fx_susdcny`
  - 必须带 `Referer: https://finance.sina.com.cn`，否则 403。返回 GBK，每行 `var hq_str_代码="字段,字段,…"`。
  - A股：[3] 现价，[30] 日期，[31] 时间。
  - 美股 `gb_`+小写代码：[1] 现价。
  - 基金 `f_`+代码：[1] 单位净值，[4] 净值日期。
  - 汇率：[1] 现价，[0] 时间，最后一个字段是日期。
- **Yahoo** `https://query1.finance.yahoo.com/v8/finance/chart/{代码}?interval=1d&range=1d`
  - 代码写法：美股 `VOO`，A股 `513500.SS` / `xxxxxx.SZ`，汇率 `CNY=X`（USD/CNY）、`HKDCNY=X`。
  - 取值：`meta.regularMarketPrice`、`meta.regularMarketTime`（秒）。
  - 查历史用 `period1`/`period2`，取 `indicators.quote[0].close`。注意汇率日线的时间戳是前一天 23:00 UTC，按日期取值时要对齐。
- **天天基金 App 接口** `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=50&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=任意&Fcodes=050025,000001`
  - 返回 JSON，取 `Datas[].FCODE / NAV / PDATE`。
- **天天基金 F10** `https://api.fund.eastmoney.com/f10/lsjz?fundCode=050025&pageIndex=1&pageSize=1`
  - 必须带 `Referer: https://fundf10.eastmoney.com/`，否则返回 ErrCode -999。
  - 取 `Data.LSJZList[0].FSRQ / DWJZ`。
- **frankfurter**
  - 当前汇率 `https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD`。
  - 历史汇率 `https://api.frankfurter.dev/v1/YYYY-MM-DD?base=USD&symbols=CNY`。遇到非工作日会返回前一个工作日的数据，以返回的 `date` 为准。
  - HKD/CNY 用 `base=HKD` 查，或者用 CNY/HKD 换算。
  - 旧域名 api.frankfurter.app 会 301 跳转到新域名。
