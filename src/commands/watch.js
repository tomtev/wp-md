import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, relative } from 'path';
import chalk from 'chalk';
import chokidar from 'chokidar';
import { loadConfig, CONTENT_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { markdownToWp, wpToMarkdown, mediaToMarkdown, generateFilename, hashContent } from '../sync/content.js';

// Track files being written by poll to avoid triggering push
const writingFiles = new Set();

export async function watchCommand(options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  const client = new WordPressClient(config);
  const contentDir = join(process.cwd(), config.contentDir || 'content');
  const pollInterval = parseInt(options.poll) || 0;

  console.log(chalk.bold('\n🔄 Sync watching...\n'));
  console.log(`Content directory: ${chalk.cyan(contentDir)}`);
  console.log(`Local → WordPress: ${chalk.green('✓ enabled')}`);
  console.log(`WordPress → Local: ${pollInterval > 0 ? chalk.green(`✓ polling every ${pollInterval}s`) : chalk.dim('✗ disabled (use --poll <seconds>)')}`);
  console.log(chalk.dim('\nPress Ctrl+C to stop\n'));

  const debounceTimers = new Map();
  const debounceMs = parseInt(options.debounce) || 1000;

  // File watcher for local → WordPress
  const watcher = chokidar.watch(`${contentDir}/**/*.md`, {
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

    const relativePath = relative(process.cwd(), filepath);
    const contentType = getContentType(filepath, contentDir);

    if (!contentType) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.dim(`[${timestamp}]`), chalk.blue('↑ Local change:'), relativePath);

    try {
      const content = await readFile(filepath, 'utf-8');
      const parsed = markdownToWp(content);
      const state = await loadState();

      if (parsed.id) {
        await client.update(parsed.type, parsed.id, parsed.data);
        console.log(chalk.dim(`[${timestamp}]`), chalk.green('✓ Pushed:'), relativePath);
      } else {
        const created = await client.create(parsed.type, parsed.data);
        parsed.id = created.id;
        console.log(chalk.dim(`[${timestamp}]`), chalk.green('✓ Created:'), relativePath, chalk.dim(`(ID: ${created.id})`));
      }

      const hash = hashContent(content);
      state.files[relativePath] = {
        id: parsed.id,
        type: parsed.type,
        localHash: hash,
        remoteHash: hash,
        lastSync: new Date().toISOString(),
      };
      await saveState(state);

    } catch (error) {
      console.log(chalk.dim(`[${timestamp}]`), chalk.red('✗ Push failed:'), error.message);
    }
  };

  const debouncedChange = (filepath) => {
    if (debounceTimers.has(filepath)) {
      clearTimeout(debounceTimers.get(filepath));
    }
    debounceTimers.set(filepath, setTimeout(() => {
      debounceTimers.delete(filepath);
      handleLocalChange(filepath);
    }, debounceMs));
  };

  watcher.on('change', debouncedChange);

  watcher.on('add', async (filepath) => {
    // Skip if this file is being written by the poll function
    if (writingFiles.has(filepath)) {
      return;
    }

    const relativePath = relative(process.cwd(), filepath);
    const state = await loadState();
    const timestamp = new Date().toLocaleTimeString();

    // Check if file exists in state (was created via CLI)
    if (!state.files[relativePath]) {
      console.log(chalk.dim(`[${timestamp}]`), chalk.yellow('⚠ Manual file added:'), relativePath);
      console.log(chalk.yellow('  Warning: Files should be created via CLI commands:'));
      console.log(chalk.dim('    wp-sync new <type> "Title"    # Create post/page/template'));
      console.log(chalk.dim('    wp-sync pull                  # Pull from WordPress'));
      console.log(chalk.yellow('  This file will NOT sync until created in WordPress first.'));
      return;
    }

    // File exists in state, process normally
    debouncedChange(filepath);
  });

  watcher.on('unlink', async (filepath) => {
    const relativePath = relative(process.cwd(), filepath);
    const state = await loadState();
    const timestamp = new Date().toLocaleTimeString();

    if (state.files[relativePath]) {
      console.log(chalk.dim(`[${timestamp}]`), chalk.red('⚠ Manual file deleted:'), relativePath);
      console.log(chalk.yellow('  Warning: Content still exists in WordPress (ID: ' + state.files[relativePath].id + ')'));
      console.log(chalk.yellow('  To properly delete:'));
      console.log(chalk.dim('    1. Delete in WordPress admin, then run: wp-sync pull'));
      console.log(chalk.dim('    2. Or restore with: wp-sync pull --force'));

      // Remove from state to avoid confusion
      delete state.files[relativePath];
      await saveState(state);
    }
  });

  watcher.on('error', (error) => {
    console.log(chalk.red('Watcher error:'), error.message);
  });

  // Polling for WordPress → Local
  let pollTimer = null;
  if (pollInterval > 0) {
    const poll = async () => {
      await pollWordPress(client, config.contentDir || 'content');
      pollTimer = setTimeout(poll, pollInterval * 1000);
    };
    // Start first poll after a short delay
    pollTimer = setTimeout(poll, 2000);
  }

  // Clean shutdown
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\nStopping sync...'));
    watcher.close();
    if (pollTimer) clearTimeout(pollTimer);
    process.exit(0);
  });
}

async function pollWordPress(client, contentDir) {
  const timestamp = new Date().toLocaleTimeString();
  const state = await loadState();
  let pulled = 0;
  let conflicts = 0;

  // Poll each content type (except global styles and media for performance)
  const typesToPoll = ['post', 'page', 'wp_template', 'wp_template_part', 'wp_block', 'wp_navigation'];

  for (const type of typesToPoll) {
    const typeConfig = CONTENT_TYPES[type];
    if (!typeConfig) continue;

    try {
      const items = await client.fetchAll(type);

      for (const item of items) {
        const filename = generateFilename(item);
        const relativePath = join(contentDir, typeConfig.folder, filename);
        const filepath = join(process.cwd(), relativePath);

        const markdown = wpToMarkdown(item, type);
        const remoteHash = hashContent(markdown);

        const existingState = state.files[relativePath];

        if (!existingState) {
          // New remote item - pull it
          await writeFileSafe(filepath, markdown, typeConfig.folder, contentDir);
          state.files[relativePath] = {
            id: item.id,
            type: type,
            localHash: remoteHash,
            remoteHash: remoteHash,
            lastSync: new Date().toISOString(),
          };
          console.log(chalk.dim(`[${timestamp}]`), chalk.cyan('↓ New remote:'), relativePath);
          pulled++;
        } else if (existingState.remoteHash !== remoteHash) {
          // Remote changed
          try {
            const localContent = await readFile(filepath, 'utf-8');
            const localHash = hashContent(localContent);

            if (localHash === existingState.localHash) {
              // Local unchanged, safe to pull
              await writeFileSafe(filepath, markdown, typeConfig.folder, contentDir);
              state.files[relativePath] = {
                ...existingState,
                localHash: remoteHash,
                remoteHash: remoteHash,
                lastSync: new Date().toISOString(),
              };
              console.log(chalk.dim(`[${timestamp}]`), chalk.cyan('↓ Pulled:'), relativePath);
              pulled++;
            } else {
              // Both changed - conflict!
              console.log(chalk.dim(`[${timestamp}]`), chalk.yellow('⚠ Conflict:'), relativePath);
              console.log(chalk.dim('  Local and remote both changed. Use pull --force or push to resolve.'));
              conflicts++;
            }
          } catch (err) {
            // Local file doesn't exist, pull it
            await writeFileSafe(filepath, markdown, typeConfig.folder, contentDir);
            state.files[relativePath] = {
              id: item.id,
              type: type,
              localHash: remoteHash,
              remoteHash: remoteHash,
              lastSync: new Date().toISOString(),
            };
            console.log(chalk.dim(`[${timestamp}]`), chalk.cyan('↓ Pulled:'), relativePath);
            pulled++;
          }
        }
      }
    } catch (error) {
      // Silent fail for individual types
    }
  }

  if (pulled > 0 || conflicts > 0) {
    await saveState(state);
  }
}

async function writeFileSafe(filepath, content, folder, contentDir) {
  const dir = join(process.cwd(), contentDir, folder);
  await mkdir(dir, { recursive: true });

  // Mark file as being written to prevent push loop
  writingFiles.add(filepath);
  await writeFile(filepath, content);

  // Remove from writing set after a delay
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
