import type { Got } from 'got'
import pWaitFor from 'p-wait-for'
import type { FunctionContext } from '../types/context'
import { BulkOperationStatus, BulkStatusQuery, type BulkStatusQueryType, type GraphQLResponse } from '../types/bulk-queries'

/**
 * Uses promises to pause execution, and wait until an operation has finished -
 * either by completing successfully, or from an error. If it completes successfully,
 * it returns the URL to download the JSONL file of results.
 */
export async function waitForQuery(bulkOperationId: string, client: Got, interval: number = 20000, ctx: FunctionContext): Promise<string | undefined> {
  let downloadUrl: string | undefined

  await pWaitFor(async () => {
    ctx.logger.debug(`Checking bulk query status of operation ${bulkOperationId}`)

    const { body, headers, statusCode, statusMessage } = await client.post<GraphQLResponse<BulkStatusQueryType>>('graphql.json', {
      resolveBodyOnly: false,
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
      ctx.logger.error(`__typename returned from the bulk operation status query was ${body.data.bulk.__typename}, NOT the expected 'BulkOperation'.`, body.data.bulk)
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
