import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, CONTENT_TYPES, TAXONOMY_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { wpToMarkdown, mediaToMarkdown, taxonomyToMarkdown, wcProductToMarkdown, generateFilename, hashContent } from '../sync/content.js';

export async function pullCommand(options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  const client = new WordPressClient(config);
  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  const typesToPull = options.type === 'all'
    ? Object.keys(CONTENT_TYPES)
    : [options.type];

  console.log(chalk.bold('\n📥 Pulling content from WordPress\n'));

  let totalFiles = 0;
  let updatedFiles = 0;
  let newFiles = 0;

  for (const type of typesToPull) {
    const typeConfig = CONTENT_TYPES[type];
    if (!typeConfig) {
      console.log(chalk.yellow(`Unknown content type: ${type}`));
      continue;
    }

    const spinner = ora(`Fetching ${typeConfig.label}...`).start();

    try {
      // Special handling for global styles
      if (type === 'wp_global_styles') {
        const result = await pullGlobalStyles(client, contentDir, state, options.force);
        if (result.isNew) newFiles++;
        else if (result.isChanged) updatedFiles++;
        if (result.success) totalFiles++;
        spinner.succeed(`${typeConfig.label}: ${result.theme}`);
        continue;
      }

      // Special handling for WooCommerce products (use WC API for variations)
      if (type === 'product') {
        const result = await pullWcProducts(client, contentDir, state, options.force, spinner);
        newFiles += result.newFiles;
        updatedFiles += result.updatedFiles;
        totalFiles += result.totalFiles;
        spinner.succeed(`${typeConfig.label}: ${result.totalFiles} items (${result.variableCount} variable)`);
        continue;
      }

      const items = await client.fetchAll(type);
      spinner.text = `Processing ${items.length} ${typeConfig.label.toLowerCase()}...`;

      const typeDir = join(process.cwd(), contentDir, typeConfig.folder);
      await mkdir(typeDir, { recursive: true });

      for (const item of items) {
        const filename = generateFilename(item);
        const filepath = join(typeDir, filename);
        const relativePath = join(contentDir, typeConfig.folder, filename);

        // Use mediaToMarkdown for attachments, wpToMarkdown for others
        const markdown = typeConfig.isMedia
          ? mediaToMarkdown(item)
          : wpToMarkdown(item, type);
        const hash = hashContent(markdown);

        const existingState = state.files[relativePath];
        const isNew = !existingState;
        const isChanged = existingState && existingState.remoteHash !== hash;

        if (isNew || isChanged || options.force) {
          await writeFile(filepath, markdown);

          state.files[relativePath] = {
            id: item.id,
            type: type,
            localHash: hash,
            remoteHash: hash,
            lastSync: new Date().toISOString(),
          };

          if (isNew) newFiles++;
          else if (isChanged) updatedFiles++;
        }

        totalFiles++;
      }

      spinner.succeed(`${typeConfig.label}: ${items.length} items`);
    } catch (error) {
      spinner.fail(`${typeConfig.label}: ${error.message}`);
    }
  }

  // Pull taxonomies if requested
  const taxonomiesToPull = options.type === 'all'
    ? Object.keys(TAXONOMY_TYPES)
    : Object.keys(TAXONOMY_TYPES).filter(t => t === options.type);

  for (const taxonomy of taxonomiesToPull) {
    const taxConfig = TAXONOMY_TYPES[taxonomy];
    if (!taxConfig) continue;

    const spinner = ora(`Fetching ${taxConfig.label}...`).start();

    try {
      const items = await client.fetchAllTaxonomy(taxonomy);

      if (items.length === 0) {
        spinner.info(`${taxConfig.label}: 0 items (or not available)`);
        continue;
      }

      spinner.text = `Processing ${items.length} ${taxConfig.label.toLowerCase()}...`;

      const taxDir = join(process.cwd(), contentDir, taxConfig.folder);
      await mkdir(taxDir, { recursive: true });

      for (const item of items) {
        const filename = `${item.slug}.md`;
        const filepath = join(taxDir, filename);
        const relativePath = join(contentDir, taxConfig.folder, filename);

        const markdown = taxonomyToMarkdown(item, taxonomy);
        const hash = hashContent(markdown);

        const existingState = state.files[relativePath];
        const isNew = !existingState;
        const isChanged = existingState && existingState.remoteHash !== hash;

        if (isNew || isChanged || options.force) {
          await writeFile(filepath, markdown);

          state.files[relativePath] = {
            id: item.id,
            type: taxonomy,
            localHash: hash,
            remoteHash: hash,
            lastSync: new Date().toISOString(),
          };

          if (isNew) newFiles++;
          else if (isChanged) updatedFiles++;
        }

        totalFiles++;
      }

      spinner.succeed(`${taxConfig.label}: ${items.length} items`);
    } catch (error) {
      spinner.fail(`${taxConfig.label}: ${error.message}`);
    }
  }

  state.lastSync = new Date().toISOString();
  await saveState(state);

  console.log(chalk.bold('\n📊 Summary'));
  console.log(`   Total: ${totalFiles} files`);
  console.log(`   New: ${chalk.green(newFiles)}`);
  console.log(`   Updated: ${chalk.yellow(updatedFiles)}`);
  console.log(`   Unchanged: ${chalk.dim(totalFiles - newFiles - updatedFiles)}`);
  console.log('');
}

async function pullGlobalStyles(client, contentDir, state, force) {
  const globalStyles = await client.fetchGlobalStyles();

  const themeDir = join(process.cwd(), contentDir, 'theme');
  await mkdir(themeDir, { recursive: true });

  // Save as theme.json format
  const themeJson = {
    $schema: 'https://schemas.wp.org/trunk/theme.json',
    version: 3,
    settings: globalStyles.settings,
    styles: globalStyles.styles,
    _wp_md: {
      id: globalStyles.id,
      theme: globalStyles.theme,
    },
  };

  const content = JSON.stringify(themeJson, null, 2);
  const hash = hashContent(content);
  const filepath = join(themeDir, 'global-styles.json');
  const relativePath = join(contentDir, 'theme', 'global-styles.json');

  const existingState = state.files[relativePath];
  const isNew = !existingState;
  const isChanged = existingState && existingState.remoteHash !== hash;

  if (isNew || isChanged || force) {
    await writeFile(filepath, content);

    state.files[relativePath] = {
      id: globalStyles.id,
      type: 'wp_global_styles',
      theme: globalStyles.theme,
      localHash: hash,
      remoteHash: hash,
      lastSync: new Date().toISOString(),
    };
  }

  return {
    success: true,
    theme: globalStyles.theme,
    isNew,
    isChanged,
  };
}

async function pullWcProducts(client, contentDir, state, force, spinner) {
  const result = {
    totalFiles: 0,
    newFiles: 0,
    updatedFiles: 0,
    variableCount: 0,
  };

  // Check if WooCommerce is available
  const hasWc = await client.hasWooCommerce();
  if (!hasWc) {
    // Fall back to standard WP REST API (without variations)
    return result;
  }

  const typeConfig = CONTENT_TYPES.product;
  const typeDir = join(process.cwd(), contentDir, typeConfig.folder);
  await mkdir(typeDir, { recursive: true });

  spinner.text = 'Fetching products via WooCommerce API...';
  const products = await client.fetchWcProducts();

  for (const product of products) {
    spinner.text = `Processing ${product.name}...`;

    // Fetch variations for variable products
    let variations = [];
    if (product.type === 'variable') {
      result.variableCount++;
      variations = await client.fetchProductVariations(product.id);
    }

    const filename = `${product.slug}.md`;
    const filepath = join(typeDir, filename);
    const relativePath = join(contentDir, typeConfig.folder, filename);

    const markdown = wcProductToMarkdown(product, variations);
    const hash = hashContent(markdown);

    const existingState = state.files[relativePath];
    const isNew = !existingState;
    const isChanged = existingState && existingState.remoteHash !== hash;

    if (isNew || isChanged || force) {
      await writeFile(filepath, markdown);

      state.files[relativePath] = {
        id: product.id,
        type: 'product',
        localHash: hash,
        remoteHash: hash,
        lastSync: new Date().toISOString(),
      };

      if (isNew) result.newFiles++;
      else if (isChanged) result.updatedFiles++;
    }

    result.totalFiles++;
  }

  return result;
}
