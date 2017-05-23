const operationHelpers = require('./operation-helpers')

module.exports =
class ContextDifference {
  constructor () {
    this.operationsByIndex = new Map()
    this.indicesByOperationId = new Map()
    this.operationsById = new Map()
    this.doPairsByOperationId = new Map()
    this.undoPairsByOperationId = new Map()
  }

  isEmpty () {
    return this.operationsById.size === 0
  }

  add (operation, index) {
    const operationId = operationHelpers.getId(operation)
    this.operationsByIndex.set(index, operation)
    this.indicesByOperationId.set(operationId, index)
    this.operationsById.set(operationId, operation)
  }

  has (operation) {
    return this.operationsById.has(operationHelpers.getId(operation))
  }

  remove (operation) {
    const operationId = operationHelpers.getId(operation)
    const operationIndex = this.indicesByOperationId.get(operationId)
    this.operationsByIndex.delete(operationIndex)
    this.indicesByOperationId.delete(operationId)
    this.operationsById.delete(operationId)
    this.doPairsByOperationId.delete(operationId)
    this.undoPairsByOperationId.delete(operationId)
  }

  markDoUndoPair (doOperation, undoOperation) {
    const doOperationId = operationHelpers.getId(doOperation)
    const undoOperationId = operationHelpers.getId(undoOperation)
    this.undoPairsByOperationId.set(doOperationId, undoOperation)
    this.doPairsByOperationId.set(undoOperationId, doOperation)
  }

  getUndoPair (operation) {
    const operationId = operationHelpers.getId(operation)
    return this.undoPairsByOperationId.get(operationId)
  }

  getDoPair (operation) {
    const operationId = operationHelpers.getId(operation)
    return this.doPairsByOperationId.get(operationId)
  }

  getOperations () {
    const operations = Array.from(this.operationsByIndex)
    operations.sort(([index1], [index2]) => index1 - index2)
    return operations.map(([index, operation]) => operation)
  }
}
