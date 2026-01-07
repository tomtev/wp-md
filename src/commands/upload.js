import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, CONTENT_TYPES, loadState, saveState } from '../config.js';
import { WordPressClient } from '../api/wordpress.js';
import { mediaToMarkdown, hashContent } from '../sync/content.js';

export async function uploadCommand(filePath, options) {
  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('No configuration found. Run `wp-sync init` first.'));
    return;
  }

  if (!filePath) {
    console.log(chalk.red('File path is required.'));
    console.log(chalk.dim('Usage: wp-sync upload <file> [--title "Image Title"] [--alt "Alt text"]'));
    return;
  }

  const client = new WordPressClient(config);
  const state = await loadState();
  const contentDir = config.contentDir || 'content';

  const spinner = ora(`Uploading ${basename(filePath)}...`).start();

  try {
    // Read the file
    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath);
    const mimeType = getMimeType(filePath);

    // Upload to WordPress
    const uploaded = await client.uploadMedia(fileBuffer, filename, mimeType, {
      title: options.title || filename.replace(/\.[^/.]+$/, ''),
      alt_text: options.alt || '',
      caption: options.caption || '',
    });

    spinner.text = 'Saving local metadata...';

    // Save media metadata locally
    const typeConfig = CONTENT_TYPES.attachment;
    const mediaDir = join(process.cwd(), contentDir, typeConfig.folder);
    await mkdir(mediaDir, { recursive: true });

    const mdFilename = `${uploaded.slug}.md`;
    const mdFilepath = join(mediaDir, mdFilename);
    const relativePath = join(contentDir, typeConfig.folder, mdFilename);

    const markdown = mediaToMarkdown(uploaded);
    const hash = hashContent(markdown);

    await writeFile(mdFilepath, markdown);

    // Update state
    state.files[relativePath] = {
      id: uploaded.id,
      type: 'attachment',
      localHash: hash,
      remoteHash: hash,
      lastSync: new Date().toISOString(),
    };
    await saveState(state);

    spinner.succeed(`Uploaded: ${relativePath}`);
    console.log(chalk.dim(`   ID: ${uploaded.id}`));
    console.log(chalk.dim(`   URL: ${uploaded.source_url}`));

  } catch (error) {
    spinner.fail(`Failed to upload: ${error.message}`);
  }
}

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
