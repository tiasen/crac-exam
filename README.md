# 电波题库 · A 类操作能力验证

一个本地优先、可选的云端账号同步的 A 类业余无线电台操作技术能力验证刷题网站。题库来自 `A类题库.pdf`，已转换为带分类标签和 AI 速记语的 JSON。未登录也能完整使用；登录后进度可按用户保存到 Cloudflare D1。

- **683 道题**：单选 547 道，多选 136 道
- **5 大分类 / 20 个知识点**：法律法规、电台操作、设备天线、理论基础、安全规范
- **严格多选判定**：少选、多选、错选均不得分
- **练习模式**：按分类、知识点、题型、题量、顺序自由组合
- **模拟考试**：默认 40 题 / 25 分钟，答对 30 题合格；前 32 题单选、后 8 题多选
- **错题本**：自动记录错误次数、最近答案和连对次数，支持标记已掌握
- **练习记录**：保存每次练习/考试的用时、正确率和逐题作答
- **DeepSeek AI 解析**：逐题讲解正确答案、选项辨析、易错点和记忆提示，支持流式输出
- **AI 速记语**：683 道题均已预生成一句中文速记语
- **账号登录**：支持 Cloudflare Access 单点登录（可选）或站内邮箱密码账号
- **云端进度**：登录后练习记录、错题本、解析缓存和进行中的答题会话按用户保存到 Cloudflare D1
- **本地优先**：未登录也能完整使用；答题先写本机，联网后自动同步，冲突自动合并
- **题库附图**：已从 `总题库附图标记.pdf` 提取 53 张附图，A 类题库中的 `LK0944` 已接入题目
- **移动端 + PC 端**：桌面侧边栏、移动端底部导航、底部操作栏、底部弹层
- **Cloudflare 部署**：静态资源 + Workers/Pages 小型代理；AI 分析无需自建服务器
- **密钥不上云**：DeepSeek API Key 只保存在浏览器，不写入数据库、不同步到账号

## 快速开始

环境要求：Node.js 20+（已在 Node 24 上测试）。

```bash
cd /Users/sen.tian/projects/crac
npm start
```

访问 <http://localhost:4173>。

不需要 `npm install`，项目没有前端构建步骤和第三方运行时依赖。停止服务按 `Ctrl+C`。

本地开发时账号和进度保存在 `.data/account.json`（已加入 `.gitignore`，文件权限 0600），不依赖 Cloudflare。想换位置可以指定：

```bash
ACCOUNT_DB=/path/to/account.json npm start
```

### 手机 / 平板访问

默认只监听本机。若要在同一局域网的手机上打开：

```bash
HOST=0.0.0.0 PORT=4173 npm start
```

启动日志会打印局域网地址，例如 `http://192.168.1.10:4173`。请只在可信网络中使用；绑定 `0.0.0.0` 后，局域网内其他人也能访问这个网站。

## 部署到 Cloudflare

### 先回答：Cloudflare 有没有快速集成的功能？

有。这个项目用到了两项最合适的：

| 需求 | Cloudflare 能力 | 适合场景 |
| --- | --- | --- |
| 登录 | **Cloudflare Access**（Zero Trust） | 最快，不需要写登录页；支持邮箱一次性验证码、Google/GitHub 等 SSO。适合私有站点、团队或只让自己和朋友用。免费版支持 50 个用户，但需要在 Access 里配置允许名单，不是开放注册。 |
| 登录 | 站内邮箱密码账号（本项目内置） | 适合公开站点；注册开放，不依赖 Zero Trust。 |
| 数据库 | **Cloudflare D1** | SQLite 兼容，Workers 原生绑定，按用户保存进度，免费额度对个人题库足够。 |
| 机器人防护 | Cloudflare Turnstile | 可选；公开注册量变大时可以再加，本项目暂未启用。 |

本项目的策略是：**有 Access 就用 Access 单点登录；没有 Access 就用站内邮箱密码**。两种方式都会把进度按用户保存到 D1；本地 `npm start` 不依赖 Cloudflare，账号数据保存在 `.data/account.json`。

> KV 也能存数据，但它是最终一致的键值存储，不适合这里需要的“按用户读改写进度 + 版本冲突检测”；Durable Objects 又偏重。D1 是成本最低、查询最直接的选择。

### 1. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create crac-a-quiz
```

把输出里的 `database_id` 填到 `wrangler.toml`（替换占位符）：

```toml
[[d1_databases]]
# 变量名用 crac_a_quiz 或 DB 都可以，代码两者都兼容
binding = "crac_a_quiz"
database_name = "crac-a-quiz"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"
```

执行迁移：

```bash
npx wrangler d1 migrations apply crac-a-quiz --remote
```

### 2. 部署 Worker

`wrangler.toml` 已配置：

- `main = "worker/index.js"`
- `[assets] directory = "./public"`，绑定 `ASSETS`
- `[[d1_databases]]`，绑定 `DB`

Worker 负责：

- `/api/chat`：DeepSeek 代理
- `/api/health`：健康检查
- `/api/auth/*`：注册、登录、退出、当前用户
- `/api/progress`：读取/保存当前用户的进度

其余请求交给 `ASSETS` 静态资源。

```bash
npx wrangler deploy
# 或
npm run deploy
```

部署完成后访问 `*.workers.dev` 或自定义域名。

本地模拟 Workers + 静态资源 + 本地 D1：

```bash
npm run db:migrate:local
npm run preview:cf
```

然后打开 <http://localhost:4174>。

### 3A. 用 Cloudflare Access 做登录（可选，最快）

如果站点是给自己、朋友或团队用，推荐直接启用 Access：

1. Cloudflare Dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted。
2. Destination 选择当前 Worker（也可以填 `*.workers.dev` 域名）。
3. 新建策略：Allow，条件填允许的邮箱或邮箱域名。
4. 登录方式选择 One-time PIN、Google、GitHub 等；按提示保存。
5. 不需要改代码，也不需要填写任何密码配置。Worker 会通过 `ctx.access` 自动读取已登录用户，首次访问时自动建账号，进度仍然存在 D1。

注意：

- Access 会保护整个站点（包括静态页面和 API），未登录访客会先看到 Cloudflare 的登录页。
- Access 的用户需要你提前加入允许策略，不适合“任何人自助注册”的公开站点。
- 免费版 Access 支持最多 50 个用户，个人使用足够。

### 3B. 用站内邮箱密码（默认，适合公开站点）

不配置 Access 时，登录页会显示注册/登录表单：

- 邮箱 + 密码注册，密码至少 8 位。
- 会话使用 HttpOnly、SameSite=Lax Cookie，默认 30 天。
- 登录和注册都有基础频率限制。
- 每个账号的进度独立保存；登录时会自动合并本机已有进度。
- 退出登录会清空本机当前账号的进度缓存，云端数据不受影响。

### 4. Cloudflare Pages（可选，另一类项目）

如果你更想用 Pages：

1. 新建 **Pages 项目**（不是当前 Worker 项目），构建命令 `npm run build`，输出目录 `dist`。
2. 在 Pages 项目的 Settings → Functions → D1 database bindings 中添加绑定，变量名写 `DB` 或 `crac_a_quiz` 都可以。
3. 执行 `npx wrangler d1 migrations apply crac-a-quiz --remote`。
4. 仓库里的 `functions/` 会被识别为 `/api/chat`、`/api/health`、`/api/auth/*`、`/api/progress`。

Pages Functions 下使用站内邮箱密码登录；Cloudflare Access 自动登录目前只在 Worker 部署中启用。当前根目录的 `wrangler.toml` 是 Worker 配置，使用 Pages 时不要把它当作 Worker 项目部署。

### 账号与安全实现

- 站内账号密码使用 PBKDF2-SHA256（100,000 次迭代、随机盐）哈希后保存，不存明文。
- 会话令牌只把 SHA-256 哈希写入数据库，浏览器持有随机原文；Cookie 为 HttpOnly、SameSite=Lax，HTTPS 下自动加 Secure。
- 登录按“邮箱 + IP”限流，注册按 IP 限流；写接口校验同源 Origin。
- 每个用户一行进度 JSON，带 revision 乐观锁；客户端冲突时自动合并后重试。
- 单行进度上限 1.8 MB，客户端上传前会自动裁剪过旧记录并提示清理。
- 使用 Cloudflare Access 时，Worker 直接信任 Access 注入的身份，不需要处理密码。

### API Key

- Key 只保存在访问者自己的浏览器 `localStorage`，不会写入 Cloudflare、Node 服务或任何数据库。
- 未配置 Key 时，AI 分析按钮只显示配置提示，不会向 `/api/chat` 或 DeepSeek 发起请求。
- Worker/Pages Function 只从请求头读取 Key 并转发，不存储 Key。
- 每个访问者使用自己的 DeepSeek 额度，不需要配置服务端密钥。
- 完全静态、不部署 Worker/Function 时，练习、错题、模拟考试、记录、题库和速记语都可用；只有 AI 分析不可用。

## DeepSeek 配置

进入「设置 → DeepSeek 在线解析」，填写自己的 API Key，选择 `deepseek-flash`（默认）或 `deepseek-reasoner`，点击「测试连接」后保存。

- Key 只保存在当前浏览器 `localStorage`。
- 未配置 Key 时 AI 分析不可用，点击 AI 按钮只会提示去配置，不会发起请求。
- 请求由同源 `/api/chat` 转发（本地 Node 服务或 Cloudflare Worker/Pages Function），代理只转发，不存储 Key。
- AI 解析结果会缓存在本地，避免重复请求；缓存可在设置中清空。

AI 解析入口出现在：练习提交答案后、错题本、题库浏览、考试结果逐题回顾。

## 题库转换

PDF 是结构化文本格式（`[J]` 题号、`[P]` 章节、`[I]` 内部编号、`[Q]` 题干、`[T]` 答案、`[A]-[D]` 选项）。转换脚本位于 `scripts/pdf_to_json.py`：

```bash
python3 -m pip install pypdf
npm run figures   # 从《总题库附图标记.pdf》提取 53 张附图到 public/assets/figures
npm run parse     # A类题库.pdf → public/data/questions.json
```

`scripts/pdf_to_json.py` 会读取 `public/data/figures.json`，按题目的原始 `[J]` 编号把附图写入 `image` 字段；重新生成时会按题目 ID 保留已有的 AI 速记语。当前 A 类题库只有 `MC1-0665`（原编号 `LK0944`）需要配图；附图 PDF 中其余图片未被当前 A 类题库引用，已一并提取备用。

生成的结构包含：

```json
{
  "id": "MC2-0001",
  "type": "multiple",
  "answer": ["A", "C"],
  "question": "……",
  "options": [{ "key": "A", "text": "……" }],
  "section": "1.1.1",
  "categoryId": "law",
  "category": "法律法规类",
  "topicId": "law-1-1",
  "topic": "无线电管理法规",
  "tags": ["法律法规类", "无线电管理法规", "法规条文"],
  "mnemonic": "……"
}
```

标签在转换时一次性写入 JSON，浏览器端不再分析标签。分类由 `[P]` 一级章节映射，知识点由二级章节映射，关键词标签由固定规则生成，保证每次转换结果稳定可复现。

### 重新生成 AI 速记语

仓库中的 `public/data/questions.json` 已经包含全部 683 条速记语。如果重新从 PDF 生成了题库，或想换一种模型重写，可运行：

```bash
DEEPSEEK_API_KEY=sk-... node scripts/generate_mnemonics.mjs
```

默认只补齐没有速记语的题；`--force` 重写全部，`--topic op-2-4 --limit 20` 可只处理某个知识点。生成脚本支持并发和失败重试。

> 这里的 `DEEPSEEK_API_KEY` 仅用于离线批量生成脚本，不参与网站运行，也不是 Cloudflare/Node 的运行时配置。

如果已经用其他方式生成了 `{ "题目ID": "速记语" }` 格式的 JSON，可以合并：

```bash
python3 scripts/apply_mnemonics.py 'path/to/mnemonics/*.json'
```

## 模拟考试规则

默认对齐 A 类正式考试：

- 40 题
- 25 分钟
- 75% 合格（40 题答对 30 题）
- 第 1–32 题为单选，第 33–40 题为多选
- 交卷前不显示答案，时间到自动交卷，未作答按错误计

设置页和考试页都可以修改题量、时长、合格线。

## 数据、账号与备份

本地存储键：`crac_a_quiz_v1`；本地开发账号文件：`.data/account.json`。

**未登录**

- 练习记录、错题本、解析缓存、进行中的练习和考试都只保存在当前浏览器。
- 浏览器清理站点数据后记录会丢失，建议定期导出备份。

**登录后**

- 练习记录、错题本、解析缓存、进行中的练习/考试会按用户保存到 Cloudflare D1。
- 答题先写入本机，联网后自动同步；同步失败不会阻塞答题，恢复网络后会重试。
- 多设备同时修改时用版本号检测冲突，自动合并记录、错题和解析缓存。
- DeepSeek API Key、主题和考试默认值仍然只保存在本机，不会写入云端。
- 退出登录会清空本机当前账号的进度缓存（云端数据保留）；重新登录会自动恢复。
- 登录时如果本机已有进度，会先合并到账号里；切换账号不会把上一个账号的进度带过去。

「设置 → 本地数据与备份」支持：

- 导出备份：练习记录、错题本、设置、AI 解析缓存（**不包含 API Key**）
- 导入备份：覆盖当前记录和错题，保留当前 API Key；登录状态下会自动同步到云端
- 清空 AI 缓存
- 重置学习进度（保留设置和 API Key；登录状态下也会重置云端进度）

## 项目结构

```text
crac/
├── A类题库.pdf
├── 总题库附图标记.pdf
├── public/                      # 纯静态根目录，也是 Worker 的 ASSETS 目录
│   ├── index.html
│   ├── data/
│   │   ├── questions.json      # 683 题，含标签、答案、速记语
│   │   └── figures.json        # 附图 PDF 的 LK 编号 → 图片路径映射
│   ├── assets/
│   │   ├── favicon.svg
│   │   ├── apple-touch-icon.png
│   │   └── figures/            # 从附图 PDF 提取的 53 张图（LK0944 已用于题目）
│   ├── css/app.css
│   └── js/
│       ├── app.js              # 路由与启动
│       ├── core.js             # 状态、存储、主题、弹层、API
│       ├── account.js          # 登录状态、云端进度同步与冲突合并
│       ├── data.js             # 题库索引、筛选、统计、交卷
│       ├── components.js       # 题目卡片、Markdown、AI 解析抽屉
│       └── views/              # 首页/练习/考试/错题/记录/题库/结果/设置/登录
├── worker/
│   ├── index.js                # Cloudflare Worker：静态资源 + AI + 账号路由
│   └── d1-repo.js              # D1 用户、会话、进度数据访问
├── shared/
│   ├── deepseek.js             # Worker/Pages 共用的 DeepSeek 代理逻辑
│   ├── account.js              # Worker/Pages/Node 共用的账号与进度 API
│   └── crypto.js               # PBKDF2 密码哈希、会话令牌、随机 ID
├── server/
│   └── account-repo.js         # 本地 Node 的 JSON 账号存储
├── migrations/
│   └── 0001_accounts.sql       # D1 表结构：users/sessions/progress/auth_attempts
├── functions/
│   └── api/
│       ├── chat.js             # 可选 Pages Function：DeepSeek 代理
│       ├── health.js           # 可选 Pages Function：健康检查
│       ├── progress.js         # 可选 Pages Function：进度读写
│       └── auth/[[path]].js    # 可选 Pages Function：注册/登录/退出
├── cloudflare/
│   └── _headers                # Pages/静态资源安全头与缓存策略
├── scripts/
│   ├── extract_figures.py      # 附图 PDF → 图片 + figures.json
│   ├── pdf_to_json.py          # PDF → JSON
│   ├── apply_mnemonics.py      # 合并外部速记语
│   ├── generate_mnemonics.mjs  # DeepSeek 批量生成速记语
│   └── build-cloudflare.mjs    # 生成 dist 静态部署目录
├── server.js                   # 本地零依赖服务 + 账号 API + DeepSeek 代理
├── wrangler.toml               # Cloudflare Workers + Static Assets + D1 配置
└── package.json
```

## 说明

- 原 PDF 第 112 页天线加感题（`MC1-0665`）标注了 `LK0944.jpg`，但主 PDF 未嵌入图片。附图 PDF 中提供了这张图，已提取为 `public/assets/figures/LK0944.jpg` 并接入题目。
- PDF 文本中的部分英文空格、`classofemission` 一类排版粘连无法可靠还原，不影响答题。
- 题目与答案以所提供 PDF 为准；如遇争议题，请以官方最新题库为准。
- DeepSeek 请求通过同源 `/api/chat` 转发（本地 Node 服务或 Cloudflare Worker/Pages Function），避免浏览器跨域问题。自定义 Base URL 只允许公网 HTTPS 或本地 HTTP；代理端也做了内网地址限制。
- 本地服务默认只绑定 `127.0.0.1`，避免把 AI 代理接口暴露到局域网。
