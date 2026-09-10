# hopon

一句话创造小游戏，上下滑动发现并试玩。产品界面、示例和默认生成内容均为英语。只有发现和创造两个页面，没有评论、点赞、关注或消息功能。

技术栈：TanStack Start / React、Cloudflare Workers、D1、Workers AI。使用 Cloudflare 官方 Vite 集成，无 ORM、外部生成服务或游戏引擎。

## 本地运行

需要 Node.js 24+（测试使用内置 `node:sqlite`）。

```sh
npm ci
npm run db:local
npm run dev:offline
```

打开终端显示的本地地址。离线模式可以试玩两个明确标记为官方示例的游戏、检查布局及表单；不会用模板冒充 AI 生成。生成按钮会提示需要连接 Workers AI。

## 连接真实 AI

```sh
npx wrangler login
npx wrangler whoami
CLOUDFLARE_ACCOUNT_ID=<选定账号ID> npm run dev
```

D1 在开发环境仍是本地 SQLite；只有 AI 推理访问 Cloudflare，会消耗该账号 Workers AI 的额度。模型配置在 `wrangler.jsonc` 的 `AI_MODEL` 中，当前使用 `@cf/moonshotai/kimi-k2.5`。设置 `chat_template_kwargs.thinking: false`，最多输出 6000 tokens，提示模型生成紧凑游戏。API 读取其 `choices[0].message.content`，验证 JSON 和完整 HTML 后保存为私有草稿。

## 部署

已配置用户选择的 Chengchao60827@gmail.com 账号及专用 hopon D1 数据库。下面的创建命令仅供迁移到另一个账号时使用，不要重复创建现有数据库。

```sh
CLOUDFLARE_ACCOUNT_ID=<选定账号ID> npx wrangler d1 create hopon
```

将命令返回的数据库 ID 填入 `wrangler.jsonc` 对应的 D1 binding。然后执行：

```sh
npm run db:remote
npm run deploy
```

`npm run deploy` 构建后使用 Cloudflare Vite 生成的 Worker 配置部署，静态文件一并上传。无需 R2：小游戏是有大小限制的自包含 HTML，D1 已足够；增加图片/音频上传时再引入对象存储。

## 检查

```sh
npm run check
```

包括真实 SQLite 上的 SQL/权限/分页/配额测试、AI 输出边界测试、客户端/Worker 构建和 TypeScript 检查。测试中的 AI 返回值是模拟响应；它们不能证明真实模型输出可玩。每次真实生成后仍需在预览中试玩，再明确发布。

已部署到 https://hopon.calendeam.workers.dev/ 。浏览器已验证英语手机/桌面布局、真实生成的 Ocean Memory 试玩与发布、描述区域上下滑动及动画、发布后继续浏览原创小游戏、灵感填入与输入恢复。Toast Panic 和 Odd Duck 是手写原创示例，具有胜负、超时与重试检查。测试中的模拟 AI 与真实生成验证分开记录。

## 实现边界

- 创作身份使用 HttpOnly、SameSite=Strict cookie；无注册。清除 cookie 会失去原草稿的发布权限。浏览器仅保留最近一个草稿入口；不做草稿管理列表。
- 生成的 HTML 由服务器保存，发布只能由拥有者操作。标题及描述由 React 作为文本渲染；游戏在 `sandbox="allow-scripts"` iframe 中运行，响应 CSP 禁止网络请求、表单、嵌套框架和同源权限。发布页不会获得平台 DOM/cookie 的访问权。
- 沙箱是权限隔离，不是 CPU 配额；错误的 AI 游戏代码仍可能卡住浏览器。输出格式通过不代表游戏逻辑通过，用户需预览后发布。
- 为限制开放生成接口的成本，每个网络/IP 每个 UTC 日最多 10 次尝试，跨会话共享；失败也计数。不是账户级防滥用系统。当前不做付费/积分或用户系统。
- 公开游戏按 ID 倒序游标分页，最后一页附加 Toast Panic 和 Odd Duck，发布第一款游戏不会让原创示例消失。游戏区域只处理游戏输入；名称与描述区域接收滚轮、拖动和触摸滑动，跟随手指移动并在松开时吸附。桌面另有上下按钮和键盘导航。
- 当前游戏及相邻游戏预加载（最多三个 iframe），保证滑动中有内容；距离更远时卸载，因此回来时可能重置游戏。沙箱不能强制暂停相邻游戏的计时器；当前没有跨游戏音频或暂停协议。
- `sharp` 覆盖为安全补丁 `^0.35.4`，用于修复 Cloudflare 本地工具链传递依赖的漏洞；没有把图片处理引入产品。

研究与依据：[UI/UX 观察及取舍](docs/uiux-research.md)、[TanStack / Cloudflare 技术核对](docs/technical-research.md)。
