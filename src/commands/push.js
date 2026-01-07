import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, CONTENT_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { markdownToWp, markdownToWcProduct, parseVariationData, hashContent } from '../sync/content.js';

export async function pushCommand(options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  const client = new WordPressClient(config);
  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  console.log(chalk.bold('\n📤 Pushing changes to WordPress\n'));

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run mode - no changes will be made\n'));
  }

  const changes = await findChangedFiles(contentDir, state, options.type, options.file);

  if (changes.length === 0) {
    console.log(chalk.dim('No changes to push.'));
    return;
  }

  console.log(`Found ${changes.length} file(s) to push:\n`);

  let pushed = 0;
  let failed = 0;

  for (const change of changes) {
    const spinner = ora(`${change.relativePath}`).start();

    if (options.dryRun) {
      spinner.info(`Would push: ${change.relativePath}`);
      continue;
    }

    try {
      const content = await readFile(change.filepath, 'utf-8');

      // Special handling for WooCommerce products
      if (change.type === 'product') {
        const result = await pushWcProduct(client, content, spinner);
        if (result.success) {
          const hash = hashContent(content);
          state.files[change.relativePath] = {
            id: result.id,
            type: 'product',
            localHash: hash,
            remoteHash: hash,
            lastSync: new Date().toISOString(),
          };
          spinner.succeed(`${change.relativePath} (${result.variationsUpdated} variations)`);
          pushed++;
        } else {
          throw new Error(result.error);
        }
      } else {
        const parsed = markdownToWp(content);

        if (parsed.id) {
          await client.update(parsed.type, parsed.id, parsed.data);
        } else {
          const created = await client.create(parsed.type, parsed.data);
          parsed.id = created.id;
        }

        const hash = hashContent(content);
        state.files[change.relativePath] = {
          id: parsed.id,
          type: parsed.type,
          localHash: hash,
          remoteHash: hash,
          lastSync: new Date().toISOString(),
        };

        spinner.succeed(change.relativePath);
        pushed++;
      }
    } catch (error) {
      spinner.fail(`${change.relativePath}: ${error.message}`);
      failed++;
    }
  }

  if (!options.dryRun) {
    await saveState(state);
  }

  console.log(chalk.bold('\n📊 Summary'));
  console.log(`   Pushed: ${chalk.green(pushed)}`);
  if (failed > 0) {
    console.log(`   Failed: ${chalk.red(failed)}`);
  }
  console.log('');
}

async function findChangedFiles(contentDir, state, filterType, filterFile) {
  const changes = [];

  const typesToCheck = filterType === 'all'
    ? Object.keys(CONTENT_TYPES)
    : [filterType];

  for (const type of typesToCheck) {
    const typeConfig = CONTENT_TYPES[type];
    if (!typeConfig) continue;

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

      if (filterFile && !relativePath.includes(filterFile)) continue;

      const content = await readFile(filepath, 'utf-8');
      const hash = hashContent(content);

      const existingState = state.files[relativePath];
      if (!existingState || existingState.localHash !== hash) {
        changes.push({
          filepath,
          relativePath,
          type,
          isNew: !existingState,
        });
      }
    }
  }

  return changes;
}

async function pushWcProduct(client, content, spinner) {
  const hasWc = await client.hasWooCommerce();
  if (!hasWc) {
    return { success: false, error: 'WooCommerce API not available' };
  }

  const parsed = markdownToWcProduct(content);
  let variationsUpdated = 0;

  spinner.text = `Updating product ${parsed.data.name}...`;

  // Update the main product
  if (parsed.id) {
    await client.updateWcProduct(parsed.id, parsed.data);
  } else {
    // Create new product
    const created = await client.wcRequest('products', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    parsed.id = created.id;
  }

  // Handle variations for variable products
  if (parsed.variations?.length > 0 && parsed.data.type === 'variable') {
    spinner.text = `Updating ${parsed.variations.length} variations...`;

    // Get existing variations to compare
    const existingVariations = await client.fetchProductVariations(parsed.id);
    const existingIds = new Set(existingVariations.map(v => v.id));

    for (const variation of parsed.variations) {
      const variationData = parseVariationData(variation);

      if (variation.id && existingIds.has(variation.id)) {
        // Update existing variation
        await client.updateProductVariation(parsed.id, variation.id, variationData);
        variationsUpdated++;
      } else if (!variation.id) {
        // Create new variation
        await client.createProductVariation(parsed.id, variationData);
        variationsUpdated++;
      }
    }
  }

  return {
    success: true,
    id: parsed.id,
    variationsUpdated,
  };
}
