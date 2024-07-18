interface Error {
  message: string
  path?: string[]
  extensions?: object
}

export interface GraphQLResponse<Query> {
  data?: Query
  errors?: Error[]
}

export const StartBulkQuery = `mutation StartBulkQuery ($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}`

/** The valid values for the status of a bulk operation. */
export enum BulkOperationStatus {
  /** The bulk operation has been canceled. */
  Canceled = 'CANCELED',
  /**
   * Cancelation has been initiated on the bulk operation. There may be a short delay from when a cancelation
   * starts until the operation is actually canceled.
   *
   */
  Canceling = 'CANCELING',
  /** The bulk operation has successfully completed. */
  Completed = 'COMPLETED',
  /** The bulk operation has been created. */
  Created = 'CREATED',
  /** The bulk operation URL has expired. */
  Expired = 'EXPIRED',
  /**
   * The bulk operation has failed. For information on why the operation failed, use
   * [BulkOperation.errorCode](https://shopify.dev/api/admin-graphql/latest/enums/bulkoperationerrorcode).
   *
   */
  Failed = 'FAILED',
  /** The bulk operation is runnning. */
  Running = 'RUNNING',
}

/** Error codes for failed bulk operations. */
export enum BulkOperationErrorCode {
  /**
   * The provided operation `query` returned access denied due to missing
   * [access scopes](https://shopify.dev/api/usage/access-scopes).
   * Review the requested object permissions and execute the query as a normal non-bulk GraphQL request to see more details.
   *
   */
  AccessDenied = 'ACCESS_DENIED',
  /**
   * The operation resulted in partial or incomplete data due to internal server errors during execution.
   * These errors might be intermittent, so you can try performing the same query again.
   *
   */
  InternalServerError = 'INTERNAL_SERVER_ERROR',
  /**
   * The operation resulted in partial or incomplete data due to query timeouts during execution.
   * In some cases, timeouts can be avoided by modifying your `query` to select fewer fields.
   *
   */
  Timeout = 'TIMEOUT',
}

export interface StartBulkQueryType {
  __typename?: 'Mutation'
  bulkOperationRunQuery?: {
    __typename?: 'BulkOperationRunQueryPayload'
    bulkOperation?: {
      __typename?: 'BulkOperation'
      id: string
      status: BulkOperationStatus
    } | null
    userErrors: Array<{ __typename?: 'UserError', field?: string[] | null, message: string }>
  } | null
}

export const BulkStatusQuery = `query BulkStatus ($id: ID!) {
  bulk: node (id: $id) {
    __typename
    ... on BulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
}`

export interface BulkStatusQueryType {
  __typename?: 'QueryRoot'
  bulk?: {
    __typename: 'BulkOperation'
    id: string
    status: BulkOperationStatus
    errorCode?: BulkOperationErrorCode | null
    createdAt: any
    completedAt?: any | null
    objectCount: any
    fileSize?: any | null
    url?: any | null
    partialDataUrl?: any | null
  } | null
}
