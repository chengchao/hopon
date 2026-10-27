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

7. Maker 的 Coder 是 Worker 里每个 Draft 一个的 Durable Object（`apps/worker/src/coder.ts`），它的 box 是它自己启动的 Cloudflare Container（`apps/maker/image/Dockerfile`），box 里没有网络，也没有任何密钥。Talker 和 Coder 的模型请求都在 Worker 里经 `modelFetch` 发出，要用 `CLOUDFLARE_API_KEY`（需 AI Gateway Run 和 Workers AI 权限）。它列在 `secrets.required` 里，值与 `apps/maker/.env` 中的相同，写入 `apps/worker/.dev.vars`：

   ```sh
   grep -E '^CLOUDFLARE_API_KEY=' apps/maker/.env >> apps/worker/.dev.vars
   ```

   `pnpm run api`（`pnpm -F worker dev`）和测试都没有 box：容器要 Docker，`wrangler.jsonc` 的 `dev.enable_containers` 关着，所以在那里发起的构建会因没有 box 而失败。要本地跑 Coder，先打开 Docker Desktop，再运行 `pnpm -F worker dev:coder`（首次会构建镜像），然后在另一个终端用 `pnpm -F worker smoke:coder` 给一个新 Draft 发一个真实的构建任务（加 `--music` 带音乐）：它会逐条打印事件，最后删掉这个 Draft 的 box。用的是真实模型和 Docker 里的 box，一次大约一分钟。

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

已配置用户选择的 Chengchao60827@gmail.com 账号及专用 hopon D1 数据库（迁移到其他账号时才需要 `wrangler d1 create hopon`，并同时更新 `apps/worker/wrangler.jsonc` 的 `account_id` 和 `apps/worker/package.json` 里 `db:remote`、`deploy`、`deploy:preview` 的 `CLOUDFLARE_ACCOUNT_ID`；预览的 D1 换账号时也要重建，并更新 `previews.d1_databases` 和 `apps/worker/wrangler.preview-migrations.jsonc` 里的 `database_id`）。

部署由 GitHub Actions 的 Deploy workflow（`.github/workflows/deploy.yml`）完成，用仓库密钥 `CLOUDFLARE_API_TOKEN`（Workers Scripts、D1、Containers、R2 的 Edit 权限）。两个命令都要用 Docker 构建 Coder 的 box 镜像，Cloudflare 的 Workers Builds 没有 Docker，所以不用它（它的生产部署曾在迁移 D1 之后才失败）：

- **生产**：`hopon` Worker，推送到 `main`（合并 PR）时运行 `pnpm run deploy`：合并就是上线，进度在 Actions 的 Deploy 运行里。
- **预览**：`hopon` Worker 的 [Worker Previews](https://developers.cloudflare.com/workers/previews/)（`wrangler.jsonc` 的 `previews`）。推送到 `main` 以外的分支（每个 PR 的分支）时运行 `pnpm run deploy:preview`：把迁移应用到 D1 `hopon-staging`（`wrangler.preview-migrations.jsonc`），再 `wrangler preview`。每个分支一个预览，URL 是 `<分支>-hopon.<子域>.workers.dev`，在 workflow 的日志里；有自己的 Talker 和 Coder（Durable Object 命名空间是新的；Coder 的 box 是同一个镜像，但 wrangler 不接受 `previews` 里的 `durable_object` 策略，所以是默认策略的容器应用 `hopon_<预览>_DraftCoder`，`standard-3`，最多 40 个实例），D1 `hopon-staging` 和 R2 `hopon-staging` 由所有预览共用。没有 staging：PR 的预览提前演练了 Durable Object 迁移，和迁移在新建 D1 上的执行。预览演练不到的有两样：迁移遇到生产 D1 里已有的数据，和 `wrangler deploy` 这条命令本身。部署在迁移之后失败时，旧 Worker 接着服务迁移后的 D1，所以迁移只追加（见下）。在真机上测 PR：开发版应用的 `EXPO_PUBLIC_API_URL` 指向这个 URL，用 Clerk 的 Development 发布密钥。

两个命令都按同一顺序：先 `pnpm -F maker build:runtime`（box 镜像要用它生成的文件），再应用 D1 迁移，最后 `wrangler deploy`（预览是 `wrangler preview`）一次发布 Worker、Talker 和 Coder，并用 Docker 构建、推送 Coder 的 box 镜像。推送到 `main` 就部署，不等 GitHub 检查，所以 `main` 受分支保护：PR 须通过 Check 和 Commit messages 才能合并。`test/previews.test.js` 检查 `previews` 与顶层的绑定和变量一致（预览不继承这些）、Coder 的 box 配置，并检查迁移配置和预览绑定的是同一个 D1。

首次配置（预览的 D1 和 R2、`hopon` Worker 和预览基础配置的全部运行时密钥 `CLERK_JWT_KEY`、`CLERK_SECRET_KEY`、`OPERATOR_PASSWORD`、`OPERATOR_WEBHOOK_URL`、`CLOUDFLARE_API_KEY`、`PREVIEW_SECRET`，Deploy workflow 的仓库密钥 `CLOUDFLARE_API_TOKEN`，`main` 的分支保护，第一次上线）运行向导，可中断后用 `FROM=<n>` 从某一步重跑。预览用 Clerk 的 Development 实例，生产用 Production 实例：

```sh
scripts/deploy-setup.sh
```

迁移只追加：新代码可能写入新列，正在运行的旧 Worker、部署失败后留下的旧 Worker 都不受影响。删除或改名列、表的迁移晚一个部署：先合并不再读它的代码，迁移里再写 `-- contract: #<那个 PR>`，`test/migrations.test.js` 检查删除列的迁移有这一行。唯一的例外是已应用的 `*_games_are_files.sql`（#145）：它删除了旧代码还在读的 `games.html`，#180 合并时部署在它之后失败（Workers Builds 没有 Docker），生产返回了几分钟 500。预览的 D1 是新建的，原创游戏在 R2 里没有文件，信息流里打不开。

预览的密钥：预览不继承 `hopon` 的 Worker 密钥，也不能写进 `wrangler.jsonc`（wrangler 4.152 不认 `previews.secrets`，缺密钥的预览照样部署）。每个新预览创建时复制一份预览基础配置里的密钥，向导用 `wrangler preview base-config secret put <NAME>` 设置。之后改基础配置只影响此后新建的预览，已有的预览用 `wrangler preview secret put <NAME> --name <预览>` 单独改。没有用 Secrets Store：它的绑定要在代码里 `await env.X.get()`，而且一个 store 密钥被生产和所有预览共用，换值时无法只换预览的。

关闭的 PR 不会自动删除预览（每个 Worker 最多 500 个，满了删最久没部署的）。手动清理：`pnpm -F worker exec wrangler preview delete --name <预览> --skip-confirmation`，再用 `wrangler containers list` 找到名为 `hopon_<预览>_DraftCoder`（旧预览的是 `hopon_<预览>_Coder`）的容器应用，`wrangler containers delete <ID>`（删除预览不会删它）。

从本机部署仍可用 `pnpm run deploy`（需要 Docker 构建 box 镜像），但会绕过 `main` 的检查，只在 GitHub Actions 不可用时使用。

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
- 游戏运行时是 LittleJS 加 hopon 脚手架（`apps/maker/image/scaffold.js`），由 `pnpm -F maker build:runtime` 构建，同一份字节供 Coder 的试玩和 Worker 使用；`apps/worker/src/runtime/v2.json` 已提交，过期时测试失败。v2 缓存为 immutable：上线后在 `apps/maker/src/runtime.ts` 设置 `V2_SHA256` 冻结它，之后的改动作为 v3 发布。纯 DOM 游戏的脚手架 `apps/maker/image/dom.js` 同样原样复制到 `apps/worker/src/runtime/dom-v1.json`，以 `/dom/v1.js` 提供（`DOM_V1_SHA256` 冻结）。
- 每个 Clerk 账户每个 UTC 日最多 10 次 Maker 构建，失败也计数；批量注册可绕过，依赖 Clerk 的注册防护。
- 评论：任何人可读；发表需登录并有 @handle，只能评论已发布游戏，1–300 字纯文本，每个账户每个 UTC 日最多 100 条。评论者本人或游戏创作者可删除（硬删除）。删除账户后评论保留，显示发表时的 handle。
- 收藏（Save）：仅本人可见，不显示收藏数；需要登录（未登录不在设备上暂存），只能收藏已发布游戏。收藏列表按收藏时间倒序分页；从列表点开进入收藏流，从所点游戏开始向更早的收藏滑动。删除账户后收藏保留。
- 公开游戏按 ID 倒序游标分页。游戏区域只处理游戏输入；名称与描述区域负责上下滑动（每次最多一款，松开吸附），读屏用户可用调节手势切换；开启“减少动态效果”时不播放滚动动画。当前及相邻游戏预加载（最多三个 WebView），更远的卸载，因此回来时游戏可能重置。滑走的游戏暂停，回来时继续；名称区域的静音按钮作用于整个信息流。
- 上架前仍需：举报/屏蔽/审核机制，须同时覆盖游戏和评论（App Store 用户生成内容规则 1.2）。
- `sharp` 覆盖为安全补丁 `^0.35.4`，修复 wrangler 本地工具链传递依赖的漏洞；产品不做图片处理。

研究与依据：[UI/UX 观察及取舍](docs/uiux-research.md)、[技术核对](docs/technical-research.md)（其中 TanStack 部分描述的是已移除的网页前端）。
