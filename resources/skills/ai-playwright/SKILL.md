---
name: ai-playwright
description: 生成可复用的 Playwright 自动化脚本。当用户明确要求"使用 ai-playwright"、"生成 Playwright 脚本"、"保存自动化脚本"时使用。提供 DOM 探测、精准选择器生成、带截图验证的完整脚本模板。不与 agent-browser 竞争——agent-browser 是执行工具，此技能是脚本生成与持久化工具。
---

# AI Playwright 浏览器自动化

**收到自动化任务后，立即执行以下流程，不需要等待用户确认。**

## 执行流程

```
任务分析 → DOM探测(获取真实选择器) → 生成完整脚本 → 执行 → 截图验证每步
```

---

## 第一步：任务拆解

将任务分解为原子操作列表，例如：
- 导航到 URL
- 等待元素 / 填写输入框 / 点击按钮
- 等待页面跳转或内容变化
- 截图确认结果 / 提取数据

---

## 第二步：DOM 探测（必须先执行）

在生成完整自动化脚本前，**先运行 DOM 探测脚本**获取页面可交互元素的真实属性：

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

---

## 第三步：生成并执行完整脚本

将完整脚本写入 `/tmp/pw-task.js`，使用带截图的 `step()` 包装每个操作：

```javascript
const { chromium } = require('playwright');
const fs = require('fs');
const SHOTS = '/tmp/pw-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;

async function step(page, desc, fn) {
  n++;
  console.log(`[步骤 ${n}] ${desc}`);
  await fn();
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-${desc.replace(/\W/g,'_').slice(0,20)}.png` });
  console.log(`  ✓ 截图: ${SHOTS}/${String(n).padStart(2,'0')}-*.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  try {
    // === 填入具体任务步骤 ===
    await step(page, '导航', () => page.goto('URL', { waitUntil: 'networkidle' }));
    // await step(page, '填写用户名', () => page.fill('#username', 'value'));
    // await step(page, '点击登录', async () => { await page.click('text=登录'); await page.waitForNavigation(); });
    console.log(`\n✅ 完成！截图目录: ${SHOTS}`);
  } catch (e) {
    await page.screenshot({ path: `${SHOTS}/ERROR.png` });
    console.error('❌ 失败:', e.message);
  } finally {
    await browser.close();
  }
})();
```

执行：`node /tmp/pw-task.js`

---

## 第四步：截图验证

每步执行后使用 Read 工具读取截图验证结果：
```
Read → /tmp/pw-screenshots/01-*.png
```

若截图显示页面未达预期：
1. 重新运行探测脚本，检查 DOM 是否动态变化
2. 调整等待策略（见常用等待模式）
3. 修正选择器后重新执行

---

## 常用等待模式

```javascript
await page.waitForSelector('#id', { timeout: 10000 });   // 等待元素出现
await page.waitForURL('**/dashboard**');                  // 等待URL
await page.waitForLoadState('networkidle');               // 等待网络空闲
await page.waitForSelector('text=成功');                  // 等待文本出现
```

---

## 脚本固化

任务成功后，将脚本保存到 `~/.qa-cowork/scripts/<chat-id>/pw-task.js`，告知用户路径。

---

## 参考文档

- 选择器优先级策略：[references/selectors.md](references/selectors.md)
- 完整 Playwright API：[references/playwright-api.md](references/playwright-api.md)
