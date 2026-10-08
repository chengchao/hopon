# hopon

一句话创造小游戏，上下滑动发现并试玩。iOS / Android 应用，产品界面、示例和默认生成内容均为英语。只有发现和创造两个页面；可以点赞、评论和收藏，没有回复、关注或消息功能。

```
apps/mobile/   Expo 应用（Expo Router、React Native Reusables/shadcn + NativeWind、Clerk 邮箱验证码登录）
apps/api/      Cloudflare Worker API（D1 + Drizzle、Workers AI、Clerk JWT 校验）
```

技术栈：Expo SDK 57、Cloudflare Workers、D1、Drizzle ORM、Workers AI、Clerk。无外部生成服务或游戏引擎。

## 准备

需要 Node.js 24+、pnpm 12（`package.json` 固定为 12.9.1，已安装的 pnpm 会自动切换）、Xcode（iOS 模拟器）或 Android Studio（模拟器）。

1. 在 [Clerk 控制台](https://dashboard.clerk.com) 创建应用：开启 Email address + Email verification code，开启 Native API。若需应用内删除账户，确认允许用户删除账户。
2. 应用环境变量写入 `apps/mobile/.env`（已被 git 忽略）：

   ```sh
   EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   EXPO_PUBLIC_API_URL=http://localhost:8787   # Android 模拟器用 http://10.0.2.2:8787，真机用电脑局域网 IP
   ```

3. Worker 用 Clerk 公钥离线校验登录（控制台 API keys → Show JWT public key → PEM Public Key），本地写入 `apps/api/.dev.vars`：

   ```sh
   printf 'CLERK_JWT_KEY="%s"\n' "$(cat clerk-public-key.pem)" >> apps/api/.dev.vars
   ```

## 本地运行

```sh
pnpm install --frozen-lockfile
pnpm run db:local
pnpm run api:offline   # 终端 1：本地 API，不连接 Workers AI
pnpm run ios           # 终端 2：Expo Go + iOS 模拟器（或 pnpm run android）
```

离线模式可以浏览和试玩两个原创游戏、登录、检查布局；生成会提示需要连接 Workers AI，评论不经 Screening 直接发出。要真实生成，先 `pnpm -F api exec wrangler login`，再用 `pnpm run api` 代替 `api:offline`。D1 仍是本地 SQLite；只有 AI 推理访问 Cloudflare，会消耗该账号 Workers AI 额度。模型配置在 `apps/api/wrangler.jsonc` 的 `AI_MODEL`，当前为 `@cf/moonshotai/kimi-k2.5`（`thinking: false`，最多 6000 tokens），输出经 JSON 与完整 HTML 校验后保存为私有草稿。想法句子和评论先经 Llama Guard 3（`@cf/meta/llama-guard-3-8b`）Screening，3 秒内没有结论就拒绝。

## 数据库（Drizzle）

表结构在 `apps/api/src/schema.ts`。修改后生成迁移并应用：

```sh
pnpm run db:generate --name <feature>   # drizzle-kit 写入 apps/api/migrations/（与 wrangler 的 migrations_dir 相同），文件名后缀为功能名，如 _comments
pnpm run db:local
```

`*_baseline.sql` 由 `schema.ts` 生成完整表结构；Toast Panic 和 Odd Duck 由 `*_originals.sql`（`drizzle-kit generate --custom`）作为普通已发布游戏写入。已在任何共享数据库上应用过的迁移只追加、不修改。

## 部署

已配置用户选择的 Chengchao60827@gmail.com 账号及专用 hopon D1 数据库（迁移到其他账号时才需要 `wrangler d1 create hopon`，并同时更新 `apps/api/wrangler.jsonc` 的 `account_id` 和 `apps/api/package.json` 里 `db:remote`、`deploy` 的 `CLOUDFLARE_ACCOUNT_ID`）。

```sh
pnpm -F api exec wrangler secret put CLERK_JWT_KEY < clerk-public-key.pem
pnpm run deploy
```

`deploy` 先应用远程迁移（`db:remote`，需确认）再部署 Worker：新代码可能写入新列，而迁移只追加，正在运行的旧 Worker 不受影响。

远程命令报 `[code: 7403]` 时先重跑一次：wrangler 的 OAuth 令牌过期后，刷新令牌的那一次请求会失败。仍然失败就运行 `pnpm -F api exec wrangler whoami`，Token Permissions 里没有 `d1` 和 `workers` 时，令牌权限不足，用 `pnpm -F api exec wrangler login` 重新登录。

Worker 提供 `/api/*` 和两个静态页面：`/terms`（Rules，标题为 Terms of Use）与 `/support`（联系地址，即 App Store 的 Support URL）。原网页前端已移除。应用商店构建与提交（EAS）尚未配置。

## 检查

```sh
pnpm run check
```

`check` 还包括 oxlint 与 oxfmt 格式检查（`pnpm run lint`、`pnpm run format`）。`pnpm install` 会通过 lefthook 安装 git hooks：提交前对暂存文件运行 oxlint 和 oxfmt（自动格式化并重新暂存），提交信息须符合 Conventional Commits（commitlint）。

Worker 测试在 wrangler 提供的真实本地 D1（workerd）上运行迁移后执行：权限、Clerk token（过期、伪造、他人草稿）、分页、按账户的原子配额、草稿恢复；原创游戏逻辑测试直接读取迁移中的 HTML；另有应用与 Worker 的 TypeScript 检查。AI 返回值是模拟的，不能证明真实模型输出可玩；每次真实生成后仍需在预览中试玩，再发布。

## 实现边界

- 浏览和试玩无需登录；创建和发布需要 Clerk 邮箱验证码登录（新邮箱自动注册）。身份是 Clerk 用户 ID（JWT `sub`），存入 `games.owner`。Bearer token 不会被自动携带，因此无需 CSRF 检查。Clerk token 约 60 秒过期，应用每次请求都取新 token。
- 草稿仅拥有者可预览（WebView 首次加载携带 Bearer 头）。服务器保留最新未发布草稿（`/api/drafts/latest`），应用被杀后重开创建页可恢复；不做草稿列表。创建页可退出登录和删除账户；删除账户后已发布游戏仍保留。
- 游戏在 WebView 中运行。原生 WebView 没有 iframe 的 `sandbox` 属性，隔离依赖响应 CSP（`sandbox allow-scripts`，禁止网络、表单、嵌套框架和同源权限），并禁止导航、新窗口、文件访问、共享存储和与应用的消息桥。沙箱不是 CPU 配额，错误的游戏代码仍可能卡住 WebView。
- 每个 Clerk 账户每个 UTC 日最多 10 次生成尝试，失败也计数；批量注册可绕过，依赖 Clerk 的注册防护。
- 评论：任何人可读；发表需登录并有 @handle，只能评论已发布游戏，1–300 字纯文本，每个账户每个 UTC 日最多 100 条。评论者本人或游戏创作者可删除（硬删除）。删除账户后评论保留，显示发表时的 handle。
- 收藏（Save）：仅本人可见，不显示收藏数；需要登录（未登录不在设备上暂存），只能收藏已发布游戏。收藏列表按收藏时间倒序分页；从列表点开进入收藏流，从所点游戏开始向更早的收藏滑动。删除账户后收藏保留。
- 公开游戏按 ID 倒序游标分页。游戏区域只处理游戏输入；名称与描述区域负责上下滑动（每次最多一款，松开吸附），读屏用户可用调节手势切换；开启“减少动态效果”时不播放滚动动画。当前及相邻游戏预加载（最多三个 WebView），更远的卸载，因此回来时游戏可能重置。
- 上架前仍需：举报/屏蔽/审核机制，须同时覆盖游戏和评论（App Store 用户生成内容规则 1.2）、EAS 构建与提交、图标与启动图。
- `sharp` 覆盖为安全补丁 `^0.35.4`，修复 wrangler 本地工具链传递依赖的漏洞；产品不做图片处理。

研究与依据：[UI/UX 观察及取舍](docs/uiux-research.md)、[技术核对](docs/technical-research.md)（其中 TanStack 部分描述的是已移除的网页前端）。
