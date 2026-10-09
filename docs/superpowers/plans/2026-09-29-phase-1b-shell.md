# 阶段 1b · 外壳、设计 token、PWA 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机尺寸的 App 外壳：Organic 设计 token、底部 5 个标签（先放占位页）、可「添加到主屏幕」的 PWA，并给出中文标题字体候选。

**Architecture:** 设计系统的 CSS 拆成三份：`tokens.css`（变量）、`base.css`（全局基础样式）、`components.css`（按钮、标签、分段控件等类名，1c 直接用）。字体用 `@fontsource` 打包进应用，不依赖 Google Fonts（国内不稳定）。外壳在手机上全屏，在宽屏上显示成原型那样的 390 × 844 手机框。PWA 用 `vite-plugin-pwa`。

**Tech Stack:** Vite 8、React 19、vite-plugin-pwa 1.3、@fontsource、Vitest 5 + Testing Library + happy-dom。

**Spec:** `design_handoff_investment_manager/README.md`（「底部 5 个标签」「设计 Token」），范围见 `BUILD_PLAN.md` 的 1b。

## Global Constraints

- 颜色、字体、圆角只能用 `src/styles/tokens.css` 里的变量，不要写死 hex（manifest 和 `theme-color` 必须写字面值，注释说明与 `--color-bg` 一致）。
- 标签栏高 78px，选中项文字 700、`--color-text`，上方 6px `--color-accent` 圆点；未选中项文字 500、`--color-neutral-600`，字号 13px。
- 界面文案用简体中文，语气冷静、简洁。
- 本阶段不接后端；各标签页只放占位。

## Review Focus

1. 有 Home 指示条的 iPhone：标签栏不能被遮住，要让出 `safe-area-inset-bottom`。→ Task 2
2. 内容很长时，页面在标签栏上方滚动，最后一行不被标签栏挡住。→ Task 2
3. 标题里的中文：Caprasimo 没有中文字形，要平稳回退到系统中文字体。→ Task 1
4. 宽屏显示手机框、手机上全屏，两种都不出现横向滚动。→ Task 2、4
5. 断开 Google 的网络环境下字体照样加载（字体文件随应用一起发布）。→ Task 1、4

---

### Task 1：样式与字体

**Files:** `src/styles/tokens.css`、`src/styles/base.css`、`src/styles/components.css`、`src/main.tsx`

- [ ] 从交接包 `styles.css` 拆出 token、基础样式、组件类名；去掉 Google Fonts 的 `@import`；字体栈加上中文回退（PingFang SC、Hiragino Sans GB、Microsoft YaHei）
- [ ] 安装 `@fontsource/caprasimo`、`@fontsource/figtree`，在入口引入 400 / 600 / 700
- [ ] 验证：`npm run build` 后 `dist/` 里有字体文件，产物里没有 `fonts.googleapis.com`

### Task 2：App 外壳与标签栏

**Files:** `src/app/tabs.ts`、`src/app/TabBar.tsx`、`src/app/AppShell.tsx`、`src/app/shell.css`、`src/pages/PlaceholderPage.tsx`、`src/App.tsx`、`src/App.test.tsx`

**Produces:**
```ts
export type TabId = 'perf' | 'plan' | 'hold' | 'rec' | 'ai';
export const TABS: readonly { id: TabId; label: string }[]; // 收益 / 计划 / 持仓 / 记录 / AI 投顾
export function TabBar(props: { active: TabId; onSelect: (id: TabId) => void }): JSX.Element;
```
- [ ] 写测试（happy-dom）：按顺序渲染 5 个标签；默认选中「收益」（`aria-current="page"`）并显示「收益」页；点「计划」后「计划」变为选中并显示计划页
- [ ] 运行失败 → 实现 → 运行通过
- [ ] 布局：标签栏底部内边距 `max(18px, env(safe-area-inset-bottom))`；内容区底部让出标签栏高度；宽度 ≥ 500px 时显示 390 × 844、圆角 44px 的手机框

### Task 3：PWA

**Files:** `vite.config.ts`、`index.html`、`public/icons/*`、`scripts/make-icons.mjs`

- [ ] `scripts/make-icons.mjs` 生成占位图标：192、512、512 maskable、180（apple-touch-icon），主色底加奶油色圆形
- [ ] `vite-plugin-pwa`：名称「投资管理器」、`display: standalone`、`lang: zh-CN`、背景和主题色与 `--color-bg` 一致、自动更新 Service Worker
- [ ] `index.html`：`viewport-fit=cover`、`theme-color`、iOS 的 `apple-mobile-web-app-*` 和 `apple-touch-icon`
- [ ] 验证：`npm run build` 生成 `manifest.webmanifest`、`sw.js`，字段正确

### Task 4：手机预览与视觉核对

- [ ] `package.json` 加 `dev:phone`（`vite --host`）和 `preview:phone`（构建后 `vite preview --host`）
- [ ] 在内置浏览器里按 390 × 844 打开，和 `screenshots/` 里的标签栏对照；宽屏检查手机框
- [ ] 写清楚手机预览步骤（同一 Wi-Fi；iPhone Safari 可以直接「添加到主屏幕」；Android 需要 HTTPS，等部署后再测）

### Task 5：中文标题字体候选

- [ ] 调研 2–3 个圆润的中文字体：许可证允许网页嵌入和商用，能按 unicode-range 分片按需加载
- [ ] 给出推荐和各自的样张链接，由用户选定；选定前中文标题用系统字体
