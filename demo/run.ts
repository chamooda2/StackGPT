// End-to-end demo: drives the real, built extension in Chrome against the running API through four scenarios,
// screenshots each panel to demo/out/, then removes everything the demo user wrote.
//
//   pnpm demo          headless
//   pnpm demo:show     visible browser, slowed down (for presenting)
//
// Needs: docker compose db (seeded), the API running, and `pnpm build` in extension/.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { conversation, type Block } from './page.ts';

const e = process.env;
const API = e.WXT_API_BASE ?? 'http://localhost:8080';
const EXT = resolve(import.meta.dirname, '../extension/.output/chrome-mv3');
const OUT = resolve(import.meta.dirname, 'out');
const SHOW = process.argv.includes('--show');
const CHROME = e.CHROME_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(existsSync);

interface Scenario {
  name: string;
  question: string;
  answer: Block[];
  expect: RegExp;
  /** Clicked in "Did ChatGPT's answer work for you?" after the check. */
  report?: 'Worked' | 'Partly' | "Didn't work";
  /** Expected badge after reloading and checking again (shows the report was stored). */
  recheck?: RegExp;
}

const SCENARIOS: Scenario[] = [
  {
    name: '1-verified',
    question: 'pip install fails on Ubuntu 24.04 with error: externally-managed-environment. How do I fix it?',
    answer: [
      { p: 'This happens because Ubuntu marks its system Python as externally managed (PEP 668). Use a virtual environment:' },
      { h: '1. Install the venv module' },
      { code: 'sudo apt install python3-venv', lang: 'Bash' },
      { h: '2. Create and activate a virtual environment' },
      { code: 'python3 -m venv .venv\nsource .venv/bin/activate', lang: 'Bash' },
      { h: '3. Install your package' },
      { code: 'pip install requests', lang: 'Bash' },
    ],
    expect: /^Verified fix · \d+ of \d+ worked$/,
  },
  {
    name: '2-conflicting',
    question: "My Samsung Galaxy A14 won't super fast charge even though I bought a 25W Samsung charger. How do I enable it?",
    answer: [
      { p: 'Go to Settings > Battery > Charging settings and turn on Fast charging and Super fast charging.' },
      { p: 'Then use the original Samsung USB-C cable and plug straight into the 25W adapter.' },
    ],
    expect: /^Conflicting results · \d+ of \d+ worked · may not fit your setup$/,
  },
  {
    name: '3-outdated',
    question: 'import pandas crashes: A module that was compiled using NumPy 1.x cannot be run in NumPy 2.0.0. What should I do?',
    answer: [
      { p: 'Pin NumPy below 2 until all your dependencies support it:' },
      { code: 'python -m pip install "numpy<2"', lang: 'Bash' },
    ],
    expect: /^Outdated fix · \d+ of \d+ worked$/,
  },
  {
    name: '4-new-fix',
    question: 'The horizontal scroll wheel on my Logitech MX Master 3S stopped working, but only in Chrome on Windows 11.',
    answer: [
      { h: '1. Disable smooth scrolling in Chrome' },
      { p: 'Open chrome://flags, search for "Smooth Scrolling", set it to Disabled and restart Chrome.' },
      { h: '2. Check Logi Options+' },
      { p: 'In Logi Options+, remove any Chrome-specific settings for the thumb wheel.' },
    ],
    expect: /^New fix · no community evidence yet$/,
    report: 'Worked',
    recheck: /^Unverified · 1 of 1 worked$/,
  },
];

const badgeText = (page: Page) => page.$eval('stackgpt-check >>> button.sg-badge', b => b.textContent ?? '');

async function check(page: Page, url: string): Promise<string> {
  await page.goto(url);
  const btn = await page.waitForSelector('stackgpt-check >>> button.sg-badge', { timeout: 15_000 });
  await btn!.click();
  await page.waitForSelector('stackgpt-check >>> button.sg-badge[aria-expanded="true"]', { timeout: 20_000 });
  return (await badgeText(page)).replace(/^StackGPT/, '').trim();
}

async function preflight() {
  const problems: string[] = [];
  try {
    const r = await fetch(`${API}/actuator/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) problems.push(`API at ${API} answered ${r.status}`);
  } catch {
    problems.push(`API not reachable at ${API} (cd api; ./mvnw spring-boot:run)`);
  }
  if (!existsSync(`${EXT}/manifest.json`)) problems.push('extension not built (cd extension; pnpm build)');
  else {
    const m = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'));
    if (!m.host_permissions?.includes(`${new URL(API).origin}/*`))
      problems.push(`extension was built for ${m.host_permissions}, not ${API} (rebuild with WXT_API_BASE=${API})`);
  }
  if (!CHROME) problems.push('Chrome not found (set CHROME_PATH)');
  if (problems.length) {
    console.error(`Cannot run the demo:\n  - ${problems.join('\n  - ')}`);
    process.exit(2);
  }
}

/** Gives the extension a known anonymous token, so the demo user can be removed afterwards. */
async function useToken(browser: Browser, token: string) {
  const sw = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15_000 });
  const worker = (await sw.worker())!;
  await worker.evaluate(t => chrome.storage.local.set({ token: t }), token);
}

/** Deletes the demo user, its reports, votes and flags, and the problems/solutions it submitted. */
async function cleanup(token: string) {
  const db = new pg.Client({
    host: e.PGHOST ?? 'localhost', port: Number(e.DB_PORT ?? 5433), database: e.POSTGRES_DB ?? 'stackgpt',
    user: e.POSTGRES_USER ?? 'stackgpt', password: e.POSTGRES_PASSWORD ?? 'stackgpt',
  });
  await db.connect();
  try {
    const hash = createHash('sha256').update(token).digest('hex');
    const { rows } = await db.query<{ id: string }>('select id from users where token = $1', [hash]);
    if (!rows.length) return 0;
    const id = rows[0]!.id;
    await db.query('begin');
    await db.query('delete from problems where user_id = $1', [id]);
    await db.query('delete from solutions where user_id = $1', [id]);
    await db.query('delete from users where id = $1', [id]);
    await db.query('commit');
    return 1;
  } finally {
    await db.end();
  }
}

await preflight();
mkdirSync(OUT, { recursive: true });
const token = randomBytes(32).toString('hex');
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !SHOW,
  slowMo: SHOW ? 40 : 0,
  pipe: true,
  enableExtensions: [EXT],
  defaultViewport: { width: 1100, height: 1000 },
});
let failed = 0;
try {
  await useToken(browser, token);
  const page = await browser.newPage();
  const pages = new Map(SCENARIOS.map(s => [`https://chatgpt.com/c/demo-${s.name}`, conversation(s.name, s.question, s.answer)]));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const html = pages.get(r.url());
    if (html) r.respond({ status: 200, contentType: 'text/html', body: html });
    else if (r.url().startsWith('https://chatgpt.com/')) r.respond({ status: 204, body: '' });
    else r.continue();
  });

  for (const s of SCENARIOS) {
    const url = `https://chatgpt.com/c/demo-${s.name}`;
    const got = await check(page, url);
    let ok = s.expect.test(got);
    let line = `${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(14)} ${got}`;
    if (ok && s.report) {
      const [btn] = await page.$$(`stackgpt-check >>> .sg-report button.sg-btn-${s.report === 'Worked' ? 'worked' : s.report === 'Partly' ? 'partial' : 'failed'}`);
      await btn!.click();
      await page.waitForSelector('stackgpt-check >>> .sg-report button[aria-pressed="true"]', { timeout: 20_000 });
      await (await page.$('stackgpt-check'))!.screenshot({ path: `${OUT}/${s.name}-reported.png` });
      const again = await check(page, url);
      const ok2 = !s.recheck || s.recheck.test(again);
      ok = ok && ok2;
      line += `\n${ok2 ? 'PASS' : 'FAIL'}  ${(s.name + ' again').padEnd(14)} ${again}`;
    }
    await (await page.$('stackgpt-check'))!.screenshot({ path: `${OUT}/${s.name}.png` });
    if (!ok) failed++;
    console.log(line);
  }
} finally {
  await browser.close();
  const removed = await cleanup(token);
  console.log(`\nScreenshots in ${OUT}. Demo data ${removed ? 'removed' : 'not found (nothing written)'}.`);
}
process.exit(failed ? 1 : 0);
