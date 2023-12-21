export interface GraphQLResponse<Query> {
  data: Query
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
    __typename: 'App'
  } | { __typename: 'AppCredit' } | { __typename: 'AppInstallation' } | { __typename: 'AppPurchaseOneTime' } | { __typename: 'AppRevenueAttributionRecord' } | { __typename: 'AppSubscription' } | { __typename: 'AppUsageRecord' } | { __typename: 'BasicEvent' } | { __typename: 'BulkOperation', id: string, status: BulkOperationStatus, errorCode?: BulkOperationErrorCode | null, createdAt: any, completedAt?: any | null, objectCount: any, fileSize?: any | null, url?: any | null, partialDataUrl?: any | null } | { __typename: 'CalculatedOrder' } | { __typename: 'Channel' } | { __typename: 'ChannelDefinition' } | { __typename: 'ChannelInformation' } | { __typename: 'CheckoutProfile' } | { __typename: 'Collection' } | { __typename: 'CommentEvent' } | { __typename: 'Company' } | { __typename: 'CompanyAddress' } | { __typename: 'CompanyContact' } | { __typename: 'CompanyContactRole' } | { __typename: 'CompanyContactRoleAssignment' } | { __typename: 'CompanyLocation' } | { __typename: 'Customer' } | { __typename: 'CustomerPaymentMethod' } | { __typename: 'CustomerVisit' } | { __typename: 'DeliveryCarrierService' } | { __typename: 'DeliveryCondition' } | { __typename: 'DeliveryCountry' } | { __typename: 'DeliveryLocationGroup' } | { __typename: 'DeliveryMethod' } | { __typename: 'DeliveryMethodDefinition' } | { __typename: 'DeliveryParticipant' } | { __typename: 'DeliveryProfile' } | { __typename: 'DeliveryProfileItem' } | { __typename: 'DeliveryProvince' } | { __typename: 'DeliveryRateDefinition' } | { __typename: 'DeliveryZone' } | { __typename: 'DiscountAutomaticBxgy' } | { __typename: 'DiscountAutomaticNode' } | { __typename: 'DiscountCodeNode' } | { __typename: 'DiscountNode' } | { __typename: 'DiscountRedeemCodeBulkCreation' } | { __typename: 'Domain' } | { __typename: 'DraftOrder' } | { __typename: 'DraftOrderLineItem' } | { __typename: 'DraftOrderTag' } | { __typename: 'Duty' } | { __typename: 'ExternalVideo' } | { __typename: 'Fulfillment' } | { __typename: 'FulfillmentEvent' } | { __typename: 'FulfillmentLineItem' } | { __typename: 'FulfillmentOrder' } | { __typename: 'FulfillmentOrderDestination' } | { __typename: 'FulfillmentOrderLineItem' } | { __typename: 'FulfillmentOrderMerchantRequest' } | { __typename: 'GenericFile' } | { __typename: 'GiftCard' } | { __typename: 'InventoryItem' } | { __typename: 'InventoryLevel' } | { __typename: 'LineItem' } | { __typename: 'LineItemMutable' } | { __typename: 'Location' } | { __typename: 'MailingAddress' } | { __typename: 'Market' } | { __typename: 'MarketRegionCountry' } | { __typename: 'MarketWebPresence' } | { __typename: 'MarketingActivity' } | { __typename: 'MarketingEvent' } | { __typename: 'MediaImage' } | { __typename: 'Metafield' } | { __typename: 'MetafieldDefinition' } | { __typename: 'MetafieldStorefrontVisibility' } | { __typename: 'Model3d' } | { __typename: 'OnlineStoreArticle' } | { __typename: 'OnlineStoreBlog' } | { __typename: 'OnlineStorePage' } | { __typename: 'Order' } | { __typename: 'OrderDisputeSummary' } | { __typename: 'OrderTransaction' } | { __typename: 'PaymentMandate' } | { __typename: 'PaymentSchedule' } | { __typename: 'PaymentTerms' } | { __typename: 'PaymentTermsTemplate' } | { __typename: 'PriceList' } | { __typename: 'PriceRule' } | { __typename: 'PriceRuleDiscountCode' } | { __typename: 'PrivateMetafield' } | { __typename: 'Product' } | { __typename: 'ProductOption' } | { __typename: 'ProductTaxonomyNode' } | { __typename: 'ProductVariant' } | { __typename: 'Publication' } | { __typename: 'Refund' } | { __typename: 'SavedSearch' } | { __typename: 'ScriptTag' } | { __typename: 'Segment' } | { __typename: 'SellingPlan' } | { __typename: 'SellingPlanGroup' } | { __typename: 'Shop' } | { __typename: 'ShopPolicy' } | { __typename: 'ShopifyPaymentsAccount' } | { __typename: 'ShopifyPaymentsBankAccount' } | { __typename: 'ShopifyPaymentsDispute' } | { __typename: 'ShopifyPaymentsDisputeEvidence' } | { __typename: 'ShopifyPaymentsDisputeFileUpload' } | { __typename: 'ShopifyPaymentsDisputeFulfillment' } | { __typename: 'ShopifyPaymentsPayout' } | { __typename: 'ShopifyPaymentsVerification' } | { __typename: 'StaffMember' } | { __typename: 'StandardMetafieldDefinitionTemplate' } | { __typename: 'StorefrontAccessToken' } | { __typename: 'SubscriptionBillingAttempt' } | { __typename: 'SubscriptionContract' } | { __typename: 'SubscriptionDraft' } | { __typename: 'TenderTransaction' } | { __typename: 'TransactionFee' } | { __typename: 'UrlRedirect' } | { __typename: 'UrlRedirectImport' } | { __typename: 'Video' } | { __typename: 'WebPixel' } | { __typename: 'WebhookSubscription' } | null
}
