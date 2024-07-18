import assert from 'node:assert'
import { LogLevels as ConsolaLogLevels, createConsola } from 'consola'
import got from 'got'
import { createCache } from '../cache'
import { DEFAULT_API_VERSION } from '../consts'
import { waitForQuery } from '../steps/2.query-status'
import { downloadData } from '../steps/3.download-results'
import type { BaseResult } from '../types/results'
import type { BaseInput } from '../types/input'
import type { FunctionContext } from '../types/context'

export interface ResumeExportInput extends BaseInput {
  /**
   * The Shopify GID for the bulk operation you want to resume exporting.
   *
   * @example 'gid://shopify/BulkOperation/1234'
   */
  operationId: string
}

/**
 * This is similar to the `runBulkExport` function, but instead accepts a bulk operation ID, and skips
 * creating a bulk query.
 *
 * This is useful for when something caused the export function or your script to crash before the bulk operation finished,
 * so you can then use this function to resume the export process, instead of needing to wait for the previous operation
 * to finish, and then create a new one.
 */
export async function resumeBulkExport<T = unknown>(input: ResumeExportInput): Promise<Array<BaseResult<T>>> {
  assert(typeof input === 'object', 'Missing input')
  assert(input.store.name, 'Missing store name input - `input.store.name`')
  assert(input.store.accessToken, 'Missing store accessToken input - `input.store.accessToken`')
  assert(input.operationId, 'Missing input query - `input.query`')

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

  logger.debug(`Resuming export for bulk operation ${input.operationId}`)

  logger.debug('Waiting for bulk query to finish')

  const bulkDownloadUrl = await waitForQuery(input.operationId, client, input.interval, ctx)
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
