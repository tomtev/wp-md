import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';

const ENV_FILE = '.env';
const CONFIG_FILE = '.wpmdrc.json';
const STATE_FILE = '.wpmd-state.json';

// Using WordPress post type slugs
export const CONTENT_TYPES = {
  // Regular post types
  post: { endpoint: 'posts', folder: 'post-types/post', label: 'Posts', postType: 'post' },
  page: { endpoint: 'pages', folder: 'post-types/page', label: 'Pages', postType: 'page' },
  wp_navigation: { endpoint: 'navigation', folder: 'post-types/wp_navigation', label: 'Navigation', postType: 'wp_navigation' },
  // FSE theme content (top-level folders)
  wp_template: { endpoint: 'templates', folder: 'templates', label: 'Templates', postType: 'wp_template' },
  wp_template_part: { endpoint: 'template-parts', folder: 'template-parts', label: 'Template Parts', postType: 'wp_template_part' },
  wp_block: { endpoint: 'blocks', folder: 'patterns', label: 'Patterns', postType: 'wp_block' },
  // WooCommerce
  product: { endpoint: 'product', folder: 'woocommerce/products', label: 'Products', postType: 'product' },
  // Media & theme
  attachment: { endpoint: 'media', folder: 'media', label: 'Media', postType: 'attachment', isMedia: true },
  wp_global_styles: { endpoint: 'global-styles', folder: 'theme', label: 'Global Styles', postType: 'wp_global_styles', isSpecial: true },
};

// Taxonomies (categories, tags, brands, etc.)
export const TAXONOMY_TYPES = {
  category: { endpoint: 'categories', folder: 'taxonomies/category', label: 'Categories' },
  post_tag: { endpoint: 'tags', folder: 'taxonomies/post_tag', label: 'Tags' },
  product_cat: { endpoint: 'product_cat', folder: 'woocommerce/categories', label: 'Product Categories' },
  product_tag: { endpoint: 'product_tag', folder: 'woocommerce/tags', label: 'Product Tags' },
  product_brand: { endpoint: 'product_brand', folder: 'woocommerce/brands', label: 'Product Brands' },
};

export async function configExists() {
  try {
    await access(join(process.cwd(), ENV_FILE));
    return true;
  } catch {
    // Fallback to old config file
    try {
      await access(join(process.cwd(), CONFIG_FILE));
      return true;
    } catch {
      return false;
    }
  }
}

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      let value = match[2].trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1].trim()] = value;
    }
  }
  return env;
}

export async function loadConfig() {
  // First try .env file
  try {
    const envContent = await readFile(join(process.cwd(), ENV_FILE), 'utf-8');
    const env = parseEnvFile(envContent);

    if (env.WP_MD_URL && env.WP_MD_USER && env.WP_MD_APP_PASSWORD) {
      // Load additional config from .wpsyncrc.json if exists
      let extraConfig = {};
      try {
        const configData = await readFile(join(process.cwd(), CONFIG_FILE), 'utf-8');
        extraConfig = JSON.parse(configData);
      } catch {}

      return {
        siteUrl: env.WP_MD_URL,
        username: env.WP_MD_USER,
        appPassword: env.WP_MD_APP_PASSWORD,
        contentDir: env.WP_MD_CONTENT_DIR || extraConfig.contentDir || 'content',
      };
    }
  } catch {}

  // Fallback to old JSON config
  try {
    const data = await readFile(join(process.cwd(), CONFIG_FILE), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveConfig(config) {
  // Save credentials to .env
  const envContent = `# wp-md configuration
# Add this file to .gitignore to protect credentials

WP_MD_URL=${config.siteUrl}
WP_MD_USER=${config.username}
WP_MD_APP_PASSWORD=${config.appPassword}
WP_MD_CONTENT_DIR=${config.contentDir || 'content'}
`;

  await writeFile(join(process.cwd(), ENV_FILE), envContent);

  // Save non-sensitive config to .wpsyncrc.json
  await writeFile(
    join(process.cwd(), CONFIG_FILE),
    JSON.stringify({ contentDir: config.contentDir || 'content' }, null, 2)
  );
}

export async function loadState() {
  try {
    const data = await readFile(join(process.cwd(), STATE_FILE), 'utf-8');
    return JSON.parse(data);
  } catch {
    return { files: {}, lastSync: null };
  }
}

export async function saveState(state) {
  await writeFile(
    join(process.cwd(), STATE_FILE),
    JSON.stringify(state, null, 2)
  );
}
