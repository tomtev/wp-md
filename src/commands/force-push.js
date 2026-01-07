import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, CONTENT_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { markdownToWp, wpToMarkdown, hashContent } from '../sync/content.js';

export async function forcePushCommand(options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  const client = new WordPressClient(config);
  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  console.log(chalk.bold('\n🚀 Force Push - Syncing all content to WordPress\n'));
  console.log(chalk.yellow('This will create or update ALL content in WordPress.\n'));

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run mode - no changes will be made\n'));
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  // Process each content type (except media and global styles)
  const typesToPush = ['post', 'page', 'wp_navigation', 'wp_template', 'wp_template_part', 'wp_block'];

  for (const type of typesToPush) {
    const typeConfig = CONTENT_TYPES[type];
    if (!typeConfig) continue;

    const typeDir = join(process.cwd(), contentDir, typeConfig.folder);

    let files;
    try {
      files = await readdir(typeDir);
    } catch {
      continue; // Directory doesn't exist
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) continue;

    const spinner = ora(`Processing ${typeConfig.label}...`).start();

    for (const file of mdFiles) {
      const filepath = join(typeDir, file);
      const relativePath = join(contentDir, typeConfig.folder, file);

      try {
        const content = await readFile(filepath, 'utf-8');
        const parsed = markdownToWp(content);

        if (options.dryRun) {
          if (parsed.id) {
            spinner.info(`Would update: ${relativePath} (ID: ${parsed.id})`);
          } else {
            spinner.info(`Would create: ${relativePath}`);
          }
          continue;
        }

        let resultId;
        let isNew = false;

        if (parsed.id) {
          // Try to update existing
          try {
            await client.update(type, parsed.id, parsed.data);
            resultId = parsed.id;
            updated++;
          } catch (error) {
            if (error.message.includes('404') || error.message.includes('Invalid')) {
              // Entity doesn't exist, create new
              const created_item = await client.create(type, parsed.data);
              resultId = created_item.id;
              isNew = true;
              created++;
            } else {
              throw error;
            }
          }
        } else {
          // No ID, create new
          const created_item = await client.create(type, parsed.data);
          resultId = created_item.id;
          isNew = true;
          created++;
        }

        // If new entity was created, update local file with new ID
        if (isNew && resultId) {
          const item = await client.fetchOne(type, resultId);
          const newMarkdown = wpToMarkdown(item, type);
          await writeFile(filepath, newMarkdown);

          const hash = hashContent(newMarkdown);
          state.files[relativePath] = {
            id: resultId,
            type: type,
            localHash: hash,
            remoteHash: hash,
            lastSync: new Date().toISOString(),
          };
        } else {
          // Just update state
          const hash = hashContent(content);
          state.files[relativePath] = {
            id: resultId,
            type: type,
            localHash: hash,
            remoteHash: hash,
            lastSync: new Date().toISOString(),
          };
        }

      } catch (error) {
        spinner.fail(`${relativePath}: ${error.message}`);
        failed++;
        spinner.start(`Processing ${typeConfig.label}...`);
      }
    }

    spinner.succeed(`${typeConfig.label}: ${mdFiles.length} files`);
  }

  if (!options.dryRun) {
    state.lastSync = new Date().toISOString();
    await saveState(state);
  }

  console.log(chalk.bold('\n📊 Summary'));
  console.log(`   Created: ${chalk.green(created)}`);
  console.log(`   Updated: ${chalk.blue(updated)}`);
  if (failed > 0) {
    console.log(`   Failed: ${chalk.red(failed)}`);
  }
  console.log('');

  if (created > 0) {
    console.log(chalk.dim('Note: Local files updated with new WordPress IDs.'));
  }
}
