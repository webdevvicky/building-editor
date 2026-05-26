// Operations module barrel — single import path for the dispatcher,
// registry, types, and transactions API.

export { OP_KIND, OP_KINDS_ORDERED, OP_AUTHOR, isValidOpKind, buildOp, withInverse } from './types.js'
export { OPERATIONS, KIND_BY_TYPE, getOperation, listOperationTypes } from './registry.js'
export { dispatch, transaction, OperationError, _inspectTransactionState } from './dispatch.js'
export { SCHEMA_VERSION } from './_schemaVersion.js'
