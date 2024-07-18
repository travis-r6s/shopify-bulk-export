import type { Got } from 'got'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { parse, print, visit } from 'graphql'
import { BulkOperationStatus, type GraphQLResponse, StartBulkQuery, type StartBulkQueryType } from '../types/bulk-queries'
import type { FunctionContext } from '../types/context'

/**
 * Accepts a query + variables, and replaces any variable references in the query with
 * the provided values.
 */
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

/**
 * Creates a new bulk operation, and returns the GID of the created operation.
 */
export async function startBulkQuery(query: string, client: Got, ctx: FunctionContext): Promise<string> {
  const { body, headers, statusCode, statusMessage } = await client.post<GraphQLResponse<StartBulkQueryType>>('graphql.json', {
    resolveBodyOnly: false,
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
