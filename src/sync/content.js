import YAML from 'yaml';

/**
 * Convert WordPress API response to markdown file content
 */
export function wpToMarkdown(item, contentType) {
  const frontmatter = buildFrontmatter(item, contentType);
  // Prefer raw content (from edit context), fall back to rendered (from view context)
  const content = item.content?.raw ?? item.content?.rendered ?? item.content ?? '';

  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n${content}`;
}

/**
 * Parse markdown file content to WordPress API format
 */
export function markdownToWp(fileContent) {
  const { frontmatter, content } = parseFrontmatter(fileContent);

  return {
    id: frontmatter.id,
    type: frontmatter.type,
    data: {
      title: frontmatter.title,
      slug: frontmatter.slug,
      status: frontmatter.status,
      content: content,
      excerpt: frontmatter.excerpt,
      categories: frontmatter.categories,
      tags: frontmatter.tags,
      featured_media: frontmatter.featured_image,
      template: frontmatter.template,
      menu_order: frontmatter.menu_order,
      parent: frontmatter.parent,
    },
  };
}

function buildFrontmatter(item, contentType) {
  const fm = {
    id: item.id,
    type: contentType,
    slug: item.slug,
    status: item.status,
    title: item.title?.raw || item.title?.rendered || item.title || '',
    date: item.date,
    modified: item.modified,
  };

  // Type-specific fields
  if (contentType === 'post' || contentType === 'page') {
    fm.author = item.author;
    if (item.excerpt?.raw) fm.excerpt = item.excerpt.raw;
    if (item.featured_media) fm.featured_image = item.featured_media;
    if (item.categories?.length) fm.categories = item.categories;
    if (item.tags?.length) fm.tags = item.tags;
    if (item.template) fm.template = item.template;
  }

  if (contentType === 'page') {
    if (item.parent) fm.parent = item.parent;
    if (item.menu_order) fm.menu_order = item.menu_order;
  }

  if (contentType === 'wp_template' || contentType === 'wp_template_part') {
    fm.theme = item.theme;
    if (item.area) fm.area = item.area;
    if (item.is_custom) fm.is_custom = item.is_custom;
  }

  if (contentType === 'attachment') {
    fm.media_type = item.media_type;
    fm.mime_type = item.mime_type;
    fm.alt_text = item.alt_text || '';
    fm.source_url = item.source_url;

    // Image dimensions
    if (item.media_details) {
      fm.width = item.media_details.width;
      fm.height = item.media_details.height;
      fm.file = item.media_details.file;

      // All available sizes with URLs
      if (item.media_details.sizes) {
        fm.sizes = {};
        for (const [size, data] of Object.entries(item.media_details.sizes)) {
          fm.sizes[size] = {
            url: data.source_url,
            width: data.width,
            height: data.height,
          };
        }
      }
    }
  }

  // WooCommerce Products
  if (contentType === 'product') {
    if (item.featured_media) fm.featured_image = item.featured_media;
    if (item.product_cat?.length) fm.product_categories = item.product_cat;
    if (item.product_tag?.length) fm.product_tags = item.product_tag;
    if (item.product_brand?.length) fm.product_brands = item.product_brand;
    // WooCommerce specific meta (if available via REST)
    if (item.meta) {
      if (item.meta._price) fm.price = item.meta._price;
      if (item.meta._regular_price) fm.regular_price = item.meta._regular_price;
      if (item.meta._sale_price) fm.sale_price = item.meta._sale_price;
      if (item.meta._sku) fm.sku = item.meta._sku;
      if (item.meta._stock_status) fm.stock_status = item.meta._stock_status;
    }
  }

  return fm;
}

/**
 * Convert taxonomy term to markdown
 */
export function taxonomyToMarkdown(item, taxonomyType) {
  const fm = {
    id: item.id,
    type: taxonomyType,
    slug: item.slug,
    name: item.name,
    description: item.description || '',
    parent: item.parent || 0,
    count: item.count || 0,
  };

  // Add taxonomy-specific fields
  if (item.meta) {
    // Product category/brand may have thumbnail
    if (item.meta.thumbnail_id) fm.thumbnail_id = item.meta.thumbnail_id;
  }

  // Some taxonomies have additional fields
  if (item.image) {
    fm.image = {
      id: item.image.id,
      src: item.image.src,
    };
  }

  let body = '';
  if (item.description) {
    body = item.description;
  }

  return `---\n${YAML.stringify(fm).trim()}\n---\n${body}`;
}

/**
 * Build markdown content for media items
 */
export function mediaToMarkdown(item) {
  const frontmatter = buildFrontmatter(item, 'attachment');

  // Build readable markdown body
  let body = '';

  // Preview image
  if (item.media_type === 'image') {
    body += `![${frontmatter.alt_text || frontmatter.title}](${item.source_url})\n\n`;
  }

  // Caption if exists
  if (item.caption?.rendered || item.caption?.raw) {
    const caption = item.caption?.raw || item.caption?.rendered?.replace(/<[^>]*>/g, '') || '';
    if (caption.trim()) {
      body += `**Caption:** ${caption.trim()}\n\n`;
    }
  }

  // Description if exists
  if (item.description?.rendered || item.description?.raw) {
    const desc = item.description?.raw || item.description?.rendered?.replace(/<[^>]*>/g, '') || '';
    if (desc.trim()) {
      body += `**Description:** ${desc.trim()}\n\n`;
    }
  }

  // Size reference table for images
  if (item.media_details?.sizes && Object.keys(item.media_details.sizes).length > 0) {
    body += `## Available Sizes\n\n`;
    body += `| Size | Dimensions | URL |\n`;
    body += `|------|------------|-----|\n`;
    for (const [size, data] of Object.entries(item.media_details.sizes)) {
      body += `| ${size} | ${data.width}x${data.height} | ${data.source_url} |\n`;
    }
  }

  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n${body}`;
}

function parseFrontmatter(fileContent) {
  const match = fileContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    throw new Error('Invalid file format: missing frontmatter');
  }

  return {
    frontmatter: YAML.parse(match[1]),
    content: match[2] || '',
  };
}

/**
 * Generate a filename from item data
 */
export function generateFilename(item) {
  const slug = item.slug || `untitled-${item.id}`;
  return `${slug}.md`;
}

/**
 * Create a hash for change detection
 */
export function hashContent(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * Convert WooCommerce product API response to markdown
 */
export function wcProductToMarkdown(product, variations = []) {
  const fm = {
    id: product.id,
    type: 'product',
    slug: product.slug,
    status: product.status,
    title: product.name,
    product_type: product.type, // simple, variable, grouped, external
    date_created: product.date_created,
    date_modified: product.date_modified,
  };

  // Pricing
  if (product.price) fm.price = product.price;
  if (product.regular_price) fm.regular_price = product.regular_price;
  if (product.sale_price) fm.sale_price = product.sale_price;
  if (product.on_sale) fm.on_sale = product.on_sale;

  // Inventory
  if (product.sku) fm.sku = product.sku;
  fm.manage_stock = product.manage_stock;
  fm.stock_status = product.stock_status;
  if (product.stock_quantity !== null) fm.stock_quantity = product.stock_quantity;

  // Taxonomy
  if (product.categories?.length) {
    fm.categories = product.categories.map(c => ({ id: c.id, name: c.name, slug: c.slug }));
  }
  if (product.tags?.length) {
    fm.tags = product.tags.map(t => ({ id: t.id, name: t.name, slug: t.slug }));
  }

  // Images
  if (product.images?.length) {
    fm.images = product.images.map(img => ({
      id: img.id,
      src: img.src,
      alt: img.alt,
    }));
  }

  // Attributes (for variable products)
  if (product.attributes?.length) {
    fm.attributes = product.attributes.map(attr => ({
      id: attr.id,
      name: attr.name,
      slug: attr.slug || attr.name.toLowerCase().replace(/\s+/g, '-'),
      options: attr.options,
      variation: attr.variation,
      visible: attr.visible,
    }));
  }

  // Default attributes (for variable products)
  if (product.default_attributes?.length) {
    fm.default_attributes = product.default_attributes;
  }

  // Variations
  if (variations.length > 0) {
    fm.variations = variations.map(v => ({
      id: v.id,
      sku: v.sku || '',
      price: v.price,
      regular_price: v.regular_price,
      sale_price: v.sale_price,
      on_sale: v.on_sale,
      stock_status: v.stock_status,
      stock_quantity: v.stock_quantity,
      manage_stock: v.manage_stock,
      attributes: v.attributes.map(a => ({
        name: a.name,
        option: a.option,
      })),
      image: v.image ? { id: v.image.id, src: v.image.src } : null,
    }));
  }

  // Additional fields
  if (product.short_description) fm.short_description = product.short_description;
  if (product.weight) fm.weight = product.weight;
  if (product.dimensions) {
    fm.dimensions = {
      length: product.dimensions.length,
      width: product.dimensions.width,
      height: product.dimensions.height,
    };
  }

  // Content is the long description
  const content = product.description || '';

  return `---\n${YAML.stringify(fm).trim()}\n---\n${content}`;
}

/**
 * Parse product markdown to WooCommerce API format
 */
export function markdownToWcProduct(fileContent) {
  const { frontmatter, content } = parseFrontmatter(fileContent);

  const data = {
    name: frontmatter.title,
    slug: frontmatter.slug,
    status: frontmatter.status,
    type: frontmatter.product_type || 'simple',
    description: content,
  };

  // Pricing
  if (frontmatter.regular_price !== undefined) data.regular_price = String(frontmatter.regular_price);
  if (frontmatter.sale_price !== undefined) data.sale_price = String(frontmatter.sale_price);

  // Inventory
  if (frontmatter.sku !== undefined) data.sku = frontmatter.sku;
  if (frontmatter.manage_stock !== undefined) data.manage_stock = frontmatter.manage_stock;
  if (frontmatter.stock_status !== undefined) data.stock_status = frontmatter.stock_status;
  if (frontmatter.stock_quantity !== undefined) data.stock_quantity = frontmatter.stock_quantity;

  // Short description
  if (frontmatter.short_description !== undefined) data.short_description = frontmatter.short_description;

  // Weight and dimensions
  if (frontmatter.weight !== undefined) data.weight = frontmatter.weight;
  if (frontmatter.dimensions) data.dimensions = frontmatter.dimensions;

  // Categories (by ID)
  if (frontmatter.categories?.length) {
    data.categories = frontmatter.categories.map(c => ({ id: c.id }));
  }

  // Tags (by ID)
  if (frontmatter.tags?.length) {
    data.tags = frontmatter.tags.map(t => ({ id: t.id }));
  }

  // Images (by ID or src)
  if (frontmatter.images?.length) {
    data.images = frontmatter.images.map(img =>
      img.id ? { id: img.id } : { src: img.src, alt: img.alt }
    );
  }

  // Attributes (for variable products)
  if (frontmatter.attributes?.length) {
    data.attributes = frontmatter.attributes.map(attr => ({
      id: attr.id || 0,
      name: attr.name,
      options: attr.options,
      variation: attr.variation ?? true,
      visible: attr.visible ?? true,
    }));
  }

  // Default attributes
  if (frontmatter.default_attributes?.length) {
    data.default_attributes = frontmatter.default_attributes;
  }

  return {
    id: frontmatter.id,
    type: 'product',
    data,
    variations: frontmatter.variations || [],
  };
}

/**
 * Convert a single variation to API format for updating
 */
export function parseVariationData(variation) {
  const data = {};

  if (variation.sku !== undefined) data.sku = variation.sku;
  if (variation.regular_price !== undefined) data.regular_price = String(variation.regular_price);
  if (variation.sale_price !== undefined) data.sale_price = String(variation.sale_price);
  if (variation.stock_status !== undefined) data.stock_status = variation.stock_status;
  if (variation.stock_quantity !== undefined) data.stock_quantity = variation.stock_quantity;
  if (variation.manage_stock !== undefined) data.manage_stock = variation.manage_stock;

  // Attributes are required for variations
  if (variation.attributes?.length) {
    data.attributes = variation.attributes.map(a => ({
      name: a.name,
      option: a.option,
    }));
  }

  // Image
  if (variation.image?.id) {
    data.image = { id: variation.image.id };
  } else if (variation.image?.src) {
    data.image = { src: variation.image.src };
  }

  return data;
}
