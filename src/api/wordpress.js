import { CONTENT_TYPES, TAXONOMY_TYPES } from '../config.js';

export class WordPressClient {
  constructor(config) {
    this.baseUrl = config.siteUrl.replace(/\/$/, '');
    this.username = config.username;
    this.appPassword = config.appPassword;
    this.restPath = config.restPath || null; // Will be auto-detected
    this.wcPath = config.wcPath || null; // WooCommerce REST API path
  }

  get authHeader() {
    if (!this.username || !this.appPassword) return null;
    const credentials = Buffer.from(`${this.username}:${this.appPassword}`).toString('base64');
    return `Basic ${credentials}`;
  }

  buildUrl(endpoint) {
    // Try /wp-json/ first, fall back to ?rest_route=
    if (this.restPath === 'query') {
      // Split endpoint into path and query params
      const [path, queryString] = endpoint.split('?');
      const separator = this.baseUrl.includes('?') ? '&' : '?';
      let url = `${this.baseUrl}${separator}rest_route=/wp/v2/${path}`;
      if (queryString) {
        url += `&${queryString}`;
      }
      return url;
    }
    return `${this.baseUrl}/wp-json/wp/v2/${endpoint}`;
  }

  async request(endpoint, options = {}) {
    const url = this.buildUrl(endpoint);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WordPress API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  async detectRestPath() {
    // Try /wp-json/ first
    try {
      const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/`);
      if (response.ok) {
        this.restPath = 'pretty';
        return 'pretty';
      }
    } catch {}

    // Fall back to ?rest_route=
    try {
      const separator = this.baseUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${this.baseUrl}${separator}rest_route=/wp/v2/`);
      if (response.ok) {
        this.restPath = 'query';
        return 'query';
      }
    } catch {}

    throw new Error('Could not detect REST API path');
  }

  async fetchAll(contentType) {
    const config = CONTENT_TYPES[contentType];
    if (!config) {
      throw new Error(`Unknown content type: ${contentType}`);
    }

    if (!this.restPath) {
      await this.detectRestPath();
    }

    const items = [];
    let page = 1;
    const perPage = 100;

    // Use edit context if authenticated (gets raw content), otherwise view
    const context = this.authHeader ? 'edit' : 'view';
    // Media (attachments) don't support status=any, they use status=inherit
    const statusParam = this.authHeader && contentType !== 'attachment' ? '&status=any' : '';

    while (true) {
      try {
        const batch = await this.request(
          `${config.endpoint}?context=${context}&per_page=${perPage}&page=${page}${statusParam}`
        );

        items.push(...batch);

        if (batch.length < perPage) break;
        page++;
      } catch (error) {
        // Some endpoints (like templates) may not exist or be empty
        if (error.message.includes('404') && page === 1) {
          break;
        }
        throw error;
      }
    }

    return items;
  }

  async fetchOne(contentType, id) {
    const config = CONTENT_TYPES[contentType];
    if (!this.restPath) await this.detectRestPath();
    return this.request(`${config.endpoint}/${id}?context=edit`);
  }

  async create(contentType, data) {
    const config = CONTENT_TYPES[contentType];
    if (!this.restPath) await this.detectRestPath();
    return this.request(config.endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async update(contentType, id, data) {
    const config = CONTENT_TYPES[contentType];
    if (!this.restPath) await this.detectRestPath();
    return this.request(`${config.endpoint}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete(contentType, id) {
    const config = CONTENT_TYPES[contentType];
    if (!this.restPath) await this.detectRestPath();
    return this.request(`${config.endpoint}/${id}?force=true`, {
      method: 'DELETE',
    });
  }

  async testConnection() {
    try {
      await this.detectRestPath();
      // For authenticated test, try users/me
      if (this.authHeader) {
        await this.request('users/me');
      }
      return { success: true, restPath: this.restPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getActiveTheme() {
    if (!this.restPath) await this.detectRestPath();
    const themes = await this.request('themes?status=active');
    return themes[0]?.stylesheet || null;
  }

  async fetchGlobalStyles() {
    if (!this.restPath) await this.detectRestPath();

    const theme = await this.getActiveTheme();
    if (!theme) {
      throw new Error('Could not detect active theme');
    }

    // Get global styles for the theme
    const globalStyles = await this.request(`global-styles/themes/${theme}`);

    return {
      theme,
      id: globalStyles.id,
      settings: globalStyles.settings || {},
      styles: globalStyles.styles || {},
      title: globalStyles.title?.rendered || globalStyles.title || 'Global Styles',
    };
  }

  async updateGlobalStyles(id, data) {
    if (!this.restPath) await this.detectRestPath();
    return this.request(`global-styles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async fetchAllTaxonomy(taxonomyType) {
    const config = TAXONOMY_TYPES[taxonomyType];
    if (!config) {
      throw new Error(`Unknown taxonomy type: ${taxonomyType}`);
    }

    if (!this.restPath) {
      await this.detectRestPath();
    }

    const items = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      try {
        const batch = await this.request(
          `${config.endpoint}?per_page=${perPage}&page=${page}`
        );

        items.push(...batch);

        if (batch.length < perPage) break;
        page++;
      } catch (error) {
        // Taxonomy may not exist
        if (error.message.includes('404') && page === 1) {
          break;
        }
        throw error;
      }
    }

    return items;
  }

  async uploadMedia(fileBuffer, filename, mimeType, meta = {}) {
    if (!this.restPath) await this.detectRestPath();

    const url = this.buildUrl('media');

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, filename);

    if (meta.title) formData.append('title', meta.title);
    if (meta.alt_text) formData.append('alt_text', meta.alt_text);
    if (meta.caption) formData.append('caption', meta.caption);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed (${response.status}): ${error}`);
    }

    return response.json();
  }

  // WooCommerce REST API methods
  buildWcUrl(endpoint) {
    if (this.wcPath === 'query') {
      const [path, queryString] = endpoint.split('?');
      const separator = this.baseUrl.includes('?') ? '&' : '?';
      let url = `${this.baseUrl}${separator}rest_route=/wc/v3/${path}`;
      if (queryString) {
        url += `&${queryString}`;
      }
      return url;
    }
    return `${this.baseUrl}/wp-json/wc/v3/${endpoint}`;
  }

  async wcRequest(endpoint, options = {}) {
    const url = this.buildWcUrl(endpoint);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WooCommerce API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  async detectWcPath() {
    // Try /wp-json/wc/v3/ first
    try {
      const response = await fetch(`${this.baseUrl}/wp-json/wc/v3/`, {
        headers: this.authHeader ? { 'Authorization': this.authHeader } : {},
      });
      if (response.ok) {
        this.wcPath = 'pretty';
        return 'pretty';
      }
    } catch {}

    // Fall back to ?rest_route=/wc/v3/
    try {
      const separator = this.baseUrl.includes('?') ? '&' : '?';
      const response = await fetch(`${this.baseUrl}${separator}rest_route=/wc/v3/`, {
        headers: this.authHeader ? { 'Authorization': this.authHeader } : {},
      });
      if (response.ok) {
        this.wcPath = 'query';
        return 'query';
      }
    } catch {}

    // WooCommerce not available
    return null;
  }

  async hasWooCommerce() {
    if (this.wcPath === null) {
      await this.detectWcPath();
    }
    return this.wcPath !== null;
  }

  async fetchWcProduct(productId) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) throw new Error('WooCommerce API not available');
    return this.wcRequest(`products/${productId}`);
  }

  async fetchWcProducts() {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) return [];

    const items = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      try {
        const batch = await this.wcRequest(`products?per_page=${perPage}&page=${page}`);
        items.push(...batch);
        if (batch.length < perPage) break;
        page++;
      } catch (error) {
        if (error.message.includes('404') && page === 1) break;
        throw error;
      }
    }

    return items;
  }

  async fetchProductVariations(productId) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) return [];

    const variations = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      try {
        const batch = await this.wcRequest(
          `products/${productId}/variations?per_page=${perPage}&page=${page}`
        );
        variations.push(...batch);
        if (batch.length < perPage) break;
        page++;
      } catch (error) {
        // Product may not be variable or no variations exist
        if (error.message.includes('404') && page === 1) break;
        throw error;
      }
    }

    return variations;
  }

  async updateWcProduct(productId, data) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) throw new Error('WooCommerce API not available');
    return this.wcRequest(`products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateProductVariation(productId, variationId, data) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) throw new Error('WooCommerce API not available');
    return this.wcRequest(`products/${productId}/variations/${variationId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async createProductVariation(productId, data) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) throw new Error('WooCommerce API not available');
    return this.wcRequest(`products/${productId}/variations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteProductVariation(productId, variationId) {
    if (!this.wcPath) await this.detectWcPath();
    if (!this.wcPath) throw new Error('WooCommerce API not available');
    return this.wcRequest(`products/${productId}/variations/${variationId}?force=true`, {
      method: 'DELETE',
    });
  }
}
