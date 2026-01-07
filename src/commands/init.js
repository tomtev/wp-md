import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { saveConfig, configExists, loadConfig } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';

export async function initCommand() {
  console.log('');
  console.log(chalk.bold.cyan('  ╦ ╦╔═╗   ╔╦╗╔╦╗'));
  console.log(chalk.bold.cyan('  ║║║╠═╝───║║║ ║║'));
  console.log(chalk.bold.cyan('  ╚╩╝╩     ╩ ╩═╩╝'));
  console.log('');
  console.log(chalk.dim('  Create & edit remote WordPress content as markdown files locally.'));
  console.log('');

  let existingConfig = null;

  if (await configExists()) {
    existingConfig = await loadConfig();
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
    {
      type: 'input',
      name: 'contentDir',
      message: 'Local content directory:',
      suffix: chalk.dim(' (folder to store synced content)'),
      default: existingConfig?.contentDir || 'content',
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
    contentDir: answers.contentDir,
  });

  console.log(chalk.green('\n✓ Credentials saved to .env'));

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
    await createAgentInstructions(answers.contentDir);
    console.log(chalk.green('✓ Claude sub-agent created in .claude/agents/wp-md.md'));
    console.log(chalk.green(`✓ AGENTS.md created in ${answers.contentDir}/`));
  }

  console.log(chalk.dim('\n  (Add .env to .gitignore to protect credentials)\n'));
  console.log('Next steps:');
  console.log(chalk.cyan('  wp-md pull        ') + '# Download all content');
  console.log(chalk.cyan('  wp-md pull -t post') + '# Download only posts');
}

async function createAgentInstructions(contentDir) {
  const agentsDir = join(process.cwd(), '.claude', 'agents');
  const contentDirPath = join(process.cwd(), contentDir);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(contentDirPath, { recursive: true });

  const agentMarkdown = `# wp-md Agent Instructions

You are a WordPress content specialist working with wp-md. Content is stored as markdown files with YAML frontmatter and Gutenberg block markup.

## Content Location

All WordPress content is in \`${contentDir}/\`:

- \`${contentDir}/post-types/post/\` - Blog posts
- \`${contentDir}/post-types/page/\` - Pages
- \`${contentDir}/post-types/wp_navigation/\` - Navigation menus
- \`${contentDir}/templates/\` - FSE templates (single, archive, 404, etc.)
- \`${contentDir}/template-parts/\` - Header, footer, sidebar
- \`${contentDir}/patterns/\` - Reusable block patterns
- \`${contentDir}/media/\` - Media metadata (not actual files)
- \`${contentDir}/theme/global-styles.json\` - Theme styles (colors, fonts, spacing)
- \`${contentDir}/taxonomies/\` - Categories and tags

### WooCommerce (if installed)

- \`${contentDir}/woocommerce/products/\` - Products
- \`${contentDir}/woocommerce/categories/\` - Product categories
- \`${contentDir}/woocommerce/tags/\` - Product tags
- \`${contentDir}/woocommerce/brands/\` - Product brands

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

  // Claude Code sub-agent with YAML frontmatter
  const claudeAgent = `---
name: wp-md
description: wp-md syncs WordPress content as local markdown files. Use this agent for editing pages, posts, patterns, templates, and WooCommerce products as files.
tools: Read, Edit, Write, Bash, Glob, Grep
---

${agentMarkdown}`;

  await writeFile(join(agentsDir, 'wp-md.md'), claudeAgent);
  await writeFile(join(contentDirPath, 'AGENTS.md'), agentMarkdown);
}
