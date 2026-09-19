// Renders the share card and the home-screen icons from the HTML next to this file into public/.
// Uses the Chromium that is already on the machine (Edge on Windows, Chrome elsewhere) in headless mode: no dependencies.
//   node tools/brand/make.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), pub = resolve(here, '../../public');
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!browser) { console.error('No Chromium-based browser found. Set CHROME_PATH.'); process.exit(1); }

const shots = [
  { page: 'og.html', out: 'og.png', w: 1200, h: 630 },
  { page: 'icon.html', out: 'icon-512.png', w: 512, h: 512 },
  { page: 'icon.html', out: 'icon-192.png', w: 512, h: 512, scale: 192 / 512 }, // a headless window cannot be this small: drawn at 512, scaled by the browser
  { page: 'icon.html', out: 'apple-touch-icon.png', w: 512, h: 512, scale: 180 / 512 },
];
for (const s of shots) {
  const out = resolve(pub, s.out);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${s.scale ?? 1}`, `--window-size=${s.w},${s.h}`, '--virtual-time-budget=6000', `--screenshot=${out}`, pathToFileURL(resolve(here, s.page)).href], { stdio: 'ignore', timeout: 60_000 });
  console.log(s.out, statSync(out).size, 'bytes');
}
