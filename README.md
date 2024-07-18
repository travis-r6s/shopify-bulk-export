# shopify-data-export

A package to help you bulk export data from Shopify's async [Bulk Operation API](https://shopify.dev/docs/api/usage/bulk-operations/queries).

> [!WARNING]
> Using this package usually results in a long-running task (using `await` to pause until the export has completed), so is not suitable for usage in servers or API's - it is best suited for custom Node.js scripts you may create and run locally, or in background jobs.

### Usage

Install the package:

```sh
pnpm install shopify-bulk-export
```

Then, import the package and use the default exported function to run a query:

```ts
import bulkExport from 'shopify-bulk-export'

interface Product {
  id: string
  title: string
}

// The function accepts a generic, which will be the type of the nodes returned:
const data = await bulkExport<Product>({
  query: 'query Products { products { edges { node { id title } } } }',
  store: {
    accessToken: '',
    name: ''
  }
})
```

You can also pass a `TypedDocumentNode` query if you use the GraphQL Code Generator for example:

```ts
import bulkExport from 'shopify-bulk-export'
import { ProductsQueryDoc } from './generated'

const data = await bulkExport({
  query: ProductsQueryDoc,
  store: {
    accessToken: '',
    name: ''
  }
})
```

If your query has variables (for example a search query), you can pass these in and they will be replaced in your query:

```ts
import bulkExport from 'shopify-bulk-export'

const searchQuery = `<some-runtime-value>`

const data = await bulkExport({
  query: 'query Products ($searchQuery: String!) { products (query: $searchQuery) { edges { node { id title } } } }',
  store: {
    accessToken: '',
    name: ''
  },
  variables: {
    searchQuery
  }
})
```
