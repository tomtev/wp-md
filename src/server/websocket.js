import { WebSocketServer } from 'ws';
import chalk from 'chalk';

let wss = null;
let connectedClients = 0;

/**
 * Start WebSocket server for browser extension communication
 */
export function startServer(port = 3456, sites = []) {
  wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    connectedClients++;
    console.log(chalk.dim(`[WebSocket] Browser connected (${connectedClients} client${connectedClients > 1 ? 's' : ''})`));

    // Send connection info
    ws.send(JSON.stringify({
      type: 'connected',
      sites: sites.map(s => ({ name: s.name, url: s.url })),
      watching: sites.length,
    }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'status') {
          ws.send(JSON.stringify({
            type: 'status',
            sites: sites.map(s => ({ name: s.name, url: s.url })),
            watching: sites.length,
            clients: connectedClients,
          }));
        }
      } catch {}
    });

    ws.on('close', () => {
      connectedClients--;
      console.log(chalk.dim(`[WebSocket] Browser disconnected (${connectedClients} client${connectedClients > 1 ? 's' : ''})`));
    });
  });

  wss.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(chalk.yellow(`[WebSocket] Port ${port} in use, trying ${port + 1}...`));
      startServer(port + 1, sites);
    } else {
      console.log(chalk.red(`[WebSocket] Error: ${error.message}`));
    }
  });

  console.log(chalk.dim(`[WebSocket] Server listening on ws://localhost:${port}`));

  return wss;
}

/**
 * Broadcast event to all connected clients
 */
export function broadcast(event) {
  if (!wss) return;

  const message = JSON.stringify(event);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

/**
 * Send push started event
 */
export function notifyPushing(site, file) {
  broadcast({
    type: 'pushing',
    site: site.name,
    siteUrl: site.url,
    file,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send push completed event
 */
export function notifyPushed(site, file, contentType, id, slug) {
  broadcast({
    type: 'pushed',
    site: site.name,
    siteUrl: site.url,
    file,
    contentType,
    id,
    slug,
    url: `${site.url}/${slug}/`,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send error event
 */
export function notifyError(site, file, message) {
  broadcast({
    type: 'error',
    site: site.name,
    siteUrl: site.url,
    file,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Stop WebSocket server
 */
export function stopServer() {
  if (wss) {
    wss.close();
    wss = null;
  }
}
