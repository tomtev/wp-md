# Browser Extension Plan

Auto-refresh WordPress admin when local files change.

## Overview

Chrome/Firefox extension that connects to wp-md CLI via WebSocket. When files change locally and are pushed to WordPress, the extension automatically refreshes the relevant admin page or preview.

## Status

**CLI side: IMPLEMENTED**

- `wp-md watch --server` - Starts WebSocket server on port 3456
- `wp-md watch --all --server` - Watch multiple sites with single WebSocket
- WebSocket module: `src/server/websocket.js`

**Browser extension: NOT YET BUILT**

## Architecture

```
┌─────────────────┐      WebSocket       ┌─────────────────┐
│                 │  ws://localhost:3456 │                 │
│  wp-md watch    │◄────────────────────►│ Browser Extension│
│  --server       │                      │                 │
└────────┬────────┘                      └────────┬────────┘
         │                                        │
         │ File changes                           │ Auto-refresh
         ▼                                        ▼
┌─────────────────┐                      ┌─────────────────┐
│  Local Files    │                      │  WP Admin Tab   │
│  (markdown)     │                      │  or Preview     │
└─────────────────┘                      └─────────────────┘
```

## CLI Usage

```bash
# Single site with WebSocket
wp-md watch --server

# Multiple sites with WebSocket
wp-md watch --all --server

# Custom port
wp-md watch --server --server-port 4000
```

## WebSocket Events

**Server → Extension:**

```json
// File pushed successfully
{
  "type": "pushed",
  "file": "post-types/page/about.md",
  "contentType": "page",
  "id": 123,
  "slug": "about",
  "url": "https://example.com/about/"
}

// Push started
{
  "type": "pushing",
  "file": "post-types/page/about.md"
}

// Error
{
  "type": "error",
  "file": "post-types/page/about.md",
  "message": "API error: unauthorized"
}

// Connection info
{
  "type": "connected",
  "site": "https://example.com",
  "watching": 42
}
```

**Extension → Server:**

```json
// Request current status
{
  "type": "status"
}
```

## Extension Structure

```
extension/
├── manifest.json
├── background.js       # WebSocket connection
├── content.js          # Page refresh logic
├── popup.html          # Status popup
├── popup.js
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

### manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "wp-md Auto Refresh",
  "version": "1.0.0",
  "description": "Auto-refresh WordPress when wp-md pushes changes",
  "permissions": [
    "tabs",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "http://localhost:3456/*",
    "*://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png"
    }
  },
  "icons": {
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

### background.js

```javascript
let ws = null;
let siteUrl = null;

function connect() {
  ws = new WebSocket('ws://localhost:3456');

  ws.onopen = () => {
    console.log('Connected to wp-md');
    updateBadge('on');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };

  ws.onclose = () => {
    console.log('Disconnected from wp-md');
    updateBadge('off');
    // Reconnect after 5s
    setTimeout(connect, 5000);
  };

  ws.onerror = () => {
    updateBadge('off');
  };
}

function handleMessage(data) {
  if (data.type === 'connected') {
    siteUrl = data.site;
  }

  if (data.type === 'pushed') {
    refreshMatchingTabs(data);
  }
}

async function refreshMatchingTabs(data) {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.url) continue;

    // Refresh if viewing the pushed content
    const isAdminEdit = tab.url.includes('/wp-admin/post.php') &&
                        tab.url.includes(`post=${data.id}`);
    const isFrontend = tab.url.includes(data.slug);
    const isSiteEditor = tab.url.includes('/wp-admin/site-editor.php');

    if (isAdminEdit || isFrontend || isSiteEditor) {
      chrome.tabs.reload(tab.id);
    }
  }
}

function updateBadge(status) {
  const color = status === 'on' ? '#22c55e' : '#94a3b8';
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: status === 'on' ? '●' : '' });
}

// Start connection
connect();
```

### popup.html

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      width: 280px;
      padding: 16px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .dot.connected { background: #22c55e; }
    .dot.disconnected { background: #94a3b8; }
    .site {
      color: #666;
      font-size: 12px;
      word-break: break-all;
    }
    .help {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #666;
    }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="status">
    <div class="dot" id="statusDot"></div>
    <span id="statusText">Checking...</span>
  </div>
  <div class="site" id="siteUrl"></div>
  <div class="help">
    Run <code>wp-md watch --server</code> to enable auto-refresh.
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

### popup.js

```javascript
async function updateStatus() {
  try {
    const ws = new WebSocket('ws://localhost:3456');

    ws.onopen = () => {
      document.getElementById('statusDot').className = 'dot connected';
      document.getElementById('statusText').textContent = 'Connected';
      ws.send(JSON.stringify({ type: 'status' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.site) {
        document.getElementById('siteUrl').textContent = data.site;
      }
      ws.close();
    };

    ws.onerror = () => {
      document.getElementById('statusDot').className = 'dot disconnected';
      document.getElementById('statusText').textContent = 'Not connected';
    };
  } catch {
    document.getElementById('statusDot').className = 'dot disconnected';
    document.getElementById('statusText').textContent = 'Not connected';
  }
}

updateStatus();
```

## Refresh Strategies

### 1. Smart Refresh (Default)

Only refresh tabs that match the pushed content:
- Post/page edit screen with matching ID
- Frontend URL containing the slug
- Site editor (always refresh for templates/patterns)

### 2. Soft Refresh for Gutenberg

Instead of full page reload, inject script to trigger Gutenberg refresh:

```javascript
// content.js - injected into WP admin
function softRefresh() {
  // Dispatch event that Gutenberg listens to
  const event = new CustomEvent('wp-md-refresh');
  window.dispatchEvent(event);

  // Or trigger the "Switch to draft" then back
  // to force content reload without losing scroll position
}
```

### 3. Preview Pane Only

For side-by-side editing, only refresh the preview iframe:

```javascript
const previewFrame = document.querySelector('iframe[name="editor-canvas"]');
if (previewFrame) {
  previewFrame.contentWindow.location.reload();
}
```

## User Settings

Store in `chrome.storage.sync`:

```javascript
{
  "enabled": true,
  "refreshMode": "smart", // "smart" | "all" | "preview-only"
  "port": 3456,
  "showNotifications": true
}
```

## Future Enhancements

1. **Notifications** - Show toast when content is pushed
2. **Quick actions** - Pull/push buttons in popup
3. **Multiple sites** - Connect to multiple wp-md instances
4. **Conflict detection** - Warn if WP content changed since last pull
5. **Firefox support** - Port to Firefox extension

## Implementation Steps

1. Add `--server` flag to `wp-md watch` command
2. Create WebSocket server in `src/server/websocket.js`
3. Broadcast events on file push
4. Create extension scaffold
5. Implement background service worker
6. Add popup UI
7. Test with various WP admin pages
8. Package and publish to Chrome Web Store
