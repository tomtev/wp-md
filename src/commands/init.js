import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { saveConfig, configExists, loadConfig, resolveContentDir } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';

export async function initCommand(folder) {
  console.log('');
  console.log(chalk.bold.cyan('  ╦ ╦╔═╗   ╔╦╗╔╦╗'));
  console.log(chalk.bold.cyan('  ║║║╠═╝───║║║ ║║'));
  console.log(chalk.bold.cyan('  ╚╩╝╩     ╩ ╩═╩╝'));
  console.log('');
  console.log(chalk.dim('  Create & edit remote WordPress content as markdown files locally.'));
  console.log('');

  // Use folder argument or current directory
  const targetDir = folder || '.';
  const resolvedDir = resolveContentDir(targetDir);

  if (folder) {
    console.log(chalk.dim(`  Setting up in: ${folder}/`));
    console.log('');
  }

  let existingConfig = null;

  if (await configExists(targetDir)) {
    existingConfig = await loadConfig(targetDir);
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration already exists. Overwrite?',
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'siteUrl',
      message: 'WordPress site URL:',
      suffix: chalk.dim(' (e.g. https://example.com)'),
      default: existingConfig?.siteUrl || undefined,
      validate: (input) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'input',
      name: 'username',
      message: 'WordPress username:',
      suffix: chalk.dim(' (admin user with edit permissions)'),
      default: existingConfig?.username || undefined,
      validate: (input) => input.length > 0 || 'Username is required',
    },
    {
      type: 'password',
      name: 'appPassword',
      message: 'Application password:',
      mask: '*',
      suffix: chalk.dim(' (WP Admin → Users → Profile → Application Passwords)'),
      validate: (input) => input.length > 0 || 'Application password is required',
    },
  ]);

  const spinner = ora('Testing connection...').start();

  const client = new WordPressClient(answers);
  const result = await client.testConnection();

  if (!result.success) {
    spinner.fail('Connection failed');
    console.log(chalk.red(`Error: ${result.error}`));
    console.log(chalk.yellow('\nMake sure:'));
    console.log('  1. The site URL is correct');
    console.log('  2. REST API is enabled');
    console.log('  3. Application password is valid');
    console.log('     (Users → Profile → Application Passwords)');
    return;
  }

  spinner.succeed('Connection successful');

  await saveConfig({
    siteUrl: answers.siteUrl,
    username: answers.username,
    appPassword: answers.appPassword,
  }, targetDir);

  const envPath = folder ? `${folder}/.env` : '.env';
  console.log(chalk.green(`\n✓ Credentials saved to ${envPath}`));

  // Ask about AI agent instructions
  const { addAgentInstructions } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addAgentInstructions',
      message: 'Add AI agent instructions?',
      suffix: chalk.dim(' (for Claude Code, Cursor, etc.)'),
      default: true,
    },
  ]);

  if (addAgentInstructions) {
    await createAgentInstructions(resolvedDir);
    console.log(chalk.green('✓ Claude Code skill created in .claude/skills/wp-md/SKILL.md'));
    console.log(chalk.green(`✓ AGENTS.md created in ${folder || '.'}/`));
  }

  console.log(chalk.dim('\n  (Add .env to .gitignore to protect credentials)\n'));
  console.log('Next steps:');
  if (folder) {
    console.log(chalk.cyan(`  wp-md pull -d ${folder}`) + '  # Download all content');
  } else {
    console.log(chalk.cyan('  wp-md pull') + '           # Download all content');
  }
}

async function createAgentInstructions(contentDirPath) {
  const skillsDir = join(process.cwd(), '.claude', 'skills', 'wp-md');
  await mkdir(skillsDir, { recursive: true });
  await mkdir(contentDirPath, { recursive: true });

  // Get relative path for documentation
  const contentDir = contentDirPath.replace(process.cwd() + '/', '') || '.';

  const agentMarkdown = `# wp-md Agent Instructions

You are a WordPress content specialist working with wp-md. Content is stored as markdown files with YAML frontmatter and Gutenberg block markup.

## Content Location

All WordPress content is in \`${contentDir}/\`:

- \`${contentDir}/posts/\` - Blog posts
- \`${contentDir}/pages/\` - Pages
- \`${contentDir}/navigations/\` - Navigation menus
- \`${contentDir}/templates/\` - FSE templates (single, archive, 404, etc.)
- \`${contentDir}/template-parts/\` - Header, footer, sidebar
- \`${contentDir}/patterns/\` - Reusable block patterns
- \`${contentDir}/media/\` - Media metadata (not actual files)
- \`${contentDir}/theme/\` - Theme settings & styles (split by section)
- \`${contentDir}/taxonomies/\` - Categories and tags

### WooCommerce (if installed)

- \`${contentDir}/woocommerce/products/\` - Products (including variations)
- \`${contentDir}/woocommerce/categories/\` - Product categories
- \`${contentDir}/woocommerce/tags/\` - Product tags
- \`${contentDir}/woocommerce/brands/\` - Product brands

## WooCommerce Product Format

Products use comprehensive YAML frontmatter with variations embedded:

\`\`\`markdown
---
id: 456
type: product
slug: variable-tshirt
status: publish
title: Variable T-Shirt
product_type: variable
regular_price: "29.99"
sku: TSHIRT-001
stock_status: instock
categories:
  - id: 15
    name: Clothing
    slug: clothing
attributes:
  - id: 1
    name: Size
    options:
      - Small
      - Medium
      - Large
    variation: true
    visible: true
  - id: 2
    name: Color
    options:
      - Red
      - Blue
    variation: true
    visible: true
variations:
  - id: 457
    sku: TSHIRT-001-SM-RED
    regular_price: "29.99"
    stock_status: instock
    attributes:
      - name: Size
        option: Small
      - name: Color
        option: Red
  - id: 458
    sku: TSHIRT-001-MD-BLUE
    regular_price: "29.99"
    sale_price: "24.99"
    stock_status: instock
    attributes:
      - name: Size
        option: Medium
      - name: Color
        option: Blue
---
<p>Product description using HTML or Gutenberg blocks.</p>
\`\`\`

### Product Fields

| Field | Description |
|-------|-------------|
| \`product_type\` | simple, variable, grouped, external |
| \`regular_price\` | Base price (string) |
| \`sale_price\` | Sale price (string) |
| \`sku\` | Stock keeping unit |
| \`stock_status\` | instock, outofstock, onbackorder |
| \`manage_stock\` | true/false for inventory tracking |
| \`stock_quantity\` | Number in stock |
| \`attributes\` | Product attributes (for variations) |
| \`variations\` | Array of variation objects |

### Editing Variations

To add a new variation, add an entry to \`variations\` without an \`id\`:

\`\`\`yaml
variations:
  - sku: NEW-VAR
    regular_price: "35.00"
    attributes:
      - name: Size
        option: XL
\`\`\`

Run \`wp-md push\` to create the variation on WordPress.

## Theme Files

Theme settings and styles are split into focused markdown files:

\`\`\`
theme/
  settings-color.md      # Color palette, gradients
  settings-typography.md # Font families, sizes
  settings-spacing.md    # Spacing scale
  settings-layout.md     # Content width, wide width
  styles-color.md        # Background, text colors
  styles-elements.md     # Link, heading, button styles
  styles-blocks.md       # Per-block style overrides
\`\`\`

Example \`settings-color.md\`:

\`\`\`markdown
---
type: theme
section: settings-color
_wp_md:
  id: 123
  theme: theme-name
palette:
  - name: Primary
    slug: primary
    color: "#0073aa"
  - name: Secondary
    slug: secondary
    color: "#23282d"
gradients:
  - name: Vivid cyan
    slug: vivid-cyan
    gradient: "linear-gradient(135deg,#0073aa,#23282d)"
---
\`\`\`

When pushing, all theme files are merged and sent as a single global-styles update.

## File Format

Files use YAML frontmatter + Gutenberg blocks:

\`\`\`markdown
---
id: 123
type: page
slug: about
status: publish
title: About Us
---
<!-- wp:heading {"level":1} -->
<h1>About Us</h1>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Content here.</p>
<!-- /wp:paragraph -->
\`\`\`

## CLI Commands

\`\`\`bash
wp-md pull              # Download content from WordPress
wp-md push              # Upload local changes
wp-md push -f <file>    # Push specific file
wp-md new page "Title"  # Create new page (draft)
wp-md new post "Title"  # Create new post (draft)
wp-md new wp_block "Pattern Name"  # Create new pattern
wp-md status            # Check sync status
wp-md watch --poll 30   # Auto-sync bidirectionally
\`\`\`

## Critical Rules

1. **Always read files before editing** - Never modify files you haven't read
2. **Never delete the \`id\` field** - Required for WordPress sync
3. **Use CLI for new content** - Run \`wp-md new\` instead of creating files manually
4. **Push after changes** - Run \`wp-md push\` to sync changes to WordPress
5. **Valid block markup required** - Every block needs opening \`<!-- wp:name -->\` and closing \`<!-- /wp:name -->\` comments

## Common Gutenberg Blocks

**Heading:**
\`\`\`html
<!-- wp:heading {"level":2} -->
<h2>Title</h2>
<!-- /wp:heading -->
\`\`\`

**Paragraph:**
\`\`\`html
<!-- wp:paragraph -->
<p>Text content.</p>
<!-- /wp:paragraph -->
\`\`\`

**Image:**
\`\`\`html
<!-- wp:image {"id":123,"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="url" alt=""/></figure>
<!-- /wp:image -->
\`\`\`

**Buttons:**
\`\`\`html
<!-- wp:buttons -->
<div class="wp-block-buttons">
  <!-- wp:button -->
  <div class="wp-block-button"><a class="wp-block-button__link">Click</a></div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
\`\`\`

**Columns:**
\`\`\`html
<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:paragraph -->
    <p>Column 1</p>
    <!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
\`\`\`

**Cover (Hero):**
\`\`\`html
<!-- wp:cover {"overlayColor":"primary","minHeight":400} -->
<div class="wp-block-cover" style="min-height:400px">
  <span class="wp-block-cover__background has-primary-background-color"></span>
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"textAlign":"center"} -->
    <h2 class="has-text-align-center">Hero Title</h2>
    <!-- /wp:heading -->
  </div>
</div>
<!-- /wp:cover -->
\`\`\`

## Workflow

1. Read and edit content files in \`${contentDir}/\`
2. Run \`wp-md push\` to sync changes to WordPress
3. Or use \`wp-md watch --poll 30\` for automatic bidirectional sync
`;

  // Claude Code skill with YAML frontmatter
  const claudeSkill = `---
name: wp-md
description: Build and edit remote WordPress content using local markdown files. Use when working with WordPress pages, posts, templates, patterns, or WooCommerce products.
---

${agentMarkdown}`;

  await writeFile(join(skillsDir, 'SKILL.md'), claudeSkill);
  await writeFile(join(contentDirPath, 'AGENTS.md'), agentMarkdown);
}
