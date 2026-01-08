# Static Renderer Plan

Render WordPress Gutenberg blocks to static HTML using local markdown files as the content database.

## Overview

Build a static site generator that:
1. Reads markdown files from wp-md content folders
2. Builds an internal content layer (queryable index)
3. Parses Gutenberg block markup
4. Renders blocks to static HTML
5. Outputs to a `build/` folder

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         wp-md build                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Content    │    │    Block     │    │    HTML      │      │
│  │   Layer      │───▶│   Renderer   │───▶│   Output     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         ▲                   │                                   │
│         │                   │                                   │
│  ┌──────┴──────┐    ┌──────┴──────┐                            │
│  │  Markdown   │    │   Block     │                            │
│  │   Files     │    │  Registry   │                            │
│  └─────────────┘    └─────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Content Layer

The content layer indexes all markdown files and provides query methods.

### Data Structure

```javascript
// In-memory content index
const contentIndex = {
  posts: [
    {
      id: 123,
      slug: 'hello-world',
      title: 'Hello World',
      status: 'publish',
      date: '2024-01-15T10:00:00Z',
      modified: '2024-01-16T12:00:00Z',
      categories: [5, 12],
      tags: [3, 7],
      author: 1,
      featured_media: 456,
      excerpt: 'Welcome to my blog...',
      content: '<!-- wp:paragraph -->...',
      filepath: 'posts/hello-world.md'
    },
    // ...
  ],
  pages: [...],
  products: [...],
  categories: [...],
  tags: [...],
  media: [...],
  templates: [...],
  patterns: [...]
};
```

### Query API

```javascript
// content-layer.js

class ContentLayer {
  constructor(contentDir) {
    this.contentDir = contentDir;
    this.index = { posts: [], pages: [], products: [], ... };
  }

  async build() {
    // Scan all markdown files and build index
    await this.indexPosts();
    await this.indexPages();
    await this.indexProducts();
    await this.indexTaxonomies();
    await this.indexMedia();
  }

  // Query methods matching WP_Query parameters

  getPosts(args = {}) {
    let posts = [...this.index.posts];

    // Filter by status
    if (args.status) {
      posts = posts.filter(p => p.status === args.status);
    }

    // Filter by category
    if (args.category) {
      posts = posts.filter(p => p.categories.includes(args.category));
    }

    // Filter by tag
    if (args.tag) {
      posts = posts.filter(p => p.tags.includes(args.tag));
    }

    // Order
    const orderBy = args.orderBy || 'date';
    const order = args.order || 'desc';
    posts.sort((a, b) => {
      const aVal = a[orderBy];
      const bVal = b[orderBy];
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Limit
    if (args.postsToShow) {
      posts = posts.slice(0, args.postsToShow);
    }

    return posts;
  }

  getPages(args = {}) { ... }

  getProducts(args = {}) {
    let products = [...this.index.products];

    if (args.category) {
      products = products.filter(p =>
        p.categories.some(c => c.id === args.category || c.slug === args.category)
      );
    }

    if (args.featured) {
      products = products.filter(p => p.featured);
    }

    if (args.on_sale) {
      products = products.filter(p => p.sale_price && p.sale_price < p.regular_price);
    }

    return products;
  }

  getTerms(taxonomy, args = {}) { ... }

  getMedia(id) {
    return this.index.media.find(m => m.id === id);
  }

  getPost(idOrSlug) {
    return this.index.posts.find(p =>
      p.id === idOrSlug || p.slug === idOrSlug
    );
  }
}
```

## Block Renderer

### Block Types

**Tier 1 - Static (HTML passthrough):**
- paragraph, heading, list, quote, code, preformatted
- separator, spacer
- html, freeform

**Tier 2 - Static with styling:**
- button, buttons
- image, gallery, cover
- columns, column, group, row, stack
- table

**Tier 3 - Content queries (use Content Layer):**
- latest-posts
- query, post-template
- categories, tag-cloud
- page-list

**Tier 4 - WooCommerce (use Content Layer):**
- woocommerce/all-products
- woocommerce/product-categories
- woocommerce/featured-product
- woocommerce/products-by-attribute

### Rendering Pipeline

```javascript
// block-renderer.js

import { parse } from '@wordpress/block-serialization-default-parser';

class BlockRenderer {
  constructor(contentLayer) {
    this.content = contentLayer;
    this.blocks = new Map(); // block name -> render function
    this.registerCoreBlocks();
  }

  registerCoreBlocks() {
    // Tier 1: Passthrough
    this.register('core/paragraph', (block) => block.innerHTML);
    this.register('core/heading', (block) => block.innerHTML);
    this.register('core/list', (block) => block.innerHTML);
    this.register('core/quote', (block) => block.innerHTML);
    this.register('core/code', (block) => block.innerHTML);
    this.register('core/html', (block) => block.innerHTML);

    // Tier 2: With wrapper/classes
    this.register('core/image', (block) => {
      // Already has <figure><img></figure>, pass through
      return block.innerHTML;
    });

    this.register('core/columns', (block) => {
      const inner = this.renderBlocks(block.innerBlocks);
      return `<div class="wp-block-columns">${inner}</div>`;
    });

    this.register('core/column', (block) => {
      const inner = this.renderBlocks(block.innerBlocks);
      const width = block.attrs.width ? `style="flex-basis:${block.attrs.width}"` : '';
      return `<div class="wp-block-column" ${width}>${inner}</div>`;
    });

    this.register('core/group', (block) => {
      const inner = this.renderBlocks(block.innerBlocks);
      const layout = block.attrs.layout?.type || 'default';
      return `<div class="wp-block-group layout-${layout}">${inner}</div>`;
    });

    // Tier 3: Content queries
    this.register('core/latest-posts', (block) => {
      const { postsToShow = 5, orderBy = 'date', displayPostDate } = block.attrs;
      const posts = this.content.getPosts({
        postsToShow,
        orderBy,
        status: 'publish'
      });

      return `<ul class="wp-block-latest-posts">
        ${posts.map(post => `
          <li>
            <a href="/${post.slug}/">${post.title}</a>
            ${displayPostDate ? `<time>${post.date}</time>` : ''}
          </li>
        `).join('')}
      </ul>`;
    });

    this.register('core/categories', (block) => {
      const categories = this.content.getTerms('category');
      return `<ul class="wp-block-categories">
        ${categories.map(cat => `
          <li><a href="/category/${cat.slug}/">${cat.name}</a></li>
        `).join('')}
      </ul>`;
    });

    // Tier 4: WooCommerce
    this.register('woocommerce/featured-product', (block) => {
      const product = this.content.getProduct(block.attrs.productId);
      if (!product) return '';

      return `<div class="wc-block-featured-product">
        <h2>${product.title}</h2>
        <span class="price">${product.regular_price}</span>
        <a href="/product/${product.slug}/" class="button">View Product</a>
      </div>`;
    });

    this.register('woocommerce/product-categories', (block) => {
      const categories = this.content.getTerms('product_cat');
      return `<ul class="wc-block-product-categories">
        ${categories.map(cat => `
          <li><a href="/product-category/${cat.slug}/">${cat.name}</a></li>
        `).join('')}
      </ul>`;
    });
  }

  register(blockName, renderFn) {
    this.blocks.set(blockName, renderFn);
  }

  renderBlocks(blocks) {
    return blocks.map(block => this.renderBlock(block)).join('\n');
  }

  renderBlock(block) {
    // Null block = freeform HTML
    if (!block.blockName) {
      return block.innerHTML || '';
    }

    const renderer = this.blocks.get(block.blockName);

    if (renderer) {
      return renderer(block);
    }

    // Unknown block: try innerHTML passthrough
    console.warn(`Unknown block: ${block.blockName}`);
    return block.innerHTML || '';
  }

  render(content) {
    const blocks = parse(content);
    return this.renderBlocks(blocks);
  }
}
```

## CLI Command

```bash
# Build all content to build/ folder
wp-md build

# Build specific content type
wp-md build --type pages

# Build with custom output
wp-md build --output dist/

# Watch and rebuild
wp-md build --watch

# Build single file
wp-md build --file pages/about.md
```

### Command Implementation

```javascript
// src/commands/build.js

import { ContentLayer } from '../build/content-layer.js';
import { BlockRenderer } from '../build/block-renderer.js';
import { loadConfig, resolveContentDir } from '../config.js';

export async function buildCommand(options) {
  const contentDir = resolveContentDir(options.dir);
  const outputDir = options.output || join(contentDir, 'build');

  console.log(chalk.bold('Building static site...\n'));

  // Build content index
  const spinner = ora('Indexing content...').start();
  const content = new ContentLayer(contentDir);
  await content.build();
  spinner.succeed(`Indexed ${content.count()} items`);

  // Initialize renderer
  const renderer = new BlockRenderer(content);

  // Load template (optional)
  const template = await loadTemplate(contentDir);

  // Build pages
  spinner.start('Rendering pages...');
  const pages = content.getPages({ status: 'publish' });

  for (const page of pages) {
    const html = renderer.render(page.content);
    const fullHtml = template
      ? template.replace('{{content}}', html).replace('{{title}}', page.title)
      : wrapHtml(html, page.title);

    const outputPath = join(outputDir, page.slug, 'index.html');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fullHtml);
  }
  spinner.succeed(`Rendered ${pages.length} pages`);

  // Build posts
  spinner.start('Rendering posts...');
  const posts = content.getPosts({ status: 'publish' });

  for (const post of posts) {
    const html = renderer.render(post.content);
    const fullHtml = template
      ? template.replace('{{content}}', html).replace('{{title}}', post.title)
      : wrapHtml(html, post.title);

    const outputPath = join(outputDir, 'blog', post.slug, 'index.html');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, fullHtml);
  }
  spinner.succeed(`Rendered ${posts.length} posts`);

  // Build archive pages
  await buildArchives(content, renderer, outputDir, template);

  // Copy static assets
  await copyMedia(contentDir, outputDir);

  console.log(chalk.green(`\n✓ Built to ${outputDir}/`));
}

function wrapHtml(content, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="content">
    ${content}
  </main>
</body>
</html>`;
}
```

## Output Structure

```
build/
├── index.html              # Homepage
├── style.css               # Generated from theme/
├── about/
│   └── index.html          # /about/ page
├── contact/
│   └── index.html          # /contact/ page
├── blog/
│   ├── index.html          # Blog archive
│   ├── hello-world/
│   │   └── index.html      # Single post
│   └── another-post/
│       └── index.html
├── category/
│   ├── news/
│   │   └── index.html      # Category archive
│   └── tutorials/
│       └── index.html
├── product/
│   ├── t-shirt/
│   │   └── index.html      # Single product
│   └── hoodie/
│       └── index.html
├── product-category/
│   └── clothing/
│       └── index.html      # Product category
└── media/
    ├── image1.jpg
    └── image2.png
```

## Theme Integration

### CSS from theme.json

The `theme/` folder contains style settings. Generate CSS from these:

```javascript
// build/theme-css.js

async function generateThemeCSS(contentDir) {
  const themeDir = join(contentDir, 'theme');
  const files = await glob(join(themeDir, '*.md'));

  let css = ':root {\n';

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const { data } = parseMarkdown(content);

    if (data.section === 'settings-color' && data.palette) {
      for (const color of data.palette) {
        css += `  --wp--preset--color--${color.slug}: ${color.color};\n`;
      }
    }

    if (data.section === 'settings-typography' && data.fontSizes) {
      for (const size of data.fontSizes) {
        css += `  --wp--preset--font-size--${size.slug}: ${size.size};\n`;
      }
    }

    if (data.section === 'settings-spacing' && data.spacingSizes) {
      for (const space of data.spacingSizes) {
        css += `  --wp--preset--spacing--${space.slug}: ${space.size};\n`;
      }
    }
  }

  css += '}\n\n';

  // Add block styles
  css += await generateBlockCSS();

  return css;
}
```

### Custom Templates

Support custom HTML templates in `build-templates/`:

```
build-templates/
├── base.html           # Base layout
├── page.html           # Page template
├── post.html           # Single post template
├── archive.html        # Archive template
└── product.html        # Product template
```

```html
<!-- build-templates/base.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{title}} | {{site_name}}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  {{> header}}
  <main>
    {{content}}
  </main>
  {{> footer}}
</body>
</html>
```

## Implementation Phases

### Phase 1: Core (MVP)
- [ ] Content layer with basic indexing
- [ ] Block parser integration
- [ ] Tier 1 block rendering (passthrough)
- [ ] Basic HTML output
- [ ] `wp-md build` command

### Phase 2: Content Queries
- [ ] Full content layer query API
- [ ] Tier 3 blocks (latest-posts, categories, etc.)
- [ ] Archive page generation
- [ ] Pagination support

### Phase 3: Styling
- [ ] Theme CSS generation from theme/*.md
- [ ] Block class handling
- [ ] Responsive styles

### Phase 4: WooCommerce
- [ ] Product indexing
- [ ] WooCommerce block rendering
- [ ] Product archives

### Phase 5: Templates
- [ ] Custom template support
- [ ] Partials (header, footer)
- [ ] Template inheritance

### Phase 6: Advanced
- [ ] Incremental builds
- [ ] Watch mode
- [ ] Asset optimization
- [ ] Sitemap generation

## Dependencies

```json
{
  "@wordpress/block-serialization-default-parser": "^5.0.0",
  "gray-matter": "^4.0.3",
  "glob": "^10.0.0"
}
```

Note: We avoid heavy WordPress packages by implementing our own simple block renderers instead of running React save.js functions. This keeps the build fast and dependency-light.
