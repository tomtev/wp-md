# wp-md CLI - Development Guide

This document is for AI agents and developers working on the wp-md CLI tool itself.

## Project Overview

wp-md is a Node.js CLI that syncs WordPress content as local markdown files. It's designed for AI code agents and developers to edit WordPress content locally.

## Project Structure

```
wp-md/
├── bin/
│   └── cli.js              # CLI entry point
├── src/
│   ├── api/
│   │   └── wordpress.js    # WordPress REST API client
│   ├── commands/
│   │   ├── init.js         # wp-md init
│   │   ├── pull.js         # wp-md pull
│   │   ├── push.js         # wp-md push
│   │   ├── status.js       # wp-md status
│   │   ├── watch.js        # wp-md watch
│   │   ├── new.js          # wp-md new
│   │   ├── upload.js       # wp-md upload
│   │   └── force-push.js   # wp-md force-push
│   ├── sync/
│   │   └── content.js      # Markdown/WordPress conversion
│   ├── utils/
│   │   └── version-check.js # Auto-update checker
│   └── config.js           # Configuration and content types
├── install.sh              # Installer script
├── uninstall.sh            # Uninstaller script
├── package.json
└── README.md
```

## Key Files

- **bin/cli.js** - Main entry point, defines all commands using Commander.js
- **src/config.js** - Defines `CONTENT_TYPES` and `TAXONOMY_TYPES` for WordPress
- **src/api/wordpress.js** - WordPress REST API client with auth handling
- **src/sync/content.js** - Converts between WordPress API format and markdown

## Dependencies

- `commander` - CLI framework
- `inquirer` - Interactive prompts
- `chalk` - Terminal colors
- `ora` - Spinners
- `yaml` - YAML parsing for frontmatter
- `chokidar` - File watching

## Commands

| Command | File | Description |
|---------|------|-------------|
| `wp-md init` | init.js | Setup WordPress connection, create .env |
| `wp-md pull` | pull.js | Download content from WordPress |
| `wp-md push` | push.js | Upload local changes to WordPress |
| `wp-md status` | status.js | Show sync status |
| `wp-md watch` | watch.js | Watch for changes, auto-sync |
| `wp-md new` | new.js | Create new content |
| `wp-md upload` | upload.js | Upload media files |
| `wp-md force-push` | force-push.js | Push all content |

## Releasing New Versions

Version is read from `package.json`. The CLI auto-checks for updates.

```bash
# Bump version
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# Push to GitHub
git add -A && git commit -m "Release vX.X.X" && git push
```

Users will see update notification:
```
Update available: 1.0.0 → 1.0.1
Run: curl -fsSL https://raw.githubusercontent.com/tomtev/wp-md/main/install.sh | bash
```

## Adding New Content Types

1. Add to `CONTENT_TYPES` in `src/config.js`:
```javascript
export const CONTENT_TYPES = {
  // ...
  new_type: {
    endpoint: 'new-type',      // REST API endpoint
    folder: 'new-types',       // Local folder
    label: 'New Types',        // Display name
    postType: 'new_type'       // WordPress post type
  },
};
```

2. Update `wpToMarkdown()` and `markdownToWp()` in `src/sync/content.js` if needed

## Adding New Commands

1. Create `src/commands/your-command.js`:
```javascript
export async function yourCommand(options) {
  // Implementation
}
```

2. Register in `bin/cli.js`:
```javascript
import { yourCommand } from '../src/commands/your-command.js';

program
  .command('your-command')
  .description('Description here')
  .action(yourCommand);
```

## Testing Locally

```bash
# Link for local development
npm link

# Test commands
wp-md --help
wp-md init

# Unlink when done
npm unlink -g
```

## Installation Flow

1. User runs `curl ... | bash`
2. `install.sh` downloads repo to `~/.wp-md`
3. Runs `npm install --omit=dev`
4. Creates symlink in `~/.local/bin/wp-md`
5. Adds `~/.local/bin` to PATH in shell profile
