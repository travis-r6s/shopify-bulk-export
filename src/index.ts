import assert from 'node:assert'
import { createInterface } from 'node:readline'
import { LogLevels as ConsolaLogLevels, createConsola } from 'consola'
import got, { type Got } from 'got'
import pWaitFor from 'p-wait-for'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { parse, print, visit } from 'graphql'
import { BulkOperationStatus, BulkStatusQuery, type BulkStatusQueryType, type GraphQLResponse, StartBulkQuery, type StartBulkQueryType } from './bulk-queries'
import { createCache } from './cache'

export interface StoreInput {
  /** The name of the shopify store, without the shopify domain @example https://<mystore>.myshopify.com -> mystore */
  name: string
  /** The Shopify store access token */
  accessToken: string
  /** The API version to use @default `2024-07` */
  apiVersion?: string
}

export type LoggerLevel = 'error' | 'info' | 'log' | 'debug'

export type BaseLogger = Pick<Console, 'debug' | 'log' | 'info' | 'error'>

export interface PluginInput {
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

export interface FunctionContext {
  logger: BaseLogger
}

const DEFAULT_API_VERSION = '2024-07'

export function replaceQueryVariables(query: string | TypedDocumentNode, variables: Record<string, unknown> | undefined, ctx: FunctionContext): string {
  const ast = typeof query === 'string' ? parse(query) : query
  if (!variables) {
    const formattedQuery = print(ast)
    ctx.logger.debug('No variables input to be replaced, so returning query:', formattedQuery)
    return formattedQuery
  }

  ctx.logger.debug(`Replacing variables in query:`, variables)

  const editedAST = visit(ast, {
    Variable(node, key) {
      if (key !== 'value') {
        return
      }

      if (Reflect.has(variables, node.name.value)) {
        return {
          kind: 'StringValue',
          value: Reflect.get(variables, node.name.value),
        }
      }
    },
    VariableDefinition() {
      return null
    },
  })

  const formattedQuery = print(editedAST)

  ctx.logger.debug('Replaced all variables in query:', formattedQuery)

  return formattedQuery
}

async function startBulkQuery(query: string, client: Got, ctx: FunctionContext): Promise<string> {
  const { body, headers, statusCode, statusMessage } = await client.post<GraphQLResponse<StartBulkQueryType>>('graphql.json', {
    responseType: 'json',
    json: {
      query: StartBulkQuery,
      variables: { query },
    },
  })

  if (body.errors?.length) {
    ctx.logger.error('Received errors during bulk status query:')
    for (const error of body.errors) {
      ctx.logger.error(error.message, error)
    }

    throw new Error(body.errors[0].message)
  }

  if (!body.data?.bulkOperationRunQuery) {
    ctx.logger.error('Missing `data.bulkOperationRunQuery` key in response from bulk operation start mutation.', body, { statusCode, statusMessage }, headers)
    throw new Error('Missing `data.bulkOperationRunQuery` key in response from bulk operation start mutation.')
  }

  if (body.data.bulkOperationRunQuery?.userErrors.length) {
    ctx.logger.error('Received errors during bulk operation create mutation:')
    for (const error of body.data.bulkOperationRunQuery?.userErrors) {
      ctx.logger.error(error.message, error)
    }

    throw new Error(body.data.bulkOperationRunQuery.userErrors[0].message)
  }

  if (body.data.bulkOperationRunQuery?.bulkOperation?.status === BulkOperationStatus.Failed) {
    ctx.logger.error(`Bulk operation create mutation returned response: ${body.data.bulkOperationRunQuery.bulkOperation.status}`, body.data.bulkOperationRunQuery.bulkOperation)
    throw new Error('Failed to create bulk operation.')
  }

  if (!body.data.bulkOperationRunQuery?.bulkOperation?.id) {
    ctx.logger.error(`Bulk operation create mutation is missing an ID from the response.`, body.data.bulkOperationRunQuery.bulkOperation)
    throw new Error('Missing bulk operation ID from the returned response.')
  }

  ctx.logger.debug(`Successfully created bulk query with ID: ${body.data.bulkOperationRunQuery.bulkOperation.id}`, body.data.bulkOperationRunQuery.bulkOperation)

  return body.data.bulkOperationRunQuery.bulkOperation.id
}

async function waitForQuery(bulkOperationId: string, client: Got, interval: number = 20000, ctx: FunctionContext): Promise<string | undefined> {
  let downloadUrl: string | undefined

  await pWaitFor(async () => {
    ctx.logger.debug(`Checking bulk query status of operation ${bulkOperationId}`)

    const { body, headers, statusCode, statusMessage } = await client.post<GraphQLResponse<BulkStatusQueryType>>('graphql.json', {
      responseType: 'json',
      json: {
        query: BulkStatusQuery,
        variables: { id: bulkOperationId },
      },
    })

    if (body.errors?.length) {
      ctx.logger.error('Received errors during bulk status query:')
      for (const error of body.errors) {
        ctx.logger.error(error.message, error)
      }

      throw new Error(body.errors[0].message)
    }

    if (!body.data?.bulk) {
      ctx.logger.error('Missing `data.bulk` key in response from bulk operation status query.', body, { statusCode, statusMessage }, headers)
      throw new Error('Missing `data.bulk` key in response from bulk operation status query.')
    }

    if (body.data.bulk?.__typename !== 'BulkOperation') {
      ctx.logger.error(`__typename returned from the bulk operation status query was ${body.data.bulk.__typename}, NOT the expected 'BulkOperation'.`, data.bulk)
      throw new Error('Wrong typename returned from the bulk operation status query - this is likely a library error, so open an issue on GitHub.')
    }

    if (body.data.bulk.errorCode) {
      ctx.logger.error(`Bulk operation failed, with an error code of ${body.data.bulk.errorCode}`, body.data.bulk)
      throw new Error(`Bulk operation failed, with an error code of ${body.data.bulk.errorCode}`)
    }

    if (body.data.bulk.status === BulkOperationStatus.Completed) {
      if (Number(body.data.bulk.objectCount) === 0) {
        ctx.logger.debug(`The bulk operation completed, but no objects exist in this export (count of ${body.data.bulk.objectCount}).`, body.data.bulk)
        ctx.logger.info('No objects exist in this export - check your input query if this was not expected.')

        return true
      }

      ctx.logger.debug(`Found status of ${BulkOperationStatus.Completed}:`, body.data.bulk)

      downloadUrl = body.data.bulk.url
      return true
    }

    ctx.logger.debug(`Bulk query hasn't finished yet, waiting ${interval}ms.`, `Last status: ${body.data.bulk.status}, with object count of ${body.data.bulk.objectCount}`)

    return false
  }, { interval })

  if (downloadUrl) {
    ctx.logger.debug(`Bulk query has finished - download URL: ${downloadUrl}`)
  }
  else {
    ctx.logger.debug('Finished `waitFor`, but `downloadUrl` is nullish, so returning')
  }

  return downloadUrl
}

export type BaseResult<T> = T & {
  __parentId?: string
}

async function downloadData<T>(downloadUrl: string, ctx: FunctionContext): Promise<Array<BaseResult<T>>> {
  try {
    const rl = createInterface(got.stream(downloadUrl))

    const nodes: Array<BaseResult<T>> = []
    for await (const line of rl) {
    // Shopify seems to add a newline at the bottom of the file now, so check for that
      if (line) {
        const data = JSON.parse(line)
        nodes.push(data)
      }
    }

    ctx.logger.debug('Finished downloading and parsing JSONL file')

    return nodes
  }
  catch (err) {
    const error = err as Error
    ctx.logger.error(`Failed to download or parse JSONL data:`)
    ctx.logger.error(error)

    throw error
  }
}

/**
 * Accepts a store and query, and returns an array of results once the export has finished.
 *
 * You can pass in possible return types if needed, as single or union type:
 * @example
 * type Result = { id: `gid://shopify/Product/${number}`, title: string } | { id: `gid://shopify/ProductVariant/${number}`, displayName: string }
 *
 * const nodes = await run<Result>() // Result[]
 *
 * TODO: Update this to properly support returning types from the TypedDocumentNode
 */
async function run<T = unknown>(input: PluginInput): Promise<Array<BaseResult<T>>> {
  assert(typeof input === 'object', 'Missing input')
  assert(input.store.name, 'Missing store name input - `input.store.name`')
  assert(input.store.accessToken, 'Missing store accessToken input - `input.store.accessToken`')
  assert(input.query, 'Missing input query - `input.query`')
  if (input.variables) {
    assert(typeof input.variables === 'object', '`variables` should be an object, matching type Record<string, unknown>')
  }

  const { store } = input

  const logger = typeof input.logs === 'object'
    ? input.logs
    : createConsola({
      defaults: {
        tag: 'shopify-export-data',
        level: typeof input.logs === 'string'
          ? Reflect.get(ConsolaLogLevels, input.logs)
          : input.logs
            ? ConsolaLogLevels.debug
            : ConsolaLogLevels.silent,
      },
    })

  const ctx: FunctionContext = { logger }

  logger.debug('Initiating cache')
  const cache = await createCache(input.cache, ctx)

  const cachedResults = await cache.get<T>(input)
  if (cachedResults) {
    logger.debug('We have a cached result, returning')
    return cachedResults
  }

  logger.debug(`Creating client with name ${store.name}`)

  const client = got.extend({
    prefixUrl: `https://${store.name}.myshopify.com/admin/api/${store.apiVersion ?? DEFAULT_API_VERSION}`,
    headers: {
      'x-shopify-access-token': store.accessToken,
    },
    resolveBodyOnly: true,
    responseType: 'json',
  })

  logger.debug('Formatting bulk query input')

  const formattedQuery = replaceQueryVariables(input.query, input.variables, ctx)

  logger.debug('Starting bulk query mutation')

  const bulkOperationId = await startBulkQuery(formattedQuery, client, ctx)

  logger.debug('Waiting for bulk query to finish')

  const bulkDownloadUrl = await waitForQuery(bulkOperationId, client, input.interval, ctx)
  if (!bulkDownloadUrl) {
    logger.debug(`\`bulkDownloadUrl\` was null (from \`waitForQuery\`), so returning empty array.`, { bulkDownloadUrl })
    return []
  }

  logger.debug('Downloading and parsing bulk query data')

  const nodes = await downloadData<T>(bulkDownloadUrl, ctx)

  logger.debug('Finished downloading, adding to cache')

  await cache.put(input, nodes)

  logger.debug(`Finished, with ${nodes.length} nodes`)

  return nodes
}

export default run
