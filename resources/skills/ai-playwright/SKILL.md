---
name: ai-playwright
description: 自动化模式下浏览器自动化的默认方式。创建并执行 Playwright 脚本，支持自我修复进化：任务拆解为 Playwright-API 动作指令 → 每步前 DOM 探测、每步后截图验证 → 失败则重新探测/分析/生成指令并重试 → 三次失败刷新页面，仍失败则重启浏览器并重新生成脚本。无需用户说「用 Playwright」即应优先使用本技能；仅当用户明确要求 agent-browser 或 Playwright 不可用时才使用 agent-browser。
---

# AI Playwright 浏览器自动化

**收到自动化任务后，立即执行以下流程，不需要等待用户确认。**

## 执行流程（含自我修复进化）

```
任务分析 → 拆解为 Playwright-API 可识别的动作指令(见下)
    ↓
【第零步：环境自检】运行环境检查脚本，确认 Chromium 可执行文件存在（见下）
    ↓
解析 node/npm 路径(见下) → 安装依赖(如需)
    ↓
【对每一步指令循环】
  每步执行前：① 核实是否有新浏览器 tab 已打开（若有则先切换到目标 tab）② 核实当前是否在激活的 tab 下操作 ③ 在当前激活的 tab 上 DOM 探测，确保选择器/元素可命中
  执行该步（可能在本 tab 或新 tab 打开结果；若指令含 opensNewTab: true 则必须用 waitForEvent('page') 捕获新 tab）
  每步执行后：识别是在当前 tab 还是新 tab 打开 → 若新 tab 则切换到新 tab
  → 【重要】在当前激活的 tab 上做 DOM 探测和截图，用于验证与下一步
  → 截图验证是否达到预期 …
  → 若未达预期：重新探测 DOM、分析页面结构、重新生成该步指令 → 再验证（循环直至成功）
  → 同一指令连续 3 次失败：刷新页面后重新执行该步
  → 刷新后仍失败：重启 Chrome，重新生成完整脚本后再执行
    ↓
全部步骤成功 → 脚本固化(可选)
```

## 安装/运行前：用绝对路径减少重试

**在 OpenCowork 应用内执行时**：应用已内置 Node 与 Playwright（`resources/playwright` 或「立即安装」目录），执行 Playwright 脚本时会自动使用内置环境，无需本机安装 node/playwright，也不会因项目 npm 异常而「找不到 playwright」。

在**其他环境**（如 Cursor 终端）或**安装依赖**前，先解析 node/npm/pnpm 的绝对路径，再用绝对路径执行，避免 PATH 导致的 "command not found" 和多轮回退。

- **一步解析**（macOS/Linux）：`NODE=$(which node); NPM=$(which npm 2>/dev/null); PNPM=$(which pnpm 2>/dev/null); echo "NODE=$NODE NPM=$NPM PNPM=$PNPM"`
- **使用**：安装用 `"$NPM" install playwright` 或 `"$PNPM" add playwright`，运行用 `"$NODE" /tmp/pw-task.js`。Windows 用 `where node` / `where npm` / `where pnpm` 得到路径后同样用绝对路径调用。
- 若未找到 npm/pnpm，再考虑手动创建 package.json 或使用应用内置环境；**不要**先尝试裸命令失败后再多步回退。

---

## 第零步：环境自检（每次执行前必须运行）

**在生成或执行任何 Playwright 脚本之前，必须先运行以下环境检查脚本，确认 Chromium 浏览器可执行文件存在。若不存在，脚本会自动安装后继续。**

将以下内容写入 `/tmp/pw-env-check.js` 并执行：

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 按优先级探测 qacowork 内置 playwright CLI 与 node
const QACOWORK_NODE = '/Applications/QACowork.app/Contents/Resources/node/darwin-arm64/node';
const QACOWORK_CLI  = '/Applications/QACowork.app/Contents/Resources/playwright/package/node_modules/playwright/cli.js';
const BROWSERS_JSON = '/Applications/QACowork.app/Contents/Resources/playwright/package/node_modules/playwright-core/browsers.json';
const BROWSERS_BASE = path.join(process.env.HOME, 'Library/Application Support/qacowork/playwright/browsers');

// 读取当前 qacowork 期望的 chromium revision
const getExpectedExecutable = () => {
  if (!fs.existsSync(BROWSERS_JSON)) return null;
  const data = JSON.parse(fs.readFileSync(BROWSERS_JSON, 'utf8'));
  const chromium = (data.browsers || []).find(b => b.name === 'chromium');
  if (!chromium) return null;
  // macOS arm64 路径（兼容 x64 回退）
  const arm64 = path.join(BROWSERS_BASE, `chromium-${chromium.revision}`, 'chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  const x64 = arm64.replace('arm64', 'x64');
  return fs.existsSync(arm64) ? arm64 : fs.existsSync(x64) ? x64 : { missing: arm64 };
};

const result = getExpectedExecutable();

if (!result) {
  // 非 qacowork 内置环境（如 Cursor 终端），使用系统 playwright
  try {
    const { chromium } = require('playwright');
    const exePath = chromium.executablePath();
    if (!fs.existsSync(exePath)) throw new Error(`not found: ${exePath}`);
    console.log('✓ 系统 playwright 浏览器环境正常:', exePath);
  } catch (e) {
    console.error('⚠️  浏览器不存在，请运行: npx playwright install chromium');
    process.exit(1);
  }
} else if (typeof result === 'string') {
  console.log('✓ qacowork 浏览器环境正常:', result);
} else {
  // 需要安装
  console.log('⚠️  浏览器不存在，自动安装中...');
  const nodeCmd = fs.existsSync(QACOWORK_NODE) ? QACOWORK_NODE : process.execPath;
  try {
    execSync(`"${nodeCmd}" "${QACOWORK_CLI}" install chromium`, {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_BASE },
      timeout: 180000,
    });
    console.log('✅ 浏览器安装成功，继续执行任务');
  } catch (err) {
    console.error('❌ 安装失败:', err.message);
    process.exit(1);
  }
}
```

执行命令（优先使用 qacowork 内置 node）：
```bash
/Applications/QACowork.app/Contents/Resources/node/darwin-arm64/node /tmp/pw-env-check.js
# 若上述路径不存在，使用系统 node：
# node /tmp/pw-env-check.js
```

- **检查通过**（输出 `✓`）：继续后续步骤
- **自动安装**（输出 `✅`）：等待完成后继续
- **安装失败**（输出 `❌`）：告知用户错误原因，不继续执行

---

## 第一步：任务拆解为 Playwright-API 动作指令

将任务分解为**可被 Playwright API 直接识别的原子动作指令**，每条指令对应一种操作类型与参数。便于后续「每步前探测、每步后验证」的自我修复循环。

### 【必须】明确标注「新窗口/新 tab」步骤

**脚本生成过程中，必须明确告诉 AI 哪一步会打开新窗口/新 tab，否则执行会出错。**

- 若某步操作会打开**新浏览器 tab 或新窗口**（如点击带 `target="_blank"` 的链接、搜索按钮、提交后跳转新 tab 等），在拆解指令时**必须**为该步标注 `opensNewTab: true`（或等价标记），并在生成脚本时对该步使用 `context.waitForEvent('page')` + 点击的 `Promise.all` 模式，确保正确捕获并切换到新 page。
- 未标注时，AI 可能仍在当前 tab 上做后续探测与操作，导致步骤错位、点击到错误页面。

**动作类型（与 [references/playwright-api.md](references/playwright-api.md) 对应）**：

| 动作 | 含义 | 典型参数 |
|------|------|----------|
| `goto` | 导航到 URL | `url`, `waitUntil` |
| `reload` | 刷新页面 | — |
| `waitForSelector` | 等待元素出现 | `selector`, `timeout` |
| `waitForURL` | 等待 URL 匹配 | `pattern` |
| `waitForLoadState` | 等待加载状态 | `state`（如 networkidle） |
| `click` | 点击元素 | `selector` 或 role/text/label 等；**若会打开新 tab 必须加 `opensNewTab: true`** |
| `fill` | 清空并填写 | `selector`, `value` |
| `type` | 逐字输入 | `selector`, `value` |
| `selectOption` | 下拉选择 | `selector`, `value` |
| `check` / `uncheck` | 勾选/取消 | `selector` |
| `hover` | 悬停 | `selector` |
| `screenshot` | 截图 | `path`（可选） |
| `extract` | 提取数据 | `selector` 或 evaluate 描述 |
| `closeTab` | 关闭当前/指定 tab | 关闭后须识别新的激活 tab |

拆解示例：
- 导航到 URL → `{ action: 'goto', url: '...' }`
- 等待登录按钮出现 → `{ action: 'waitForSelector', selector: '...' }`
- 填写用户名 → `{ action: 'fill', selector: '...', value: '...' }`
- 点击登录 → `{ action: 'click', selector: '...' }`
- **点击搜索（会打开新 tab）** → `{ action: 'click', selector: '...', opensNewTab: true }`（生成脚本时须用 `Promise.all([ context.waitForEvent('page'), page.click(...) ])` 并切换到 newPage）
- 等待跳转到 dashboard → `{ action: 'waitForURL', pattern: '**/dashboard**' }`

拆解结果可保存在内存或 `/tmp/pw-instructions.json`，供「每步执行前探测、执行、执行后验证」循环使用。

---

## 第二步：DOM 探测（每步执行前必须执行）

在**生成脚本前**以及**每一步执行前**，都要运行 DOM 探测以获取当前页面可交互元素的真实属性，确保本步所用选择器能命中：

```bash
node ~/.qa-cowork/skills/ai-playwright/scripts/probe-dom.js <URL>
```

若技能脚本路径不存在，直接将以下内容写入 `/tmp/probe-dom.js` 执行：

```javascript
const { chromium } = require('playwright');
const url = process.argv[2];
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/pw-probe.png' });
  const info = await page.evaluate(() => {
    const getInfo = el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      type: el.getAttribute('type') || null,
      placeholder: el.getAttribute('placeholder') || null,
      text: (el.innerText || el.value || '').trim().slice(0, 60) || null,
      'data-testid': el.getAttribute('data-testid') || null,
      'aria-label': el.getAttribute('aria-label') || null,
      classes: [...el.classList].join(' ') || null,
    });
    return {
      title: document.title,
      inputs: [...document.querySelectorAll('input,textarea,select')].map(getInfo),
      buttons: [...document.querySelectorAll('button,[role="button"],[type="submit"]')].slice(0,20).map(getInfo),
      forms: [...document.querySelectorAll('form')].map(f => ({
        id: f.id, fields: [...f.querySelectorAll('input,textarea,select')].map(getInfo)
      })),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
```

**分析探测结果**，按优先级选择选择器（见 [references/selectors.md](references/selectors.md)）。

**重要**：DOM 探测必须在**当前激活的 tab** 对应的页面上执行。若脚本内存在多 tab（见下节），探测前先通过 `context.pages()` 与 `page` 引用确定当前操作的是哪一个 page，再对该 page 执行探测或传入其 URL 运行探测脚本。

---

## 多标签页与当前激活 tab（重要）

点击、导航、选择等操作后，结果可能**在当前 tab 打开**，也可能在**新 tab 打开**；关闭窗口后，**激活的 tab 会变化**。后续的 DOM 探测和截图**必须**在**当前激活的 tab** 上进行，否则下一步操作或脚本内容会错位。

### 每步执行前：核实 tab 状态（必须执行）

在**知情每一步前**，必须核实：
1. **是否有新浏览器 tab 已打开？** 若上一步或此前操作打开了新 tab 而尚未切换，先通过 `context.pages()` 识别新 page 并切换到目标 tab。
2. **是否在激活的 tab 下操作？** 所有 DOM 探测、截图、click/fill 等必须在「当前操作的 page」即激活的 tab 上进行，避免在错误 tab 上执行导致步骤错位。

### 每步执行后：区分打开方式

1. **已知会打开新 tab 的步骤**（指令含 `opensNewTab: true`）：**必须**在生成脚本时使用 `Promise.all([ context.waitForEvent('page'), page.click(...) ])` 在点击时同时等待新 page，从而**精确得到新 tab 的 page 引用**，避免依赖「新 tab 是最后一个」的假设（不同环境下顺序可能不一致）。
2. **可能打开新 tab 的操作**（未预先标注时）：执行后通过比较执行前后 `context.pages().length` 或 `context.pages()` 列表检测是否出现新 tab；若出现，通过「新出现的 page」（见 [playwright-api.md](references/playwright-api.md) 的检测方式）切换到新 tab，**不要**仅假设 `pages()[pages().length-1]` 就是新 tab。
3. **若新 tab 已打开**：
   - **切换到新 tab**：使用上一步得到的 newPage 或可靠识别出的新 page，后续操作、探测、截图均在该 `page` 上进行。
   - 等待新页面加载就绪（如 `await newPage.waitForLoadState('networkidle')`）后，**在当前激活的 tab（即该新 page）上**进行 DOM 探测和截图，再根据探测结果继续下一步。
4. **若仍在当前 tab**：
   - 无需切换，**直接在当前 page 上**做 DOM 探测和截图，用于验证与下一步。

### 涉及关闭窗口的操作后

- 执行关闭 tab/窗口后，**先识别当前激活的 tab**：例如通过 `context.pages()` 得到仍存在的页面列表，当前焦点通常为最后一个或由浏览器激活顺序决定；脚本中应明确「当前操作 page」变量并更新为关闭后仍存在且需继续操作的那个 page。
- **【重要】务必在识别出的当前激活 tab 上**进行 DOM 探测和截图，用于：
  - 验证关闭是否达到预期；
  - 生成或修正下一步指令；
  - 保证后续脚本内容与当前可见页面一致。

### 原则小结

| 场景 | 要求 |
|------|------|
| 每步执行前 | **先核实**：是否有新 tab 已打开需切换？是否在**激活的 tab** 下操作？再在当前激活的 tab 上做 DOM 探测 |
| 每步执行后（已知 opensNewTab） | 用 `waitForEvent('page')` 得到 newPage，切换到新 tab，再在**激活的 tab** 上探测 + 截图 |
| 每步执行后（可能新 tab） | 若新 tab 打开则可靠识别并切换到新 tab，再在**激活的 tab** 上探测 + 截图 |
| 每步执行后（未新 tab） | 在当前 tab 上探测 + 截图 |
| 关闭 tab/窗口后 | 识别新的**激活 tab**，仅在该 tab 上探测 + 截图，用于下一步与脚本生成 |

脚本模板中应维护「当前 page」变量，在检测到新 page 时切换为该 page，在关闭 page 后更新为剩余页面中的激活页，并始终用该 page 调用 `step()`、截图与探测。参见 [references/playwright-api.md](references/playwright-api.md) 的「多标签页与当前激活页」。

---

## 第三步：生成并执行脚本（支持按步验证与自我修复）

将脚本写入 `/tmp/pw-task.js`，每个动作对应一步，使用带截图的 `step()` 包装，便于「每步后截图验证」与失败时重试或重新生成该步。**必须维护「当前操作的 page」**，在出现新 tab 时切换到新 page，在关闭 tab 后更新为当前激活的 page，并始终在该 page 上截图与探测。执行时可整脚本运行，或在自我修复循环中按步执行（单步执行时需保持同一 context，并明确当前 page）。

```javascript
const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = '/tmp/pw-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;

// 当前操作的 page，新 tab 打开或关闭 tab 后需更新
function getActivePage(context) {
  const pages = context.pages();
  return pages.length ? pages[pages.length - 1] : null; // 最后一个是当前激活，按需调整
}

async function step(page, desc, fn) {
  n++;
  console.log(`[步骤 ${n}] ${desc}`);
  await fn();
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-${desc.replace(/\W/g,'_').slice(0,20)}.png` });
    console.log(`  ✓ 截图: ${SHOTS}/${String(n).padStart(2,'0')}-*.png`);
  }
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let page = await context.newPage();
  try {
    // === 填入具体任务步骤，可能打开新 tab 时用 Promise.all 等待新 page ===
    await step(page, '导航', () => page.goto('URL', { waitUntil: 'networkidle' }));
    // 若点击会打开新 tab，先等待新 page 再切换为当前操作 page：
    // await step(page, '点击打开新页', async () => {
    //   const [newPage] = await Promise.all([ context.waitForEvent('page'), page.click('a[target="_blank"]') ]);
    //   await newPage.waitForLoadState('networkidle');
    //   page = newPage;  // 切换到新 tab，后续探测与截图均在该 page
    // });
    // 关闭 tab 后更新当前 page： page.close(); page = getActivePage(context);
    // await step(page, '填写用户名', () => page.fill('#username', 'value'));
    console.log(`\n✅ 完成！截图目录: ${SHOTS}`);
  } catch (e) {
    const active = getActivePage(context);
    if (active && !active.isClosed()) await active.screenshot({ path: `${SHOTS}/ERROR.png` });
    console.error('❌ 失败:', e.message);
  } finally {
    await browser.close();
  }
})();
```

执行：优先用已解析的绝对路径 `"$NODE" /tmp/pw-task.js`，否则 `node /tmp/pw-task.js`。

---

## 第四步：截图验证与自我修复循环

每步执行后**必须**使用 Read 工具读取该步截图验证结果，例如：
```
Read → /tmp/pw-screenshots/01-*.png
```

根据截图判断该步是否达到预期（元素出现、页面跳转、内容变化等）。**若未达预期，进入自我修复流程**（见下）。

---

## 自我修复与进化（强制流程）

执行时按**单步**推进，每步都遵循「执行前探测 → 执行 → 执行后验证」，失败则修复后重试，直至成功或触发升级策略。

### 每步执行前：核实 tab 状态 + DOM 探测

- **先核实**：(1) 是否有新浏览器 tab 已打开需要切换？若有则切换到目标 tab。(2) 当前是否在激活的 tab 下操作？所有操作必须在当前操作的 page 上进行。
- 若本步涉及具体元素（如 `click`、`fill`、`waitForSelector`），**再在当前激活的 tab（当前操作的 page）上运行 DOM 探测**（该 page 的 URL 或已打开页面），确认本步使用的选择器在探测结果中存在且可唯一命中。
- 若探测发现选择器不存在、匹配多个或被遮挡，**先根据探测结果和 [references/selectors.md](references/selectors.md) 调整本步的选择器或动作**，再执行。

### 每步执行后：识别激活 tab + 截图验证

- 执行本步后，**先识别当前激活的 tab**：若本步打开了新 tab，则切换到新 tab（更新「当前 page」）；若执行了关闭 tab，则从 `context.pages()` 中确定新的激活 page。**之后所有探测与截图均在该激活 tab 上进行。**
- 在该激活 tab 上保存截图（如 `step()` 已写入 `/tmp/pw-screenshots/`），用 Read 工具读取截图。
- **验证标准**：本步预期是否达成（例如目标元素可见、表单已填写、URL 已变化、目标文本出现、或已正确切换到新 tab 等）。
- 若**验证通过**：进入下一步。
- 若**验证未通过**：进入「失败重试」流程。

### 失败重试（同一指令）

1. **重新探测 DOM**：在**当前激活的 tab** 上再跑一次探测脚本（使用该 tab 的 URL 或对应 page），获取最新 inputs/buttons/forms 等。
2. **分析页面结构**：结合截图与探测结果，判断是选择器失效、元素未出现、被遮挡、页面已跳转，还是操作后未正确切换到新 tab 等。
3. **重新生成该步指令**：根据分析结果修正选择器（优先 data-testid、aria-label、id、name 等）、或改用 `waitForSelector`/`waitForLoadState`、或拆分成本步「先等待再操作」。
4. **再次执行并截图验证**：用新指令执行该步，再次截图并验证。
5. **循环**：若仍未通过，重复 1→2→3→4，直至该步验证通过。

### 连续三次失败：刷新页面

- 若**同一指令**经上述重试后**连续 3 次**仍未通过验证，则：
  - 执行 **`reload`** 刷新当前页面；
  - 再对该步重新执行「执行前探测 → 执行 → 执行后验证」；
  - 若刷新后验证通过，继续下一步；若仍不通过，进入「重启浏览器」流程。

### 刷新后仍不成功：重启浏览器并重新生成脚本

- 若刷新页面后该步**仍然无法**通过验证，则：
  - **关闭当前 Chrome/Chromium 浏览器**（确保进程退出）；
  - **重新生成完整脚本**：根据当前任务与已知失败点，重新拆解指令、重新做一次全局 DOM 探测（从首步 URL 开始），生成新的 `/tmp/pw-task.js`（或项目内脚本）；
  - **重新启动浏览器**并从头执行新脚本，仍按「每步前探测、每步后验证、失败则重试→3 次刷新→仍失败再重启」执行。

### 小结

| 阶段 | 动作 |
|------|------|
| 每步前 | **先核实**是否有新 tab 需切换、是否在激活 tab；再在**当前激活 tab** 上 DOM 探测，确保选择器可命中 |
| 每步后 | 识别新 tab / 当前 tab，若新 tab 则切换；在**激活 tab** 上探测 + 截图 |
| 截图验证 | 在**激活 tab** 的截图上验证是否达预期 |
| 未达预期 | 在激活 tab 上重新探测 → 分析 → 重新生成该步指令 → 再执行再验证（循环） |
| 同一指令 3 次失败 | 刷新当前页，再执行该步并验证 |
| 刷新后仍失败 | 关闭浏览器 → 重新生成完整脚本 → 重启浏览器从头执行 |

---

## 常用等待模式

```javascript
await page.waitForSelector('#id', { timeout: 5000 });   // 等待元素出现
await page.waitForURL('**/dashboard**');                  // 等待URL
await page.waitForLoadState('networkidle');               // 等待网络空闲
await page.waitForSelector('text=成功');                  // 等待文本出现
```

---

## 脚本职责：仅网页操作

- **自动化脚本只负责浏览器操作**：导航、等待、点击、填写、截图、提取数据（可写入 JSON/HTML 到项目目录）。不在此脚本内内嵌「生成 PDF」「生成 Excel」等文件生成逻辑。
- **生成 PDF/文件**：若任务需要「根据数据或页面生成 PDF/Excel」等，使用 **generate-file** 技能：先由本脚本完成采集并写出数据或 HTML，再通过独立脚本或 generate-file 技能生成最终文件。每次「执行」仅重新跑当前自动化脚本完成网页操作。

### 每次执行都要最新数据（先抓取再生成）

- 当用户希望**每次生成新内容都使用最新数据**（如热搜、新闻、实时报表），而当前要执行的脚本是「读取本地 JSON/数据文件再生成 PDF 或报告」时：
  - **必须先执行数据抓取**：先运行负责打开网页、抓取并写入 JSON/HTML 的脚本（或脚本中的抓取步骤），再执行依赖该数据的「生成 PDF/报告」脚本。
  - **不得默认使用本地已有 JSON**：除非用户明确说「使用本地数据」「用旧数据」，否则应把「执行」理解为：先抓取最新数据，再生成内容。
- 实现方式任选其一：同一项目中先执行抓取脚本再执行生成脚本；或将「抓取 + 写出数据」与「读取数据 + 生成文件」合并为一个流水线脚本，每次执行时先跑抓取再跑生成。

## 脚本固化

任务成功后：
- **自动化模式（RPA 项目）**：将脚本保存到当前项目目录（系统会提供路径），并按命名规则使用 `*_vN.js`。
- **其他模式**：可保存到 `~/.qa-cowork/scripts/<chat-id>/pw-task.js`，并告知用户路径。

---

## 参考文档

- 选择器优先级策略（自我修复时据此调整选择器）：[references/selectors.md](references/selectors.md)
- 完整 Playwright API（动作指令与之对应）：[references/playwright-api.md](references/playwright-api.md)
