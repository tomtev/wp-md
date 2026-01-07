import { readFile, writeFile, mkdir, readdir, access } from 'fs/promises';
import { join, relative, basename } from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { loadConfig, CONTENT_TYPES, loadState, saveState, resolveContentDir } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { markdownToWp, wpToMarkdown, mediaToMarkdown, generateFilename, hashContent } from '../sync/content.js';
import { startServer, notifyPushing, notifyPushed, notifyError, stopServer } from '../server/websocket.js';

// Track files being written by poll to avoid triggering push
const writingFiles = new Set();

export async function watchCommand(options) {
  // Discover sites to watch
  const sites = await discoverSites(options);

  if (sites.length === 0) {
    console.log(chalk.red('No sites found. Run `wp-md init` first.'));
    return;
  }

  console.log(chalk.bold('\n🔄 Watching for changes...\n'));

  // Start WebSocket server if requested
  if (options.server) {
    startServer(parseInt(options.serverPort) || 3456, sites);
  }

  // Display sites being watched
  for (const site of sites) {
    console.log(`${chalk.cyan(site.name)}: ${chalk.dim(site.url)}`);
  }
  console.log('');

  const pollInterval = parseInt(options.poll) || 0;
  console.log(`Local → WordPress: ${chalk.green('✓ enabled')}`);
  console.log(`WordPress → Local: ${pollInterval > 0 ? chalk.green(`✓ polling every ${pollInterval}s`) : chalk.dim('✗ disabled (use --poll <seconds>)')}`);
  if (options.server) {
    console.log(`WebSocket server:  ${chalk.green('✓ ws://localhost:' + (options.serverPort || 3456))}`);
  }
  console.log(chalk.dim('\nPress Ctrl+C to stop\n'));

  const debounceTimers = new Map();
  const debounceMs = parseInt(options.debounce) || 1000;

  // Create watchers for each site
  const watchers = [];
  const pollTimers = [];

  for (const site of sites) {
    const watcher = createSiteWatcher(site, debounceMs, debounceTimers, options.server);
    watchers.push(watcher);

    // Polling for WordPress → Local
    if (pollInterval > 0) {
      const poll = async () => {
        await pollWordPress(site);
        const timer = setTimeout(poll, pollInterval * 1000);
        pollTimers.push(timer);
      };
      // Start first poll after a short delay
      setTimeout(poll, 2000);
    }
  }

  // Clean shutdown
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\nStopping watch...'));
    watchers.forEach(w => w.close());
    pollTimers.forEach(t => clearTimeout(t));
    if (options.server) stopServer();
    process.exit(0);
  });
}

/**
 * Discover sites to watch based on options
 */
async function discoverSites(options) {
  const sites = [];

  if (options.all) {
    // Scan for subdirectories with .env files
    const cwd = process.cwd();
    const entries = await readdir(cwd, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const envPath = join(cwd, entry.name, '.env');
      try {
        await access(envPath);
        const config = await loadConfig(entry.name);
        if (config) {
          sites.push({
            name: entry.name,
            dir: join(cwd, entry.name),
            url: config.siteUrl,
            config,
            client: new WordPressClient(config),
          });
        }
      } catch {
        // No .env in this directory
      }
    }
  } else {
    // Single site mode
    const dir = options.dir;
    const config = await loadConfig(dir);
    if (config) {
      const resolvedDir = resolveContentDir(dir);
      sites.push({
        name: dir || basename(resolvedDir),
        dir: resolvedDir,
        url: config.siteUrl,
        config,
        client: new WordPressClient(config),
      });
    }
  }

  return sites;
}

/**
 * Create file watcher for a single site
 */
function createSiteWatcher(site, debounceMs, debounceTimers, useWebSocket) {
  const watcher = chokidar.watch(`${site.dir}/**/*.md`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  const handleLocalChange = async (filepath) => {
    // Skip if this file is being written by the poll function
    if (writingFiles.has(filepath)) {
      return;
    }

    const relativePath = relative(site.dir, filepath);
    const contentType = getContentType(filepath, site.dir);

    if (!contentType) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] ${chalk.cyan(site.name)}`;
    console.log(prefix, chalk.blue('↑'), relativePath);

    if (useWebSocket) {
      notifyPushing(site, relativePath);
    }

    try {
      const content = await readFile(filepath, 'utf-8');
      const parsed = markdownToWp(content);
      const state = await loadState(site.dir);

      let id = parsed.id;
      let slug = parsed.data.slug;

      if (parsed.id) {
        await site.client.update(parsed.type, parsed.id, parsed.data);
        console.log(prefix, chalk.green('✓'), relativePath);
      } else {
        const created = await site.client.create(parsed.type, parsed.data);
        id = created.id;
        slug = created.slug;
        console.log(prefix, chalk.green('✓'), relativePath, chalk.dim(`(ID: ${created.id})`));
      }

      const hash = hashContent(content);
      state.files[relativePath] = {
        id: id,
        type: parsed.type,
        localHash: hash,
        remoteHash: hash,
        lastSync: new Date().toISOString(),
      };
      await saveState(state, site.dir);

      if (useWebSocket) {
        notifyPushed(site, relativePath, parsed.type, id, slug);
      }

    } catch (error) {
      console.log(prefix, chalk.red('✗'), error.message);
      if (useWebSocket) {
        notifyError(site, relativePath, error.message);
      }
    }
  };

  const debouncedChange = (filepath) => {
    const key = `${site.name}:${filepath}`;
    if (debounceTimers.has(key)) {
      clearTimeout(debounceTimers.get(key));
    }
    debounceTimers.set(key, setTimeout(() => {
      debounceTimers.delete(key);
      handleLocalChange(filepath);
    }, debounceMs));
  };

  watcher.on('change', debouncedChange);

  watcher.on('add', async (filepath) => {
    if (writingFiles.has(filepath)) return;

    const relativePath = relative(site.dir, filepath);
    const state = await loadState(site.dir);
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] ${chalk.cyan(site.name)}`;

    if (!state.files[relativePath]) {
      console.log(prefix, chalk.yellow('⚠ New file:'), relativePath);
      console.log(chalk.dim('  Create via CLI: wp-md new <type> "Title"'));
      return;
    }

    debouncedChange(filepath);
  });

  watcher.on('unlink', async (filepath) => {
    const relativePath = relative(site.dir, filepath);
    const state = await loadState(site.dir);
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] ${chalk.cyan(site.name)}`;

    if (state.files[relativePath]) {
      console.log(prefix, chalk.red('⚠ Deleted:'), relativePath);
      console.log(chalk.dim('  Content still exists in WordPress. Run: wp-md pull'));

      delete state.files[relativePath];
      await saveState(state, site.dir);
    }
  });

  watcher.on('error', (error) => {
    console.log(chalk.red(`[${site.name}] Watcher error:`), error.message);
  });

  return watcher;
}

async function pollWordPress(site) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] ${chalk.cyan(site.name)}`;
  const state = await loadState(site.dir);
  let pulled = 0;

  const typesToPoll = ['post', 'page', 'wp_template', 'wp_template_part', 'wp_block', 'wp_navigation'];

  for (const type of typesToPoll) {
    const typeConfig = CONTENT_TYPES[type];
    if (!typeConfig) continue;

    try {
      const items = await site.client.fetchAll(type);

      for (const item of items) {
        const filename = generateFilename(item);
        const relativePath = join(typeConfig.folder, filename);
        const filepath = join(site.dir, relativePath);

        const markdown = wpToMarkdown(item, type);
        const remoteHash = hashContent(markdown);

        const existingState = state.files[relativePath];

        if (!existingState) {
          await writeFileSafe(filepath, markdown, typeConfig.folder, site.dir);
          state.files[relativePath] = {
            id: item.id,
            type: type,
            localHash: remoteHash,
            remoteHash: remoteHash,
            lastSync: new Date().toISOString(),
          };
          console.log(prefix, chalk.cyan('↓'), relativePath);
          pulled++;
        } else if (existingState.remoteHash !== remoteHash) {
          try {
            const localContent = await readFile(filepath, 'utf-8');
            const localHash = hashContent(localContent);

            if (localHash === existingState.localHash) {
              await writeFileSafe(filepath, markdown, typeConfig.folder, site.dir);
              state.files[relativePath] = {
                ...existingState,
                localHash: remoteHash,
                remoteHash: remoteHash,
                lastSync: new Date().toISOString(),
              };
              console.log(prefix, chalk.cyan('↓'), relativePath);
              pulled++;
            } else {
              console.log(prefix, chalk.yellow('⚠ Conflict:'), relativePath);
            }
          } catch {
            await writeFileSafe(filepath, markdown, typeConfig.folder, site.dir);
            state.files[relativePath] = {
              id: item.id,
              type: type,
              localHash: remoteHash,
              remoteHash: remoteHash,
              lastSync: new Date().toISOString(),
            };
            console.log(prefix, chalk.cyan('↓'), relativePath);
            pulled++;
          }
        }
      }
    } catch {
      // Silent fail for individual types
    }
  }

  if (pulled > 0) {
    await saveState(state, site.dir);
  }
}

async function writeFileSafe(filepath, content, folder, contentDir) {
  const dir = join(contentDir, folder);
  await mkdir(dir, { recursive: true });

  writingFiles.add(filepath);
  await writeFile(filepath, content);

  setTimeout(() => {
    writingFiles.delete(filepath);
  }, 2000);
}

function getContentType(filepath, contentDir) {
  for (const [type, config] of Object.entries(CONTENT_TYPES)) {
    if (filepath.includes(join(contentDir, config.folder))) {
      return type;
    }
  }
  return null;
}
