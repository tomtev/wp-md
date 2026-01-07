import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, CONTENT_TYPES, loadState } from '../config.js';
import { hashContent } from '../sync/content.js';

export async function statusCommand() {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  console.log(chalk.bold('\n📊 Sync Status\n'));
  console.log(`Site: ${chalk.cyan(config.siteUrl)}`);

  if (state.lastSync) {
    console.log(`Last sync: ${chalk.dim(new Date(state.lastSync).toLocaleString())}`);
  } else {
    console.log(`Last sync: ${chalk.dim('Never')}`);
  }

  console.log('');

  const modified = [];
  const newLocal = [];
  const synced = [];

  for (const type of Object.keys(CONTENT_TYPES)) {
    const typeConfig = CONTENT_TYPES[type];
    const typeDir = join(process.cwd(), contentDir, typeConfig.folder);

    let files;
    try {
      files = await readdir(typeDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = join(typeDir, file);
      const relativePath = join(contentDir, typeConfig.folder, file);

      const content = await readFile(filepath, 'utf-8');
      const hash = hashContent(content);

      const existingState = state.files[relativePath];

      if (!existingState) {
        newLocal.push({ path: relativePath, type });
      } else if (existingState.localHash !== hash) {
        modified.push({ path: relativePath, type });
      } else {
        synced.push({ path: relativePath, type });
      }
    }
  }

  // Group by type for display
  const displaySection = (title, items, color) => {
    if (items.length === 0) return;

    console.log(chalk.bold(title));
    const byType = {};
    for (const item of items) {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(item.path);
    }

    for (const [type, paths] of Object.entries(byType)) {
      console.log(chalk.dim(`  ${CONTENT_TYPES[type].label}:`));
      for (const path of paths) {
        console.log(color(`    ${path}`));
      }
    }
    console.log('');
  };

  displaySection('Modified (not pushed):', modified, chalk.yellow);
  displaySection('New local files:', newLocal, chalk.green);

  if (modified.length === 0 && newLocal.length === 0) {
    console.log(chalk.green('✓ All files are in sync'));
    console.log(chalk.dim(`  ${synced.length} files tracked`));
  } else {
    console.log(chalk.dim('Run `wp-sync push` to upload changes'));
  }

  console.log('');
}
