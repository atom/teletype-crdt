const ContextVector = require('./context-vector')
const ContextDifference = require('./context-difference')
const assert = require('assert')
const inclusionTransform = require('./inclusion-transform')
const operationHelpers = require('./operation-helpers')

let nextOpId = 1

module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.documentState = new ContextVector()
    this.versionGroupsById = new Map()
    this.operations = []
    this.operationIndicesById = new Map()
  }

  copy (newSiteId) {
    const newReplica = Object.create(DocumentReplica.prototype)
    newReplica.siteId = newSiteId
    newReplica.documentState = this.documentState.copy()
    newReplica.versionGroupsById = new Map()
    newReplica.operations = this.operations.slice()
    newReplica.operationIndicesById = new Map(this.operationIndicesById)
    return newReplica
  }

  pushLocal (operation) {
    const localOperation = operationHelpers.copy(operation)
    localOperation.siteId = this.siteId
    localOperation.sequenceNumber = this.documentState.sequenceNumberForSiteId(this.siteId) + 1
    localOperation.inverseCount = 0
    localOperation.contextVector = this.documentState.copy()
    localOperation.debugId = nextOpId++
    operation.debugId = localOperation.debugId
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return operationHelpers.copy(localOperation)
  }

  undoLocal (operation) {
    const localOperation = operationHelpers.invert(operation)
    localOperation.debugId = nextOpId++
    localOperation.inverseCount++
    localOperation.contextVector.add(operation)
    const contextDifference = this.contextDifference(this.documentState, localOperation.contextVector)
    const operationToApply = this.transform(localOperation, contextDifference)
    this.documentState.add(localOperation)
    this.appendOperation(localOperation)
    return {operationToSend: localOperation, operationToApply}
  }

  pushRemote (remoteOperation) {
    const contextDifference = this.contextDifference(this.documentState, remoteOperation.contextVector)

    if (remoteOperation.debugId == 3 && this.siteId == 1) {
      global.debugIndentLevel = 0
      global.debug = true
      debugger
    }
    const localOperation = this.transform(remoteOperation, contextDifference, remoteOperation.debugId === 2)
    global.debug = false
    this.appendOperation(remoteOperation)
    this.documentState.add(remoteOperation)
    return localOperation

  }

  appendOperation (operation) {
    this.operationIndicesById.set(operationHelpers.getId(operation), this.operations.length)
    this.operations.push(operation)
  }

  transform (operation, contextDifference) {
    if (contextDifference.isEmpty()) return operationHelpers.copy(operation)

    if (global.debug) global.debugIndentLevel++

    const indent = '  '.repeat(global.debugIndentLevel)
    let transformString
    if (global.debug) {
      transformString = `transform O${operation.debugId}, CD=(${contextDifference.getOperations().map(o => 'O' + o.debugId).join(', ')})`
      console.log(indent + '>>> ' + transformString)
    }

    this.ensureIP2Safety(contextDifference)
    operation = this.ensureIP3Safety(operation, contextDifference)
    const contextDifferenceOperations = contextDifference.getOperations()
    while (contextDifferenceOperations.length > 0) {
      let ox = contextDifferenceOperations.shift()
      const undoPair = contextDifference.getUndoPair(ox)
      if (undoPair) {
        operation = operationHelpers.copy(operation)
        operation.contextVector.add(ox)
        operation.contextVector.add(undoPair)
      } else {
        let cachedTransformedOperation = this.getFromVersionGroup(ox, operation.contextVector)
        if (cachedTransformedOperation) {
          ox = operationHelpers.copy(cachedTransformedOperation)
        } else {
          const targetContextDifference = this.contextDifference(operation.contextVector, ox.contextVector)
          ox = this.transform(ox, targetContextDifference)
        }
        operation = this.inclusionTransform(operation, ox)
      }
    }

    if (global.debug) {
      // console.log(indent + '<<< ' + transformString)
    }

    if (global.debug) global.debugIndentLevel--

    return operationHelpers.copy(operation)
  }

  inclusionTransform (o1, o2) {
    assert(o1.contextVector.equals(o2.contextVector), 'contexts must be equal')

    const o1B = inclusionTransform(o1, o2)

    if (global.debug) {
      const indent = '  '.repeat(global.debugIndentLevel + 1)
      console.log(`${indent}${this.siteId}: IT(${operationHelpers.format(o1)}, ${operationHelpers.format(o2)}) = ${operationHelpers.format(o1B)}`);
    }

    o1B.siteId = o1.siteId
    o1B.sequenceNumber = o1.sequenceNumber
    o1B.inverseCount = o1.inverseCount
    o1B.contextVector = o1.contextVector.copy()
    o1B.contextVector.add(o2)
    const o2B = inclusionTransform(o2, o1)
    o2B.siteId = o2.siteId
    o2B.sequenceNumber = o2.sequenceNumber
    o2B.inverseCount = o2.inverseCount
    o2B.contextVector = o2.contextVector.copy()
    o2B.contextVector.add(o1)
    this.addToVersionGroup(o1B)
    this.addToVersionGroup(o2B)
    return operationHelpers.copy(o1B)
  }

  addToVersionGroup (operation) {
    const operationId = operationHelpers.getId(operation)
    let versions = this.versionGroupsById.get(operationId)
    if (versions == null) {
      versions = []
      this.versionGroupsById.set(operationId, versions)
    }

    versions.push(operation)
    if (versions.length === this.documentState.getSiteCount() - 1) {
      versions.shift()
    }
  }

  getFromVersionGroup (operation, contextVector) {
    return
    const versions = this.versionGroupsById.get(operationHelpers.getId(operation))
    if (versions) {
      for (let i = versions.length - 1; i >= 0; i--) {
        if (versions[i].contextVector.equals(contextVector)) {
          return versions[i]
        }
      }
    }
  }

  contextDifference (contextVector1, contextVector2) {
    const diff = new ContextDifference()
    const siteCount = Math.max(contextVector1.getSiteCount(), contextVector2.getSiteCount())
    for (let siteId = 0; siteId < siteCount; siteId++) {
      const startSequenceNumber = contextVector2.sequenceNumberForSiteId(siteId)
      const endSequenceNumber = contextVector1.sequenceNumberForSiteId(siteId)
      assert(startSequenceNumber <= endSequenceNumber, 'Causality Violation')
      for (let sequenceNumber = startSequenceNumber + 1; sequenceNumber <= endSequenceNumber; sequenceNumber++) {
        const operationId = operationHelpers.buildId(siteId, sequenceNumber, 0)
        const operationIndex = this.operationIndicesById.get(operationId)
        const operation = this.operations[operationIndex]
        diff.add(operation, operationIndex)
      }
      for (let sequenceNumber in contextVector1.inverseGroups[siteId]) {
        const startInverseCount = contextVector2.inverseCountForSiteIdAndSequenceNumber(siteId, sequenceNumber)
        const endInverseCount = contextVector1.inverseGroups[siteId][sequenceNumber]
        assert(startInverseCount <= endInverseCount, 'Causality Violation')
        for (let inverseCount = startInverseCount + 1; inverseCount <= endInverseCount; inverseCount++) {
          const operationId = operationHelpers.buildId(siteId, sequenceNumber, inverseCount)
          const operationIndex = this.operationIndicesById.get(operationId)
          const operation = this.operations[operationIndex]
          diff.add(operation, operationIndex)
        }
      }
    }

    return diff
  }

  ensureIP2Safety (contextDifference) {
    if (global.debug) debugger
    const operations = contextDifference.getOperations()
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      if (contextDifference.getDoPair(operation)) continue

      const inverseOperation = operationHelpers.invert(operation)
      inverseOperation.inverseCount++
      inverseOperation.contextVector.add(operation)
      if (contextDifference.has(inverseOperation)) {
        contextDifference.markDoUndoPair(operation, inverseOperation)
        contextDifference.remove(inverseOperation)
      }
    }
  }

  ensureIP3Safety (invertedOperation, contextDifference) {
    if (invertedOperation.inverseCount === 0) return invertedOperation

    // if (this.siteId === 0) debugger
    const uninvertedOperation = operationHelpers.invert(invertedOperation)
    uninvertedOperation.inverseCount--
    uninvertedOperation.contextVector.remove(uninvertedOperation)

    const contextDifferenceOperations = contextDifference.getOperations()
    const concurrentContextDifference = new ContextDifference()
    for (let i = 0; i < contextDifferenceOperations.length; i++) {
      const contextDifferenceOperation = contextDifferenceOperations[i]
      if (operationHelpers.areConcurrent(uninvertedOperation, contextDifferenceOperation)) {
        const operationId = operationHelpers.getId(contextDifferenceOperation)
        const operationIndex = this.operationIndicesById.get(operationId)
        const undoPair = contextDifference.getUndoPair(contextDifferenceOperation)
        concurrentContextDifference.add(contextDifferenceOperation, operationIndex)
        if (undoPair) concurrentContextDifference.markDoUndoPair(contextDifferenceOperation, undoPair)

        contextDifference.remove(contextDifferenceOperation)
      }
    }

    if (global.debug && !concurrentContextDifference.isEmpty()) {
      console.log('  '.repeat(global.debugIndentLevel) + '>> ensureIP3Safety');
    }
    const transformedOperation = operationHelpers.invert(
      this.transform(uninvertedOperation, concurrentContextDifference)
    )
    if (global.debug && !concurrentContextDifference.isEmpty()) {
      console.log('  '.repeat(global.debugIndentLevel) + '<< ensureIP3Safety');
    }

    transformedOperation.contextVector.add(uninvertedOperation)
    transformedOperation.inverseCount++
    return transformedOperation
  }
}
