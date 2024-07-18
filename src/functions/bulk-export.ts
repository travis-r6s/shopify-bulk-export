import assert from 'node:assert'
import { LogLevels as ConsolaLogLevels, createConsola } from 'consola'
import got from 'got'
import { createCache } from '../cache'
import { DEFAULT_API_VERSION } from '../consts'
import { replaceQueryVariables, startBulkQuery } from '../steps/1.create-operation'
import { waitForQuery } from '../steps/2.query-status'
import { downloadData } from '../steps/3.download-results'
import type { BaseResult } from '../types/results'
import type { BaseInput } from '../types/input'
import type { FunctionContext } from '../types/context'

export interface RunBulkExportInput extends BaseInput {
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
export async function runBulkExport<T = unknown>(input: RunBulkExportInput): Promise<Array<BaseResult<T>>> {
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
