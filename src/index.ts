import assert from 'node:assert'
import got, { type Got } from 'got'
import pWaitFor from 'p-wait-for'
import { createInterface } from 'node:readline'
import { type GraphQLResponse, StartBulkQuery, type StartBulkQueryType, BulkOperationStatus, BulkStatusQuery, type BulkStatusQueryType } from './bulk-queries'

export interface StoreInput {
  /** The name of the shopify store, without the shopify domain @example https://<mystore>.myshopify.com -> mystore */
  name: string
  /** The Shopify store access token */
  accessToken: string
  /** The API version to use @default `2022-10` */
  apiVersion?: string
}

export interface Input {
  /** Configuration for the store */
  store: StoreInput
  /** The query to run as a bulk query, as a string */
  query: string
  /** The interval between query status checks, in milliseconds. @default 20000 (20 seconds) */
  interval?: number
}

const DEFAULT_API_VERSION = '2022-10'

async function startBulkQuery (query: string, client: Got): Promise<string> {
  const { data } = await client.post<GraphQLResponse<StartBulkQueryType>>('graphql.json', {
    json: { query: StartBulkQuery, variables: { query } },
    resolveBodyOnly: true,
    responseType: 'json'
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

  return data.bulkOperationRunQuery.bulkOperation.id
}

async function waitForQuery (bulkOperationId: string, client: Got, interval: number = 20000): Promise<string> {
  return await pWaitFor(async () => {
    const { data } = await client.post<GraphQLResponse<BulkStatusQueryType>>('graphql.json', {
      resolveBodyOnly: true,
      responseType: 'json',
      json: { query: BulkStatusQuery, variables: { id: bulkOperationId } }
    })

    if (data.bulk?.__typename !== 'BulkOperation') throw new Error('Wrong type!')

    if (data.bulk.errorCode) throw new Error(data.bulk.errorCode)

    if (data.bulk.status === BulkOperationStatus.Completed) {
      if (Number(data.bulk.objectCount) === 0) throw new Error('No objects exist in this export.')

      return data.bulk.url
    }

    return false
  }, { interval })
}

async function downloadData <T = unknown> (downloadUrl: string): Promise<T[]> {
  const rl = createInterface(got.stream(downloadUrl))

  const data: T[] = []
  for await (const line of rl) {
    const data = JSON.parse(line)
    data.push(data)
  }

  return data
}

/**
 * Accepts a store and query, and returns an array of results once the export has finished.
 *
 * You can pass in possible return types if needed, as single or union type:
 * @example
 * type Result = { id: `gid://shopify/Product/${number}`, title: string } | { id: `gid://shopify/ProductVariant/${number}`, displayName: string }
 *
 * const nodes = await run<Result>() // Result[]
 * */
async function run <T = unknown> (input: Input): Promise<T[]> {
  assert(input.store.name, 'Missing store name input - `input.store.name`')
  assert(input.store.accessToken, 'Missing store accessToken input - `input.store.accessToken`')
  assert(input.query, 'Missing input query - `input.query`')

  const { store } = input

  const client = got.extend({
    prefixUrl: `https://${store.name}.myshopify.com/admin/api/${store.apiVersion ?? DEFAULT_API_VERSION}`,
    headers: {
      'x-shopify-access-token': store.accessToken
    },
    resolveBodyOnly: true,
    responseType: 'json'
  })

  const bulkOperationId = await startBulkQuery(input.query, client)

  const bulkDownloadUrl = await waitForQuery(bulkOperationId, client, input.interval)

  const nodes = await downloadData<T>(bulkDownloadUrl)

  return nodes
}

export default run
