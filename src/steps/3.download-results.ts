import { createInterface } from 'node:readline'
import got from 'got'
import type { FunctionContext } from '../types/context'
import type { BaseResult } from '../types/results'

/**
 * Accepts a URL to a JSONL file, and then downloads + parses it.
 * It returns an array of nodes.
 */
export async function downloadData<T>(downloadUrl: string, ctx: FunctionContext): Promise<Array<BaseResult<T>>> {
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
