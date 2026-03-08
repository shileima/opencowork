---
name: generate-file
description: 通用「生成 PDF / 导出文件」技能。当需要根据数据、HTML 或页面内容生成 PDF、Excel、JSON 等文件时使用本技能；与浏览器自动化脚本分离，自动化脚本只负责网页操作与数据采集，文件生成作为独立步骤或独立脚本。
---

# 生成 PDF / 导出文件（通用技能）

## 何时使用

- 用户要求「生成 PDF」「导出为 PDF」「把数据/报表保存成文件」
- 已有数据（JSON、HTML、表格）需要输出为 PDF、Excel、CSV 等
- **不要**在 RPA/Playwright 自动化脚本里内嵌完整的 PDF 生成逻辑；自动化脚本只做：打开页面、点击、填写、**采集数据或生成 HTML**，生成文件由本技能或独立脚本完成

## 原则

1. **自动化脚本职责**：仅负责浏览器操作（导航、点击、填写、截图、提取数据）。可输出结构化数据（如写入 `xxx.json`）或生成供打印的 HTML，但不直接混入 PDF 生成库调用（如 pdf-lib、reportlab）在同一个「主流程」里。
2. **文件生成方式**（任选其一）：
   - **独立脚本**：单独一个脚本（如 `generate_pdf.js` / `export_report.py`）读取前置任务产出的数据或 HTML，调用 pdf-lib / Playwright `page.pdf()` / reportlab 等生成 PDF 或其它文件。
   - **Playwright 仅用于 PDF**：若只需「当前页面导出为 PDF」，可用 Playwright 的 `page.pdf()` 单独写一个极简脚本，与主自动化脚本分开。
3. **数据流**：前置任务（如抓取热搜）→ 写入 `data.json`（或 HTML）→ 本技能或独立脚本读取并生成 `report.pdf` / `export.xlsx` 等。

## 方式一：Node.js（pdf-lib / Playwright page.pdf）

### 从数据生成 PDF（pdf-lib）

```javascript
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');

async function generateFromData(jsonPath, outputPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = page.getHeight() - 50;
  for (const item of data.items) {
    page.drawText(item.title || '', { x: 50, y, size: 12, font });
    y -= 20;
  }
  const pdfBytes = await doc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}
generateFromData('data.json', 'output.pdf').catch(console.error);
```

### 从 HTML 页面导出 PDF（Playwright，独立小脚本）

```javascript
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync('report.html', 'utf-8'), { waitUntil: 'networkidle' });
  await page.pdf({ path: 'report.pdf', format: 'A4' });
  await browser.close();
})();
```

## 方式二：Python（reportlab / pdf 库）

- 参考 `pdf/SKILL.md`：用 reportlab 生成 PDF、pdfplumber/pypdf 处理已有 PDF。
- 数据来源：由自动化脚本或前置步骤写入的 JSON/CSV，再由 Python 脚本读取并生成 PDF。

## 与自动化脚本的配合

| 步骤 | 负责方 | 产出 |
|------|--------|------|
| 打开网页、登录、点击、翻页 | RPA 脚本（ai-playwright） | 页面截图、或写入 `data.json` / `report.html` |
| 根据 data.json 或 report.html 生成 PDF/Excel | 本技能（独立脚本或工具） | `report.pdf`、`export.xlsx` 等 |

- 若用户说「先抓取 XX 再生成 PDF」：先写/跑自动化脚本得到数据或 HTML，再写/跑生成文件的脚本。
- 执行时：每次「执行」仅重新跑当前选中的自动化脚本；生成文件脚本由用户需要时单独执行，或由 AI 指导用户按顺序执行两个脚本。

### 每次生成都要最新数据（不要用旧 JSON）

- 当用户要求**每次生成新内容、用最新消息/数据**（如热搜、新闻、实时报表）时：
  - **不要**默认从本地已有 JSON 读取并生成，否则会产出基于旧数据的内容。
  - **正确做法**：先通过 ai-playwright 执行**抓取步骤**（打开页面、采集数据、写入 `xxx.json` 或 HTML），再用本次抓取得到的数据调用本技能或独立脚本生成 PDF/文件。
  - 即：每次「执行」= 先抓取最新数据 → 再生成文件；除非用户明确说「使用本地数据」「用旧数据」。

## 参考

- 已有 PDF 的合并、拆分、填表等：见 `pdf/SKILL.md`、`pdf/forms.md`。
- 自动化脚本规范：见 `ai-playwright/SKILL.md`（脚本只做网页操作，不内嵌文件生成逻辑）。
