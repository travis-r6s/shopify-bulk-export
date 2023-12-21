import assert from 'node:assert'
import { createInterface } from 'node:readline'
import consola, { LogLevels } from 'consola'
import got, { type Got } from 'got'
import pWaitFor from 'p-wait-for'
import { parse, print, visit } from 'graphql'
import { BulkOperationStatus, BulkStatusQuery, type BulkStatusQueryType, type GraphQLResponse, StartBulkQuery, type StartBulkQueryType } from './bulk-queries'

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
  /** Optional runtime variables to inject into the query */
  variables?: Record<string, unknown>
  /** The interval between query status checks, in milliseconds. @default 20000 (20 seconds) */
  interval?: number
  /** Choose whether to log progress to console */
  logs?: boolean | typeof console
}

const DEFAULT_API_VERSION = '2023-10'

export function replaceQueryVariables(query: string, variables?: Record<string, unknown>): string {
  if (!variables)
    return query

  const ast = parse(query)

  const editedAST = visit(ast, {
    Variable(node, key) {
      if (key !== 'value')
        return

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

  return print(editedAST)
}

async function startBulkQuery(query: string, client: Got): Promise<string> {
  const { data } = await client.post<GraphQLResponse<StartBulkQueryType>>('graphql.json', {
    json: { query: StartBulkQuery, variables: { query } },
    resolveBodyOnly: true,
    responseType: 'json',
  })

  if (data.bulkOperationRunQuery?.userErrors.length)
    throw new Error(data.bulkOperationRunQuery.userErrors[0].message)

  if (data.bulkOperationRunQuery?.bulkOperation?.status === BulkOperationStatus.Failed)
    throw new Error('Failed to create bulk operation.')

  if (!data.bulkOperationRunQuery?.bulkOperation?.id)
    throw new Error('Missing buk operation ID.')

  return data.bulkOperationRunQuery.bulkOperation.id
}

async function waitForQuery(bulkOperationId: string, client: Got, interval: number = 20000): Promise<string> {
  let downloadUrl = ''

  await pWaitFor(async () => {
    const { data } = await client.post<GraphQLResponse<BulkStatusQueryType>>('graphql.json', {
      resolveBodyOnly: true,
      responseType: 'json',
      json: { query: BulkStatusQuery, variables: { id: bulkOperationId } },
    })

    if (data.bulk?.__typename !== 'BulkOperation')
      throw new Error('Wrong type!')

    if (data.bulk.errorCode)
      throw new Error(data.bulk.errorCode)

    if (data.bulk.status === BulkOperationStatus.Completed) {
      if (Number(data.bulk.objectCount) === 0)
        throw new Error('No objects exist in this export.')

      downloadUrl = data.bulk.url
      return true
    }

    return false
  }, { interval })

  return downloadUrl
}

type BaseResult<T> = T & {
  __parentId?: string
}

async function downloadData<T>(downloadUrl: string): Promise<Array<BaseResult<T>>> {
  const rl = createInterface(got.stream(downloadUrl))

  const nodes: Array<BaseResult<T>> = []
  for await (const line of rl) {
    const data = JSON.parse(line)
    nodes.push(data)
  }

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
 */
async function run<T = unknown>(input: Input): Promise<Array<BaseResult<T>>> {
  assert(typeof input === 'object', 'Missing input')
  assert(input.store.name, 'Missing store name input - `input.store.name`')
  assert(input.store.accessToken, 'Missing store accessToken input - `input.store.accessToken`')
  assert(input.query, 'Missing input query - `input.query`')
  if (input.variables)
    assert(typeof input.variables === 'object', '`variables` should be an object, matching type Record<string, unknown>')

  const { store } = input

  const logger = typeof input.logs === 'object' ? input.logs : consola.withDefaults({
    tag: 'shopify-export-data',
    level: input.logs ? LogLevels.debug : LogLevels.silent,
  })

  logger.debug(`Creating client with name ${store.name}`)

  const client = got.extend({
    prefixUrl: `https://${store.name}.myshopify.com/admin/api/${store.apiVersion ?? DEFAULT_API_VERSION}`,
    headers: {
      'x-shopify-access-token': store.accessToken,
    },
    resolveBodyOnly: true,
    responseType: 'json',
  })

  logger.debug('Starting bulk query mutation')

  const formattedQuery = replaceQueryVariables(input.query, input.variables)

  const bulkOperationId = await startBulkQuery(formattedQuery, client)

  logger.debug('Waiting for bulk query to finish')

  const bulkDownloadUrl = await waitForQuery(bulkOperationId, client, input.interval)

  logger.debug('Downloading and parsing bulk query data')

  const nodes = await downloadData<T>(bulkDownloadUrl)

  logger.debug(`Finished, with ${nodes.length} nodes`)

  return nodes
}

export default run
