# wp-md

```
╦ ╦╔═╗   ╔╦╗╔╦╗
║║║╠═╝───║║║ ║║
╚╩╝╩     ╩ ╩═╩╝
```

**Create & edit remote WordPress content as markdown files locally.**

Turn your WordPress site into a local folder of markdown files. Edit pages, posts, patterns, templates, and WooCommerce products with your favorite editor or AI coding assistant and sync back to remote site with changes.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/tomtev/wp-md/main/install.sh | bash

# Go to your project folder (where you want the markdown files)
cd your-project

# Connect to your WordPress site
wp-md init

# Pull all content from WordPress
wp-md pull

# Edit files locally, then push changes back
wp-md push
```

## Requirements

- Node.js 18+
- WordPress site with REST API enabled
- [Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/) for authentication

## Commands

| Command | Description |
|---------|-------------|
| `wp-md init` | Configure WordPress connection |
| `wp-md pull` | Download content from WordPress |
| `wp-md push` | Upload local changes to WordPress |
| `wp-md status` | Show sync status |
| `wp-md watch` | Watch for local changes |
| `wp-md new <type> <title>` | Create new content |
| `wp-md upload <file>` | Upload media file |
| `wp-md force-push` | Push all content (creates missing) |

## Content Structure

```
content/
├── post-types/
│   ├── post/
│   ├── page/
│   └── wp_navigation/
├── templates/
├── template-parts/
├── patterns/
├── media/
├── taxonomies/
├── woocommerce/
│   ├── products/
│   ├── categories/
│   ├── tags/
│   └── brands/
└── theme/
    └── global-styles.json
```

## File Format

Files use YAML frontmatter + Gutenberg block markup:

```markdown
---
id: 123
type: page
slug: about-us
status: publish
title: About Us
---
<!-- wp:heading {"level":1} -->
<h1>About Us</h1>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Content here using Gutenberg blocks.</p>
<!-- /wp:paragraph -->
```

## Installation

```bash
# Quick install
curl -fsSL https://raw.githubusercontent.com/tomtev/wp-md/main/install.sh | bash

# Or manual install
git clone https://github.com/tomtev/wp-md.git
cd wp-md && npm install && npm link
```

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/tomtev/wp-md/main/uninstall.sh | bash
```

## Authentication

wp-md uses [WordPress Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/):

1. Go to **WordPress Admin → Users → Profile**
2. Scroll to **Application Passwords**
3. Enter a name (e.g., "wp-md") and click **Add New**
4. Copy the generated password
5. Use it during `wp-md init`

## AI Code Agents

When you run `wp-md init`, it creates agent instructions for AI coding assistants:

- **Claude Code**: `.claude/agents/wp-md.md` (sub-agent)
- **Cursor & others**: `content/AGENTS.md`

These files teach AI assistants how to work with WordPress content, including Gutenberg block syntax and wp-md commands.

## License

MIT
