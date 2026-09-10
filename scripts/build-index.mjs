import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SITE_ORIGIN = 'https://www.termometrooscar.com';
export const BLOG_PATH = '/cinema-eacute-tudo-isso---blog';

// Mesma whitelist utilizada no Weebly.
export const CATEGORY_SLUGS = [
  'poster',
  'termometro-de-sexta',
  'premiacao-preoscar',
  'noticias-do-dia',
  'cobertura-oscar',
  'oscar',
  'alerta-oscar',
  'especial',
  'festival-de-cannes',
  'festival-de-veneza',
  'festival-de-sundance',
  'festival-de-toronto',
  'festival-de-nova-york',
  'festival-de-telluride',
  'festival-de-berlim',
  'festival-de-londres',
  'trailer',
  'novidade',
  'podcast',
  'primeira-foto',
  'in-memoriam',
  'in-memorian',
  'bastidores',
  'urgente',
  'exclusivo'
];

const CANONICAL_ALIASES = {
  'premiacao-pre-oscar': 'premiacao-preoscar',
  'in-memorian': 'in-memoriam'
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_DELAY_MS = 300;
const DEFAULT_CATEGORY_CONCURRENCY = 2;
const DEFAULT_MAX_PAGES = 500;
const CATEGORY_ORDER = [...new Set(CATEGORY_SLUGS.map(canonicalSlug))];
const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((slug, index) => [slug, index]));

function parseArgs(argv) {
  const args = {
    mode: 'incremental',
    state: 'data/index.json',
    outputDir: 'public',
    maxPages: DEFAULT_MAX_PAGES
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--state') args.state = argv[++i];
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--max-pages') args.maxPages = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }

  if (!['full', 'incremental'].includes(args.mode)) {
    throw new Error('Use --mode full ou --mode incremental.');
  }
  if (!Number.isInteger(args.maxPages) || args.maxPages < 1) {
    throw new Error('--max-pages precisa de ser um número inteiro positivo.');
  }
  return args;
}

export function canonicalSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
  return CANONICAL_ALIASES[slug] || slug;
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? htmlDecode(match[2]) : '';
}

function normalizePostPath(url) {
  try {
    return new URL(htmlDecode(url), SITE_ORIGIN).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

export function extractPosts(html) {
  const matches = [];
  const tagPattern = /<div\b[^>]*>/gi;
  let tagMatch;

  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const tag = tagMatch[0];
    const classes = getAttribute(tag, 'class').split(/\s+/);
    const id = getAttribute(tag, 'id');
    if (classes.includes('blog-post') && /^blog-post-\d+$/.test(id)) {
      matches.push({ id, start: tagMatch.index });
    }
  }

  return matches.map((post, index) => {
    const end = matches[index + 1]?.start ?? html.length;
    const fragment = html.slice(post.start, Math.min(end, post.start + 12_000));
    const anchors = fragment.match(/<a\b[^>]*>/gi) || [];
    let postPath = '';

    for (const anchor of anchors) {
      const classes = getAttribute(anchor, 'class').split(/\s+/);
      if (!classes.includes('blog-title-link')) continue;
      postPath = normalizePostPath(getAttribute(anchor, 'href'));
      if (postPath) break;
    }

    return { id: post.id, path: postPath };
  });
}

export function extractNextPage(html, currentUrl) {
  const navMatch = html.match(/<div\b[^>]*class\s*=\s*(["'])[^"']*\bblog-page-nav-previous\b[^"']*\1[^>]*>[\s\S]{0,1500}?<a\b[^>]*>/i);
  if (!navMatch) return '';
  const anchor = navMatch[0].match(/<a\b[^>]*>/i)?.[0] || '';
  const href = getAttribute(anchor, 'href');
  if (!href) return '';
  try {
    return new URL(href, currentUrl).href;
  } catch {
    return '';
  }
}

function cdataOrText(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tagName}>`, 'i'));
  return match ? htmlDecode(match[1].trim()) : '';
}

export function parseFeed(xml) {
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return itemBlocks.map((block) => {
    const postPath = normalizePostPath(cdataOrText(block, 'link'));
    const categories = [];
    const categoryPattern = /<category\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/gi;
    let match;
    while ((match = categoryPattern.exec(block)) !== null) {
      const slug = canonicalSlug(htmlDecode(match[1].trim()));
      if (slug && !categories.includes(slug)) categories.push(slug);
    }
    return { path: postPath, categories };
  }).filter((item) => item.path);
}

function orderedCategories(categories) {
  const allowed = new Set(CATEGORY_ORDER);
  const unique = [...new Set(categories.map(canonicalSlug).filter((slug) => allowed.has(slug)))];
  return unique.sort((a, b) => CATEGORY_RANK.get(a) - CATEGORY_RANK.get(b));
}

function mergePost(posts, id, postPath, categories) {
  const previous = posts[id] || { primary: '', categories: [], path: '' };
  const mergedCategories = orderedCategories([...previous.categories, ...categories]);
  posts[id] = {
    primary: mergedCategories[0] || '',
    categories: mergedCategories,
    path: postPath || previous.path || ''
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'TermometroOscarCategoryIndex/1.0' }
      });
      if (response.status === 404 || response.status === 410) {
        return { text: '', missing: true };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
      return { text: await response.text(), missing: false };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function crawlCategory(slug, maxPages) {
  const canonical = canonicalSlug(slug);
  let url = `${SITE_ORIGIN}${BLOG_PATH}/category/${slug}`;
  const found = [];
  const visited = new Set();

  for (let page = 1; page <= maxPages && url; page += 1) {
    if (visited.has(url)) throw new Error(`Paginação circular em ${url}`);
    visited.add(url);

    const response = await fetchText(url);
    if (response.missing && page === 1) {
      console.log(`[${slug}] categoria inexistente; ignorada.`);
      return found;
    }
    if (response.missing) break;

    const pagePosts = extractPosts(response.text);
    for (const post of pagePosts) found.push({ ...post, category: canonical });
    console.log(`[${slug}] página ${page}: ${pagePosts.length} posts.`);

    url = extractNextPage(response.text, url);
    if (url) await sleep(Number(process.env.REQUEST_DELAY_MS || DEFAULT_REQUEST_DELAY_MS));
  }

  if (url) throw new Error(`[${slug}] excedeu o limite de ${maxPages} páginas.`);
  return found;
}

async function buildFull(maxPages) {
  const posts = {};
  const concurrency = Number(process.env.CATEGORY_CONCURRENCY || DEFAULT_CATEGORY_CONCURRENCY);
  const categoryResults = await mapWithLimit(CATEGORY_SLUGS, concurrency, (slug) => crawlCategory(slug, maxPages));

  for (const results of categoryResults) {
    for (const post of results) mergePost(posts, post.id, post.path, [post.category]);
  }
  return posts;
}

async function loadState(statePath) {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function findPostId(postPath) {
  const response = await fetchText(`${SITE_ORIGIN}${postPath}`);
  const first = extractPosts(response.text)[0];
  return first?.id || '';
}

async function addCategoriesFromLatestPages(posts, newIds) {
  if (newIds.size === 0) return false;

  const concurrency = Number(process.env.CATEGORY_CONCURRENCY || DEFAULT_CATEGORY_CONCURRENCY);
  const results = await mapWithLimit(CATEGORY_SLUGS, concurrency, async (slug) => {
    const url = `${SITE_ORIGIN}${BLOG_PATH}/category/${slug}`;
    const response = await fetchText(url);
    if (response.missing) return [];
    return extractPosts(response.text)
      .filter((post) => newIds.has(post.id))
      .map((post) => ({ ...post, category: canonicalSlug(slug) }));
  });

  let changed = false;
  for (const categoryPosts of results) {
    for (const post of categoryPosts) {
      const before = JSON.stringify(posts[post.id] || null);
      mergePost(posts, post.id, post.path, [post.category]);
      if (JSON.stringify(posts[post.id]) !== before) changed = true;
    }
  }
  return changed;
}

async function buildIncremental(previousState) {
  const posts = structuredClone(previousState.posts || {});
  const byPath = new Map();
  for (const [id, post] of Object.entries(posts)) {
    if (post.path) byPath.set(post.path, id);
  }

  const feed = await fetchText(`${SITE_ORIGIN}${BLOG_PATH}/feed`);
  const feedItems = parseFeed(feed.text);
  let changed = false;
  const newIds = new Set();

  for (const item of feedItems) {
    let id = byPath.get(item.path) || '';
    if (!id) {
      id = await findPostId(item.path);
      if (!id) {
        console.warn(`[feed] não foi possível obter o ID de ${item.path}`);
        continue;
      }
      byPath.set(item.path, id);
      newIds.add(id);
      changed = true;
    }

    const before = JSON.stringify(posts[id] || null);
    mergePost(posts, id, item.path, item.categories);
    if (JSON.stringify(posts[id]) !== before) changed = true;
  }

  // O feed do Weebly normalmente expõe apenas uma categoria. Para posts novos,
  // a primeira página de cada arquivo revela também as categorias secundárias.
  if (await addCategoriesFromLatestPages(posts, newIds)) changed = true;

  return { posts, changed };
}

function stablePosts(posts) {
  return Object.fromEntries(Object.entries(posts).sort(([a], [b]) => a.localeCompare(b)));
}

async function writeIndex(statePath, outputDir, posts) {
  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    posts: stablePosts(posts)
  };

  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(index, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, 'categorias.json'), `${JSON.stringify(index)}\n`);
  await fs.writeFile(path.join(outputDir, 'categorias.js'), `window.CETI_CATEGORY_INDEX=${JSON.stringify(index)};\n`);
  return index;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const statePath = path.resolve(root, args.state);
  const outputDir = path.resolve(root, args.outputDir);
  const previous = await loadState(statePath);

  let posts;
  let changed;
  let mode = args.mode;

  if (mode === 'incremental' && !previous) {
    console.log('Índice ainda não existe. A executar a criação completa.');
    mode = 'full';
  }

  if (mode === 'full') {
    posts = await buildFull(args.maxPages);
    changed = true;
  } else {
    const result = await buildIncremental(previous);
    posts = result.posts;
    changed = result.changed;
  }

  if (changed) {
    const index = await writeIndex(statePath, outputDir, posts);
    console.log(`Índice ${mode} gravado com ${Object.keys(index.posts).length} posts.`);
  } else {
    console.log('Nenhum post novo ou alteração encontrada.');
  }
  console.log(`INDEX_CHANGED=${changed ? 'true' : 'false'}`);
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
