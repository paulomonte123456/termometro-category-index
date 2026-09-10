import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSlug,
  extractNextPage,
  extractPosts,
  parseFeed
} from '../scripts/build-index.mjs';

test('normaliza nomes especiais das categorias', () => {
  assert.equal(canonicalSlug('Premiação Pré-Oscar'), 'premiacao-preoscar');
  assert.equal(canonicalSlug('Notícias do Dia'), 'noticias-do-dia');
  assert.equal(canonicalSlug('In Memorian'), 'in-memoriam');
});

test('extrai ID, caminho e paginação do HTML do Weebly', () => {
  const html = `
    <div id="blog-post-123456" class="blog-post">
      <h2><a class="blog-title-link blog-link" href="//www.termometrooscar.com/cinema-eacute-tudo-isso---blog/meu-post">Título</a></h2>
    </div>
    <div class="blog-page-nav-previous"><a href="/cinema-eacute-tudo-isso---blog/category/poster/2">Anterior</a></div>
  `;
  assert.deepEqual(extractPosts(html), [{
    id: 'blog-post-123456',
    path: '/cinema-eacute-tudo-isso---blog/meu-post'
  }]);
  assert.equal(
    extractNextPage(html, 'https://www.termometrooscar.com/cinema-eacute-tudo-isso---blog/category/poster'),
    'https://www.termometrooscar.com/cinema-eacute-tudo-isso---blog/category/poster/2'
  );
});

test('extrai posts e categorias do feed', () => {
  const xml = `
    <rss><channel><item>
      <link><![CDATA[https://www.termometrooscar.com/cinema-eacute-tudo-isso---blog/meu-post]]></link>
      <category><![CDATA[Poster]]></category>
      <category><![CDATA[Premiação Pré-Oscar]]></category>
    </item></channel></rss>
  `;
  assert.deepEqual(parseFeed(xml), [{
    path: '/cinema-eacute-tudo-isso---blog/meu-post',
    categories: ['poster', 'premiacao-preoscar']
  }]);
});
