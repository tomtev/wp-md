import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, CONTENT_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { wpToMarkdown, generateFilename, hashContent } from '../sync/content.js';

const CREATABLE_TYPES = ['post', 'page', 'wp_template', 'wp_template_part', 'wp_block', 'wp_navigation'];

export async function newCommand(type, title, options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  if (!CREATABLE_TYPES.includes(type)) {
    console.log(chalk.red(`Cannot create type: ${type}`));
    console.log(chalk.dim(`Supported types: ${CREATABLE_TYPES.join(', ')}`));
    return;
  }

  if (!title) {
    console.log(chalk.red('Title is required.'));
    console.log(chalk.dim('Usage: wp-sync new <type> "Title"'));
    return;
  }

  const typeConfig = CONTENT_TYPES[type];
  const client = new WordPressClient(config);
  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  const spinner = ora(`Creating ${typeConfig.label.toLowerCase()}...`).start();

  try {
    // Build the data for WordPress
    const slug = slugify(title);
    const data = buildCreateData(type, title, slug, options);

    // Create in WordPress
    const created = await client.create(type, data);
    spinner.text = 'Saving local file...';

    // Fetch full item with edit context to get raw content
    const item = await client.fetchOne(type, created.id);

    // Save locally
    const typeDir = join(process.cwd(), contentDir, typeConfig.folder);
    await mkdir(typeDir, { recursive: true });

    const filename = generateFilename(item);
    const filepath = join(typeDir, filename);
    const relativePath = join(contentDir, typeConfig.folder, filename);

    const markdown = wpToMarkdown(item, type);
    const hash = hashContent(markdown);

    await writeFile(filepath, markdown);

    // Update state
    state.files[relativePath] = {
      id: item.id,
      type: type,
      localHash: hash,
      remoteHash: hash,
      lastSync: new Date().toISOString(),
    };
    await saveState(state);

    spinner.succeed(`Created: ${relativePath}`);
    console.log(chalk.dim(`   ID: ${item.id}`));
    console.log(chalk.dim(`   Status: ${item.status}`));
    console.log(chalk.dim(`   Slug: ${item.slug}`));

  } catch (error) {
    spinner.fail(`Failed to create: ${error.message}`);
  }
}

function buildCreateData(type, title, slug, options) {
  const base = {
    title,
    slug,
    status: options.publish ? 'publish' : 'draft',
    content: options.content || '',
  };

  switch (type) {
    case 'post':
      return base;

    case 'page':
      return {
        ...base,
        parent: options.parent || 0,
      };

    case 'wp_template':
      return {
        slug,
        title,
        status: 'publish',
        content: options.content || `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->\n\n<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->\n<main class="wp-block-group">\n<!-- wp:post-title /-->\n<!-- wp:post-content /-->\n</main>\n<!-- /wp:group -->\n\n<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->`,
      };

    case 'wp_template_part':
      return {
        slug,
        title,
        status: 'publish',
        area: options.area || 'uncategorized',
        content: options.content || `<!-- wp:paragraph -->\n<p>${title}</p>\n<!-- /wp:paragraph -->`,
      };

    case 'wp_block':
      return {
        title,
        slug,
        status: 'publish',
        content: options.content || `<!-- wp:paragraph -->\n<p>${title}</p>\n<!-- /wp:paragraph -->`,
      };

    case 'wp_navigation':
      return {
        title,
        slug,
        status: 'publish',
        content: options.content || `<!-- wp:navigation-link {"label":"Home","url":"/"} /-->`,
      };

    default:
      return base;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
