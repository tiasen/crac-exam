# 电波题库 · A 类操作能力验证

一个完全本地运行的 A 类业余无线电台操作技术能力验证刷题网站。题库来自 `A类题库.pdf`，已转换为带分类标签和 AI 速记语的 JSON。

- **683 道题**：单选 547 道，多选 136 道
- **5 大分类 / 20 个知识点**：法律法规、电台操作、设备天线、理论基础、安全规范
- **严格多选判定**：少选、多选、错选均不得分
- **练习模式**：按分类、知识点、题型、题量、顺序自由组合
- **模拟考试**：默认 40 题 / 25 分钟，答对 30 题合格；前 32 题单选、后 8 题多选
- **错题本**：自动记录错误次数、最近答案和连对次数，支持标记已掌握
- **练习记录**：保存每次练习/考试的用时、正确率和逐题作答
- **DeepSeek AI 解析**：逐题讲解正确答案、选项辨析、易错点和记忆提示，支持流式输出
- **AI 速记语**：683 道题均已预生成一句中文速记语
- **题库附图**：已从 `总题库附图标记.pdf` 提取 53 张附图，A 类题库中的 `LK0944` 已接入题目
- **移动端 + PC 端**：桌面侧边栏、移动端底部导航、底部操作栏、底部弹层
- **Cloudflare Pages**：站点可纯静态部署；AI 分析用 Pages Function 转发，无需自建服务器
- **本地数据**：API Key、练习记录、错题本只保存在浏览器

## 快速开始

环境要求：Node.js 20+（已在 Node 24 上测试）。

```bash
cd /Users/sen.tian/projects/crac
npm start
```

访问 <http://localhost:4173>。

不需要 `npm install`，项目没有前端构建步骤和第三方运行时依赖。停止服务按 `Ctrl+C`。

### 手机 / 平板访问

默认只监听本机。若要在同一局域网的手机上打开：

```bash
HOST=0.0.0.0 PORT=4173 npm start
```

启动日志会打印局域网地址，例如 `http://192.168.1.10:4173`。请只在可信网络中使用；绑定 `0.0.0.0` 后，局域网内其他人也能访问这个网站。

## 部署到 Cloudflare Pages

站点本体是纯静态的，可以直接部署到 Cloudflare Pages。只有 DeepSeek AI 分析需要一个很小的 Pages Function（`/api/chat`）做代理，因为 DeepSeek 官方接口不允许浏览器直接跨域调用。练习、错题本、模拟考试、记录、速记语、题库浏览全部不依赖服务器。

### 方式一：Git 集成（推荐）

1. 把项目推到 GitHub / GitLab。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git。
3. 构建配置：
   - Build command：`npm run build`（等价于 `npm run build:cf`）
   - Build output directory：`dist`
   - Framework preset：None
4. `functions/` 目录保持在仓库根目录，Pages 会自动部署其中的 `/api/chat` 和 `/api/health`。
5. 打开站点，在「设置」里填入自己的 DeepSeek API Key；Key 只保存在该浏览器本地。

### 方式二：Wrangler CLI

```bash
npm run build:cf
npx wrangler pages deploy
```

项目根目录的 `wrangler.toml` 已经配置了项目名和输出目录；如果你的 Pages 项目名不同，先修改 `name`，或使用：

```bash
npx wrangler pages deploy dist --project-name 你的项目名
```

本地模拟 Cloudflare 环境：

```bash
npm run preview:cf
```

然后打开 <http://localhost:4174>。

> 不要用 Cloudflare Dashboard 的“直接上传”来传 `dist`，因为该方式不会部署 Pages Functions；需要 AI 分析时请用 Git 集成或 Wrangler。

### API Key 策略

- Key 只保存在访问者自己的浏览器 `localStorage`，不会写入 Cloudflare、Node 服务或任何数据库。
- 没有配置 Key 时，AI 分析按钮只会显示配置提示，不会向 DeepSeek 发起请求。
- Cloudflare Pages Function 只从请求头读取 Key 并转发，不存储 Key，也不需要配置任何服务端 Key。
- 每个访问者使用自己的 DeepSeek 额度。

完全静态、不部署 Functions 时，练习、错题、模拟考试、记录、题库和速记语都可用；只有 AI 分析不可用（DeepSeek 官方接口不允许浏览器直接跨域调用）。

## DeepSeek 配置

进入「设置 → DeepSeek 在线解析」，填写自己的 API Key，选择 `deepseek-flash`（默认）或 `deepseek-reasoner`，点击「测试连接」后保存。

- Key 只保存在当前浏览器 `localStorage`。
- 未配置 Key 时 AI 分析不可用，点击 AI 按钮只会提示去配置，不会发起请求。
- 请求由同源 `/api/chat` 转发（本地 Node 服务或 Cloudflare Pages Function），代理只转发，不存储 Key。
- AI 解析结果会缓存在本地，避免重复请求；缓存可在设置中清空。

AI 解析入口出现在：练习提交答案后、错题本、题库浏览、考试结果逐题回顾。

## 题库转换

PDF 是结构化文本格式（`[J]` 题号、`[P]` 章节、`[I]` 内部编号、`[Q]` 题干、`[T]` 答案、`[A]-[D]` 选项）。转换脚本位于 `scripts/pdf_to_json.py`：

```bash
python3 -m pip install pypdf
npm run figures   # 从《总题库附图标记.pdf》提取 53 张附图到 public/assets/figures
npm run parse     # A类题库.pdf → data/questions.json
```

`scripts/pdf_to_json.py` 会读取 `data/figures.json`，按题目的原始 `[J]` 编号把附图写入 `image` 字段；重新生成时会按题目 ID 保留已有的 AI 速记语。当前 A 类题库只有 `MC1-0665`（原编号 `LK0944`）需要配图；附图 PDF 中其余图片未被当前 A 类题库引用，已一并提取备用。

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

仓库中的 `data/questions.json` 已经包含全部 683 条速记语。如果重新从 PDF 生成了题库，或想换一种模型重写，可运行：

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

## 数据与备份

本地存储键：`crac_a_quiz_v1`。

「设置 → 本地数据」支持：

- 导出备份：练习记录、错题本、设置、AI 解析缓存（**不包含 API Key**）
- 导入备份：覆盖当前记录和错题，保留当前 API Key
- 清空 AI 缓存
- 重置学习进度（保留设置和 API Key）

如果浏览器清理站点数据，记录会丢失，建议定期导出备份。

## 项目结构

```text
crac/
├── A类题库.pdf
├── 总题库附图标记.pdf
├── data/
│   ├── questions.json          # 683 题，含标签、答案、速记语
│   └── figures.json            # 附图 PDF 的 LK 编号 → 图片路径映射
├── public/
│   ├── index.html
│   ├── assets/
│   │   ├── favicon.svg
│   │   ├── apple-touch-icon.png
│   │   └── figures/            # 从附图 PDF 提取的 53 张图（LK0944 已用于题目）
│   ├── css/app.css
│   └── js/
│       ├── app.js              # 路由与启动
│       ├── core.js             # 状态、存储、主题、弹层、API
│       ├── data.js             # 题库索引、筛选、统计、交卷
│       ├── components.js       # 题目卡片、Markdown、AI 解析抽屉
│       └── views/              # 首页/练习/考试/错题/记录/题库/结果/设置
├── functions/
│   └── api/
│       ├── chat.js             # Cloudflare Pages Function：DeepSeek 代理
│       └── health.js           # Cloudflare Pages Function：健康检查
├── cloudflare/
│   └── _headers                # Pages 安全头与缓存策略
├── scripts/
│   ├── extract_figures.py      # 附图 PDF → 图片 + figures.json
│   ├── pdf_to_json.py          # PDF → JSON
│   ├── apply_mnemonics.py      # 合并外部速记语
│   ├── generate_mnemonics.mjs  # DeepSeek 批量生成速记语
│   └── build-cloudflare.mjs    # 生成 dist 静态部署目录
├── server.js                   # 本地零依赖静态服务 + DeepSeek 代理
├── wrangler.toml               # Cloudflare Pages 项目配置
└── package.json
```

## 说明

- 原 PDF 第 112 页天线加感题（`MC1-0665`）标注了 `LK0944.jpg`，但主 PDF 未嵌入图片。附图 PDF 中提供了这张图，已提取为 `public/assets/figures/LK0944.jpg` 并接入题目。
- PDF 文本中的部分英文空格、`classofemission` 一类排版粘连无法可靠还原，不影响答题。
- 题目与答案以所提供 PDF 为准；如遇争议题，请以官方最新题库为准。
- DeepSeek 请求通过同源 `/api/chat` 转发（本地 Node 服务或 Cloudflare Pages Function），避免浏览器跨域问题。自定义 Base URL 只允许公网 HTTPS 或本地 HTTP；代理端也做了内网地址限制。
- 本地服务默认只绑定 `127.0.0.1`，避免把 AI 代理接口暴露到局域网。
