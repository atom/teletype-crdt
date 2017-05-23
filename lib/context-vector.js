const assert = require('assert')

module.exports =
class ContextVector {
  constructor () {
    this.sequenceNumbers = []
  }

  isSubsetOf (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.sequenceNumberForSiteId(siteId) > contextVector.sequenceNumberForSiteId(siteId)) {
        return false
      }
    }
    return true
  }

  equals (contextVector) {
    const siteCount = Math.max(this.getSiteCount(), contextVector.getSiteCount())
    for (var siteId = 0; siteId < siteCount; siteId++) {
      if (this.sequenceNumberForSiteId(siteId) !== contextVector.sequenceNumberForSiteId(siteId)) {
        return false
      }
    }
    return true
  }

  copy () {
    const newContextVector = Object.create(ContextVector.prototype)
    newContextVector.sequenceNumbers = this.sequenceNumbers.slice()
    return newContextVector
  }

  add (operation) {
    assert.equal(
      operation.contextVector.sequenceNumberForSiteId(operation.siteId),
      this.sequenceNumberForSiteId(operation.siteId),
      'Cannot add an operation from a different context'
    )
    const siteId = operation.siteId
    this.sequenceNumbers[siteId] = (this.sequenceNumbers[siteId] || 0) + 1
  }

  sequenceNumberForSiteId (siteId) {
    return this.sequenceNumbers[siteId] || 0
  }

  getSiteCount () {
    return this.sequenceNumbers.length
  }
}
