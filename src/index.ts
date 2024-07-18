import assert from 'node:assert'
import { createInterface } from 'node:readline'
import consola, { LogLevels } from 'consola'
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

export type BaseLogger = Pick<Console, 'debug' | 'log' | 'info' | 'error'>

export interface PluginInput {
  /** Configuration for the store */
  store: StoreInput
  /** The query to run as a bulk query, as a string, or a TypedDocumentNode to get a fully-typed result */
  query: string | TypedDocumentNode
  /** Optional runtime variables to inject into the query */
  variables?: Record<string, unknown>
  /** The interval between query status checks, in milliseconds. @default 20000 (20 seconds) */
  interval?: number
  /** Choose whether to log progress to console. You can also provide your own logger, if needed. */
  logs?: boolean | BaseLogger
  /**
   * Configure the cache functionality - enabled by default,
   * this will save JSONL results to a cache directory in your project,
   * and load them on subsequent requests if the current input matches a previous result.
   *
   * You can pass a folder name if you want to change the cache directory name.
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
  const { data } = await client.post<GraphQLResponse<StartBulkQueryType>>('graphql.json', {
    json: { query: StartBulkQuery, variables: { query } },
    resolveBodyOnly: true,
    responseType: 'json',
  })

  if (data.bulkOperationRunQuery?.userErrors.length) {
    throw new Error(data.bulkOperationRunQuery.userErrors[0].message)
  }

  if (data.bulkOperationRunQuery?.bulkOperation?.status === BulkOperationStatus.Failed) {
    throw new Error('Failed to create bulk operation.')
  }

  if (!data.bulkOperationRunQuery?.bulkOperation?.id) {
    throw new Error('Missing buk operation ID.')
  }

  ctx.logger.debug(`Successfully created bulk query with ID: ${data.bulkOperationRunQuery.bulkOperation.id}`)

  return data.bulkOperationRunQuery.bulkOperation.id
}

async function waitForQuery(bulkOperationId: string, client: Got, interval: number = 20000, ctx: FunctionContext): Promise<string> {
  let downloadUrl = ''

  await pWaitFor(async () => {
    ctx.logger.debug(`Checking bulk query status of operation ${bulkOperationId}`)

    const { data } = await client.post<GraphQLResponse<BulkStatusQueryType>>('graphql.json', {
      resolveBodyOnly: true,
      responseType: 'json',
      json: {
        query: BulkStatusQuery,
        variables: { id: bulkOperationId },
      },
    })

    if (data.bulk?.__typename !== 'BulkOperation') {
      throw new Error('Wrong type!')
    }

    if (data.bulk.errorCode) {
      throw new Error(data.bulk.errorCode)
    }

    if (data.bulk.status === BulkOperationStatus.Completed) {
      if (Number(data.bulk.objectCount) === 0) {
        throw new Error('No objects exist in this export.')
      }

      downloadUrl = data.bulk.url
      return true
    }

    ctx.logger.debug(`Bulk query hasn't finished yet, waiting ${interval}ms`)

    return false
  }, { interval })

  ctx.logger.debug(`Bulk query has finished - download URL: ${downloadUrl}`)

  return downloadUrl
}

export type BaseResult<T> = T & {
  __parentId?: string
}

async function downloadData<T>(downloadUrl: string, ctx: FunctionContext): Promise<Array<BaseResult<T>>> {
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
    : consola.withDefaults({
      tag: 'shopify-export-data',
      level: input.logs ? LogLevels.debug : LogLevels.silent,
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

  logger.debug('Downloading and parsing bulk query data')

  const nodes = await downloadData<T>(bulkDownloadUrl, ctx)

  logger.debug('Finished downloading, adding to cache')

  await cache.put(input, nodes)

  logger.debug(`Finished, with ${nodes.length} nodes`)

  return nodes
}

export default run
