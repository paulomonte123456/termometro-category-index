# Índice de categorias do Termómetro Oscar

Este projeto cria um índice central dos posts e respetivas categorias do blog
Cinema é Tudo Isso. O visitante deixa de percorrer páginas de categorias no
navegador. O trabalho pesado é feito uma vez pelo GitHub Actions.

## Ficheiros públicos

* `public/categorias.js`: versão para carregar diretamente com uma tag `script`.
* `public/categorias.json`: versão JSON equivalente.

Cada post fica no formato:

```json
{
  "blog-post-123": {
    "primary": "poster",
    "categories": ["poster", "trailer"],
    "path": "/cinema-eacute-tudo-isso---blog/exemplo"
  }
}
```

## Primeira execução

1. Criar um repositório público no GitHub e enviar estes ficheiros.
2. Em `Settings > Pages`, escolher `GitHub Actions` como origem.
3. Abrir `Actions > Atualizar índice de categorias > Run workflow`.
4. Marcar `Reconstruir todo o índice` e executar.

A primeira execução percorre todas as páginas de todas as categorias. As
execuções seguintes consultam primeiro o feed e acrescentam apenas posts novos.
Quando encontra um post novo, o processo confere também a primeira página de
cada categoria para guardar as categorias secundárias que não aparecem no feed.

## Automatização

O workflow executa a atualização incremental aos minutos 07, 22, 37 e 52 de
cada hora. Aos domingos, às 04:13 UTC, reconstrói o índice completo para detetar
categorias alteradas ou posts removidos.

## Execução local opcional

Requer Node.js 20 ou superior.

```bash
npm test
npm run build:full
npm run build:incremental
```

O computador pessoal não é necessário para a execução automática.
