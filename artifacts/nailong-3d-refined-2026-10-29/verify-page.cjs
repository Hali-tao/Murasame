const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const out = __dirname;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href, { waitUntil: 'load' });
    const images = await page.locator('img').evaluateAll(nodes => nodes.map(image => ({
      src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0,
      width: image.naturalWidth, height: image.naturalHeight
    })));
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(a => a.href));
    const missingLinks = links.filter(link => link.startsWith('file:') && !fs.existsSync(fileURLToPath(link)));
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(out, 'evidence/comparison-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(out, 'evidence/comparison-mobile.png'), fullPage: true });
    const result = {
      browser: 'Existing Microsoft Edge; headless isolated context', images,
      missing_local_links: missingLinks, page_errors: errors,
      desktop_horizontal_overflow: desktopOverflow, mobile_horizontal_overflow: mobileOverflow,
      passed: images.length === 7 && images.every(i => i.loaded) && !missingLinks.length && !errors.length && !desktopOverflow && !mobileOverflow
    };
    fs.writeFileSync(path.join(out, 'evidence/browser-verification.json'), JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
