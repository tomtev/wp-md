import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(homedir(), '.wp-md', 'version-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const REPO = 'tomtev/wp-md';

// Read version from package.json
let CURRENT_VERSION = '1.0.0';
try {
  const pkg = JSON.parse(await readFile(join(__dirname, '../../package.json'), 'utf-8'));
  CURRENT_VERSION = pkg.version;
} catch {}

async function getCache() {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function setCache(data) {
  try {
    await mkdir(join(homedir(), '.wp-md'), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // Ignore cache write errors
  }
}

async function fetchLatestVersion() {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${REPO}/main/package.json`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
    if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
  }
  return false;
}

export async function checkForUpdates() {
  try {
    // Check cache first
    const cache = await getCache();
    const now = Date.now();

    if (cache && cache.checkedAt && (now - cache.checkedAt) < CACHE_TTL) {
      // Use cached result
      if (cache.latestVersion && compareVersions(CURRENT_VERSION, cache.latestVersion)) {
        printUpdateMessage(cache.latestVersion);
      }
      return;
    }

    // Fetch latest version (don't await - run in background)
    fetchLatestVersion().then(async (latestVersion) => {
      if (latestVersion) {
        await setCache({ latestVersion, checkedAt: now });
        if (compareVersions(CURRENT_VERSION, latestVersion)) {
          printUpdateMessage(latestVersion);
        }
      }
    });
  } catch {
    // Silently fail - don't interrupt user
  }
}

function printUpdateMessage(latestVersion) {
  console.log('');
  console.log(chalk.yellow(`  Update available: ${CURRENT_VERSION} → ${latestVersion}`));
  console.log(chalk.dim(`  Run: curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash`));
  console.log('');
}

export function getCurrentVersion() {
  return CURRENT_VERSION;
}
