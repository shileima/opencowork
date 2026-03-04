#!/usr/bin/env node
/**
 * DOM 探测脚本 - 获取页面可交互元素的真实属性，用于生成精准 Playwright 选择器
 * 用法: node probe-dom.js <URL>
 */
const { chromium } = require('playwright');

const url = process.argv[2];
if (!url) {
  console.error('用法: node probe-dom.js <URL>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log(`[probe] 导航到: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: '/tmp/pw-probe.png' });
  console.log('[probe] 截图: /tmp/pw-probe.png');

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
      role: el.getAttribute('role') || null,
      classes: [...el.classList].filter(Boolean).join(' ') || null,
      visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
    });

    return {
      title: document.title,
      url: location.href,
      inputs: [...document.querySelectorAll('input,textarea,select')].map(getInfo),
      buttons: [...document.querySelectorAll('button,[role="button"],[type="submit"]')].slice(0, 20).map(getInfo),
      links: [...document.querySelectorAll('a[href]')].slice(0, 15).map(getInfo),
      forms: [...document.querySelectorAll('form')].map(f => ({
        id: f.id || null,
        action: f.getAttribute('action') || null,
        fields: [...f.querySelectorAll('input,textarea,select')].map(getInfo),
      })),
    };
  });

  console.log('\n=== DOM 探测结果 ===');
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})().catch(err => {
  console.error('[probe] 失败:', err.message);
  process.exit(1);
});
