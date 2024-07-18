import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

export type LoggerLevel = 'error' | 'info' | 'log' | 'debug'

export type BaseLogger = Pick<Console, 'debug' | 'log' | 'info' | 'error'>

export interface StoreInput {
  /** The name of the shopify store, without the shopify domain @example https://<mystore>.myshopify.com -> mystore */
  name: string
  /** The Shopify store access token */
  accessToken: string
  /** The API version to use @default `2024-07` */
  apiVersion?: string
}

export interface BaseInput {
  /**
   * Configuration for the store. Must provide at least the store name and access token.
   */
  store: StoreInput
  /**
   * The query to run as a bulk query.
   * You can pass a simple string, a `gql` template literal, or a TypedDocumentNode to get a fully-typed result.
   */
  query: string | TypedDocumentNode
  /**
   * Optional runtime variables to inject into the query. You may not need this if you are directly providing the query
   * (i.e. passing a string, where you can interpolate variables yourself), but is particularly useful if you have queries
   * in a `.graphql` file, and are using `graphql-codegen` to validate those queries, and generate typed documents + `graphql-tag`
   * queries.
   *
   * @example
   * For example, if you have an orders query that has a filter to limit orders to within specific dates,
   * this field may look something like the below:
   *
   * ```ts
   * const searchQueryVariable = `created_at:>=2024-06-01 AND created_at:<2024-07-01`
   *
   * const ordersQuery = `
   *  query OrdersBulkQuery ($searchQuery: String!) {
        orders (
          query: $searchQuery,
          reverse: true,
          sortKey: CREATED_AT,
        ) {
          edges {
            node {
              id
              createdAt
            }
          }
        }
      }
   * `
   *
   * await bulkExport({
   *  query: ordersQuery,
   *  variables: {
   *    searchQuery: searchQueryVariable
   *  },
   *  // ...
   * })
   * ```
   */
  variables?: Record<string, unknown>
  /**
   * The interval between query status checks, in milliseconds.
   * @default 20000 (20 seconds)
   */
  interval?: number
  /**
   * Choose whether to log progress to console. Set to true to enable logging with a level of
   * `debug` (verbose logs), or set to a specific level (from high to low, most verbose to least: `debug` **>** `log` **>** `info` **>** `error`).
   *
   * @default false (silent)
   *
   * @description
   * If you are seeing errors from the `bulkExport` function, you can set the `logs` level to `debug`
   * to see detailed breadcrumbs as the function goes through the various export steps.
   *
   * @example
   * ```ts
   * import bulkExport from 'shopify-bulk-export'
   *
   * bulkExport({
   *  logs: 'error', // Only get `error` type logs.
   *  // ...
   * })
   * ```
   *
   * @example
   * You can also provide your own logger, if needed - it should implement or extend the native `console`,
   * and it needs methods for at least `debug`, `log`, `info`, and `error`. This package uses [`consola`](https://npm.im/consola)
   * internally, so you could for example pass in a custom instance of it with default tags:
   *
   * ```ts
   * import bulkExport from 'shopify-bulk-export'
   * import consola from 'consola'
   *
   * const exportLogger = consola.withTag('Data Export')
   *
   * bulkExport({
   *  logs: exportLogger,
   *  // ...
   * })
   * ```
   */
  logs?: boolean | LoggerLevel | BaseLogger
  /**
   * Configure the cache functionality.
   * You can also pass a folder name if you want to change the cache directory name/path.
   *
   * @default true
   *
   * @description
   * This functionality will save JSONL results to a cache directory in your current directory, and then load
   * the relevant result on subsequent requests if the current input (`query` + `variables`) matches a previous
   * request. This can save a lot of time if you are developing a script and need to run it multiple times.
   *
   * @example
   * ```ts
   * bulkExport({
   *  cache: '.cache/bulk-exports',
   *  // ...
   * })
   * ```
   */
  cache?: boolean | string
}
