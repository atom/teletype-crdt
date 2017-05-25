module.exports =
class DocumentReplica {
  constructor (siteId) {
    this.siteId = siteId
    this.nextSequenceNumber = 1
    const initialInsertion = {
      siteId: 0,
      sequenceNumber: 0,
      positionInParent: 0,
      text: '',
      offset: 0
    }
    this.regions = [initialInsertion]
    this.regionsByInsertionId = new Map()
    this.regionsByInsertionId.set(getInsertionId(initialInsertion), [initialInsertion])
  }

  applyLocal (operation) {
    if (operation.type === 'insert') {
      return this.applyLocalInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyLocalInsertion ({position, text}) {
    let regionStartInView = 0
    for (let i = 0; i < this.regions.length; i++) {
      const region = this.regions[i]
      const regionEndInView = regionStartInView + region.text.length
      if (regionStartInView <= position && position <= regionEndInView) {
        const sequenceNumber = this.nextSequenceNumber++
        const insertion = {
          siteId: this.siteId,
          sequenceNumber: sequenceNumber,
          parentSiteId: region.siteId,
          parentSequenceNumber: region.sequenceNumber,
          offset: 0,
          text
        }
        this.regionsByInsertionId.set(getInsertionId(insertion), [insertion])

        if (position < regionEndInView) {
          const {prefix, suffix} = this.splitRegion(region, position - regionStartInView)
          insertion.positionInParent = region.offset + (position - regionStartInView)
          this.regions.splice(i, 1, prefix, insertion, suffix)
        } else {
          insertion.positionInParent = region.offset + region.text.length
          this.regions.splice(i + 1, 0, insertion)
        }

        return Object.assign({type: 'insert'}, insertion)
      }

      regionStartInView = regionEndInView
    }
  }

  applyRemote (operation) {
    if (operation.type === 'insert') {
      return this.applyRemoteInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyRemoteInsertion ({siteId, sequenceNumber, parentSiteId, parentSequenceNumber, positionInParent, text}) {
    let targetRegion
    const parentInsertionId = getInsertionId({siteId: parentSiteId, sequenceNumber: parentSequenceNumber})
    const regions = this.regionsByInsertionId.get(parentInsertionId)
    for (let i = 0; i < regions.length; i++) {
      targetRegion = regions[i]
      const regionEndOffset = targetRegion.offset + targetRegion.text.length
      if (targetRegion.offset <= positionInParent && positionInParent <= regionEndOffset) {
        break
      }
    }

    let regionStartInView = 0
    let regionEndInView = 0
    let insertionIndex = 0
    while (insertionIndex < this.regions.length) {
      const region = this.regions[insertionIndex]
      regionEndInView = regionStartInView + region.text.length
      insertionIndex++

      if (region === targetRegion) break
      regionStartInView = regionEndInView
    }

    const insertion = {
      siteId,
      sequenceNumber,
      parentSiteId,
      parentSequenceNumber,
      positionInParent,
      text,
      offset: 0
    }
    this.regionsByInsertionId.set(getInsertionId(insertion), [insertion])

    if (positionInParent < regionEndInView) {
      const {prefix, suffix} = this.splitRegion(targetRegion, positionInParent - targetRegion.offset)
      this.regions.splice(insertionIndex, 1, prefix, insertion, suffix)
      return {type: 'insert', position: regionStartInView + (positionInParent - targetRegion.offset), text}
    } else {
      while (insertionIndex < this.regions.length) {
        const subsequentRegion = this.regions[insertionIndex]
        if (parentSiteId === subsequentRegion.parentSiteId &&
            parentSequenceNumber === subsequentRegion.parentSequenceNumber) {
          if (siteId <= subsequentRegion.siteId) break
        } else {
          break
        }
        regionEndInView += subsequentRegion.text.length
        insertionIndex++
      }

      this.regions.splice(insertionIndex, 0, insertion)
      return {type: 'insert', position: regionEndInView, text}
    }
  }

  splitRegion (region, position) {
    const prefix = Object.assign({}, region)
    prefix.text = region.text.slice(0, position)

    const suffix = Object.assign({}, region)
    suffix.text = region.text.slice(position)
    suffix.offset = region.offset + position

    const regions = this.regionsByInsertionId.get(getInsertionId(region))
    regions.splice(regions.indexOf(region), 1, prefix, suffix)

    return {prefix, suffix}
  }
}

function getInsertionId ({siteId, sequenceNumber}) {
  return siteId + '.' + sequenceNumber
}
