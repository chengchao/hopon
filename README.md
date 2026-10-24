# hopon

一句话创造小游戏，上下滑动发现并试玩。iOS / Android 应用，产品界面、示例和默认生成内容均为英语。只有发现和创造两个页面；可以点赞、评论和收藏，没有回复、关注或消息功能。

```
apps/mobile/   Expo 应用（Expo Router、React Native Reusables/shadcn + NativeWind、Clerk 邮箱验证码登录）
apps/worker/   Cloudflare Worker API（D1 + Drizzle、Workers AI、Clerk JWT 校验）
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

3. Worker 用 Clerk 公钥离线校验登录（控制台 API keys → Show JWT public key → PEM Public Key），本地写入 `apps/worker/.dev.vars`：

   ```sh
   printf 'CLERK_JWT_KEY="%s"\n' "$(cat clerk-public-key.pem)" >> apps/worker/.dev.vars
   ```

4. Operator 的 Ban 通过 Clerk Backend API 封禁账户，Worker 需要 Secret key（控制台 API keys → Secret keys，`sk_test_...`），同样写入 `apps/worker/.dev.vars`。它列在 `wrangler.jsonc` 的 `secrets.required` 里（只有列出的 secret 会从 `.dev.vars` 加载）；本地缺少时 wrangler 只警告，其他功能照常，只有 Ban 会失败：

   ```sh
   echo 'CLERK_SECRET_KEY=sk_test_...' >> apps/worker/.dev.vars
   ```

5. 每条新 Report 会 POST 到 Operator 的 webhook（`OPERATOR_WEBHOOK_URL`），同样列在 `secrets.required` 里。本地想试 webhook 时写入 `apps/worker/.dev.vars`；缺少时 wrangler 只警告，Report 照常保存，只是不发通知。通知末尾附有该内容在 `/operator` 上的链接。

6. Operator 在 Worker 的 `/operator` 页面处理 Report（Delete、Dismiss、Ban），用浏览器的 Basic 认证登录：用户名随意，密码是 `OPERATOR_PASSWORD`（至少 32 位随机字符，用密码生成器生成），同样列在 `secrets.required` 里。本地写入 `apps/worker/.dev.vars` 后打开 http://localhost:8787/operator；缺少或为空时谁都进不去：

   ```sh
   echo 'OPERATOR_PASSWORD=...' >> apps/worker/.dev.vars
   ```

7. Maker 的 Coder 是一个 Cloudflare Container（`apps/maker/Dockerfile`），每个 Draft 一个实例。它的模型请求经 Worker 的 `modelFetch` 发出，要用 `CLOUDFLARE_API_KEY`（需 AI Gateway Run 和 Workers AI 权限）；它的 E2B box 要用 `E2B_API_KEY`，这是唯一进入容器的密钥。两者都列在 `secrets.required` 里，值与 `apps/maker/.env` 中的相同，写入 `apps/worker/.dev.vars`：

   ```sh
   grep -E '^(CLOUDFLARE_API_KEY|E2B_API_KEY)=' apps/maker/.env >> apps/worker/.dev.vars
   ```

   `pnpm run api` 不启动容器。要本地跑 Coder，先打开 Docker Desktop，再运行 `pnpm -F worker dev:coder`（首次会构建镜像），然后在另一个终端用 `pnpm -F worker smoke:coder` 给一个新 Draft 发一个真实的构建任务（加 `--music` 带音乐）：它会逐条打印事件，最后删掉这个 Draft 的 box。用的是真实模型和 E2B，一次大约一分钟。

8. Draft 的试玩链接（`GET /api/drafts/:id/preview`）用 `PREVIEW_SECRET` 签名（HMAC-SHA256，一小时有效），同样列在 `secrets.required` 里。本地随便生成一个写入 `apps/worker/.dev.vars`；缺少时签发和打开试玩链接都会失败。Draft 的文件放在 R2 的 `FILES` 绑定（bucket `hopon`），本地由 wrangler 模拟：

   ```sh
   echo "PREVIEW_SECRET=$(openssl rand -base64 32)" >> apps/worker/.dev.vars
   ```

## 本地运行

```sh
pnpm install --frozen-lockfile
pnpm run db:local
pnpm -F worker games-to-r2   # 原创游戏的文件写入本地 R2，只需一次
pnpm run api:offline   # 终端 1：本地 API，不连接 Workers AI
pnpm run ios           # 终端 2：Expo Go + iOS 模拟器（或 pnpm run android）
```

离线模式可以浏览和试玩原创游戏、登录、检查布局；发给 Maker 的消息和评论不经 Screening 直接发出。要真实 Screening，先 `pnpm -F worker exec wrangler login`，再用 `pnpm run api` 代替 `api:offline`。D1 和 R2 仍在本地；只有 AI 推理访问 Cloudflare，会消耗该账号 Workers AI 额度。发给 Maker 的消息、评论和发布时的标题与描述先经 Llama Guard 3（`@cf/meta/llama-guard-3-8b`）Screening，3 秒内没有结论就拒绝。

## 数据库（Drizzle）

表结构在 `apps/worker/src/schema.ts`。修改后生成迁移并应用：

```sh
pnpm run db:generate --name <feature>   # drizzle-kit 写入 apps/worker/migrations/（与 wrangler 的 migrations_dir 相同），文件名后缀为功能名，如 _comments
pnpm run db:local
```

`*_baseline.sql` 由 `schema.ts` 生成完整表结构；Toast Panic 和 Odd Duck 由 `*_originals.sql`（`drizzle-kit generate --custom`）作为普通已发布游戏写入。已在任何共享数据库上应用过的迁移只追加、不修改。

## 部署

已配置用户选择的 Chengchao60827@gmail.com 账号及专用 hopon D1 数据库（迁移到其他账号时才需要 `wrangler d1 create hopon`，并同时更新 `apps/worker/wrangler.jsonc` 的 `account_id` 和 `apps/worker/package.json` 里 `db:remote`、`deploy`、`deploy:staging` 的 `CLOUDFLARE_ACCOUNT_ID`）。

部署由 Cloudflare 的 Workers Builds（Worker 设置里的 Git 集成）完成，GitHub 上没有部署 workflow，也没有 Cloudflare 令牌：

- **Staging**：`hopon-staging` Worker（`wrangler.jsonc` 的 `env.staging`，有自己的 D1 `hopon-staging`、R2 `hopon-staging`、Durable Objects、容器和 E2B 模板 `hopon-maker-staging`）。每次推送到 `main` 运行 `pnpm run deploy:staging`。
- **生产**：`hopon` Worker，推送到 `production` 分支时运行 `pnpm run deploy`。上线就是把 `main` 推过去：`git push origin origin/main:production`。

两个命令都按同一顺序：先重建 E2B 模板（`pnpm -F maker template`；E2B 缓存每一步，只有文件变了的步骤会重做），再应用 D1 迁移，最后 `wrangler deploy` 一次发布 Worker、Talker 和 Coder 的容器镜像。只有已连接 Worker 的生产分支会构建并推送容器镜像，所以 staging 是独立的 Worker 而不是预览版本。容器的 `rollout_active_grace_period` 是 300 秒，部署会等正在运行的构建结束。Workers Builds 不等 GitHub 检查，所以 `main` 受分支保护：PR 须通过 Check 和 Commit messages 才能合并。`test/staging.test.js` 检查 `env.staging` 与顶层的绑定、变量、密钥和容器一致（wrangler env 不继承这些）。

首次配置（staging 的 D1 和 R2、两个 Worker 的全部运行时密钥 `CLERK_JWT_KEY`、`CLERK_SECRET_KEY`、`OPERATOR_PASSWORD`、`OPERATOR_WEBHOOK_URL`、`CLOUDFLARE_API_KEY`、`E2B_API_KEY`、`PREVIEW_SECRET`，构建密钥 `E2B_API_KEY`，在面板里连接两个 Worker，`production` 分支，`main` 的分支保护，第一次上线）运行向导，可中断后用 `FROM=<n>` 从某一步重跑。staging 用 Clerk 的 Development 实例，生产用 Production 实例：

```sh
scripts/deploy-setup.sh
```

迁移只追加，新代码可能写入新列，正在运行的旧 Worker 不受影响。例外是 `*_games_are_files.sql`（#145）：它删除 `games.html` 和未发布的行，不可逆。第一次生产部署前必须运行一次 `pnpm -F worker games-to-r2 --remote`（向导会在它尚未应用时运行），把每个已发布游戏的 HTML 写入 R2 `games/<id>/index.html`；输出应为 `Remote: copied N games`。staging 的 D1 是新建的，原创游戏在 R2 里没有文件，信息流里打不开。

从本机部署仍可用 `pnpm run deploy`（需要 Docker 构建容器镜像，以及 `apps/maker/.env` 里的 `E2B_API_KEY` 构建模板），但会绕过 `main` 的检查，只在 Workers Builds 不可用时使用。

远程命令报 `[code: 7403]` 时先重跑一次：wrangler 的 OAuth 令牌过期后，刷新令牌的那一次请求会失败。仍然失败就运行 `pnpm -F worker exec wrangler whoami`，Token Permissions 里没有 `d1` 和 `workers` 时，令牌权限不足，用 `pnpm -F worker exec wrangler login` 重新登录。

Worker 提供 `/api/*` 和三个静态页面：`/terms`（Rules，标题为 Terms of Use）、`/support`（联系地址，即 App Store 的 Support URL）与 `/privacy`（两个商店的隐私政策 URL，须与商店的隐私问卷一致）。原网页前端已移除。

## 应用商店构建

`apps/mobile/eas.json` 有 `preview`（内部分发）和 `production` 两个 profile，Bundle ID 与包名均为 `app.gethopon`。`EXPO_PUBLIC_API_URL` 和 `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在 EAS 的同名环境里，不在 `.env`；release 构建缺 `EXPO_PUBLIC_API_URL` 会在启动时报错，而不是连 localhost。首次配置（图标、账号、构建、TestFlight、Play 内部测试、商店问卷）运行向导，可中断后重跑：

```sh
scripts/store-setup.sh
```

## 检查

```sh
pnpm run check
```

`check` 还包括 oxlint 与 oxfmt 格式检查（`pnpm run lint`、`pnpm run format`）。`pnpm install` 会通过 lefthook 安装 git hooks：提交前对暂存文件运行 oxlint 和 oxfmt（自动格式化并重新暂存），提交信息须符合 Conventional Commits（commitlint）。

Worker 测试在 wrangler 提供的真实本地 D1（workerd）上运行迁移后执行：权限、Clerk token（过期、伪造、他人草稿）、分页、按账户的原子配额、草稿恢复；原创游戏逻辑测试直接读取迁移中的 HTML；另有应用与 Worker 的 TypeScript 检查。AI 返回值是模拟的，不能证明真实模型输出可玩；每次真实生成后仍需在预览中试玩，再发布。

## 实现边界

- 浏览和试玩无需登录；创建和发布需要 Clerk 邮箱验证码登录（新邮箱自动注册）。身份是 Clerk 用户 ID（JWT `sub`），存入 `games.owner`。Bearer token 不会被自动携带，因此无需 CSRF 检查。Clerk token 约 60 秒过期，应用每次请求都取新 token。
- Draft 仅拥有者可通过签名试玩链接预览（第 8 步）。发布（`POST /api/drafts/:id/publish`，有 Revision 且没有进行中的回合时）把当前 Revision 的全部文件原样复制到 R2 `games/<id>/`，`games` 行记下 Draft 的 id（`draft_id`）和运行时版本，然后删除该 Draft。已发布游戏公开于 `/games/<id>/<file>`（游戏 CSP），信息流加载 `/games/<id>/index.html`；删除或 Ban 游戏时一并删除其文件。删除账户后已发布游戏仍保留。
- 游戏在 WebView 中运行。原生 WebView 没有 iframe 的 `sandbox` 属性，隔离依赖响应 CSP（`sandbox allow-scripts`，禁止网络、表单、嵌套框架和同源权限；脚本和媒体只能内联或来自本站，例如游戏运行时 `/runtime/v2.js`），并禁止导航、新窗口和文件访问。沙箱的不透明源没有存储；WebView 不用 incognito，以便缓存运行时。消息只从应用发往游戏（暂停、继续、静音），游戏无法向应用发消息。沙箱不是 CPU 配额，错误的游戏代码仍可能卡住 WebView。
- 游戏运行时是 LittleJS 加 hopon 脚手架（`apps/maker/image/scaffold.js`），由 `pnpm -F maker build:runtime` 构建，同一份字节供 Coder 的试玩和 Worker 使用；`apps/worker/src/runtime/v2.json` 已提交，过期时测试失败。v2 缓存为 immutable：上线后在 `apps/maker/src/runtime.ts` 设置 `V2_SHA256` 冻结它，之后的改动作为 v3 发布。
- 每个 Clerk 账户每个 UTC 日最多 10 次 Maker 构建，失败也计数；批量注册可绕过，依赖 Clerk 的注册防护。
- 评论：任何人可读；发表需登录并有 @handle，只能评论已发布游戏，1–300 字纯文本，每个账户每个 UTC 日最多 100 条。评论者本人或游戏创作者可删除（硬删除）。删除账户后评论保留，显示发表时的 handle。
- 收藏（Save）：仅本人可见，不显示收藏数；需要登录（未登录不在设备上暂存），只能收藏已发布游戏。收藏列表按收藏时间倒序分页；从列表点开进入收藏流，从所点游戏开始向更早的收藏滑动。删除账户后收藏保留。
- 公开游戏按 ID 倒序游标分页。游戏区域只处理游戏输入；名称与描述区域负责上下滑动（每次最多一款，松开吸附），读屏用户可用调节手势切换；开启“减少动态效果”时不播放滚动动画。当前及相邻游戏预加载（最多三个 WebView），更远的卸载，因此回来时游戏可能重置。滑走的游戏暂停，回来时继续；名称区域的静音按钮作用于整个信息流。
- 上架前仍需：举报/屏蔽/审核机制，须同时覆盖游戏和评论（App Store 用户生成内容规则 1.2）。
- `sharp` 覆盖为安全补丁 `^0.35.4`，修复 wrangler 本地工具链传递依赖的漏洞；产品不做图片处理。

研究与依据：[UI/UX 观察及取舍](docs/uiux-research.md)、[技术核对](docs/technical-research.md)（其中 TanStack 部分描述的是已移除的网页前端）。
