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
    this.segments = [initialInsertion]
    this.segmentsByInsertionId = new Map()
    this.segmentsByInsertionId.set(getInsertionId(initialInsertion), [initialInsertion])
  }

  applyLocal (operation) {
    if (operation.type === 'insert') {
      return this.applyLocalInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyLocalInsertion ({position, text}) {
    let segmentStartInView = 0
    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i]
      const segmentEndInView = segmentStartInView + segment.text.length
      if (segmentStartInView <= position && position <= segmentEndInView) {
        const sequenceNumber = this.nextSequenceNumber++
        const insertion = {
          siteId: this.siteId,
          sequenceNumber: sequenceNumber,
          offset: 0,
          text
        }
        this.segmentsByInsertionId.set(getInsertionId(insertion), [insertion])

        if (position < segmentEndInView) {
          const {prefix, suffix} = this.splitsegment(segment, position - segmentStartInView)
          insertion.leftDependency = {

          }
          insertion.rightDependency = {

          }
          insertion.positionInParent = segment.offset + (position - segmentStartInView)
          this.segments.splice(i, 1, prefix, insertion, suffix)
        } else {
          insertion.positionInParent = segment.offset + segment.text.length
          this.segments.splice(i + 1, 0, insertion)
        }

        return Object.assign({type: 'insert'}, insertion)
      }

      segmentStartInView = segmentEndInView
    }
  }

  canApplyRemote (operation) {
    return this.segmentsByInsertionId.has(getParentInsertionId(operation))
  }

  applyRemote (operation) {
    if (operation.type === 'insert') {
      return this.applyRemoteInsertion(operation)
    } else {
      throw new Error('implement me')
    }
  }

  applyRemoteInsertion ({siteId, sequenceNumber, parentSiteId, parentSequenceNumber, positionInParent, text}) {
    let targetsegment
    const segments = this.segmentsByInsertionId.get(getParentInsertionId({parentSiteId, parentSequenceNumber}))
    for (let i = 0; i < segments.length; i++) {
      targetsegment = segments[i]
      const segmentEndOffset = targetsegment.offset + targetsegment.text.length
      if (targetsegment.offset <= positionInParent && positionInParent <= segmentEndOffset) {
        break
      }
    }

    let segmentStartInView = 0
    let segmentEndInView = 0
    let insertionIndex = 0
    while (insertionIndex < this.segments.length) {
      const segment = this.segments[insertionIndex]
      segmentEndInView = segmentStartInView + segment.text.length
      insertionIndex++

      if (segment === targetsegment) break
      segmentStartInView = segmentEndInView
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
    this.segmentsByInsertionId.set(getInsertionId(insertion), [insertion])

    if (positionInParent < segmentEndInView) {
      const {prefix, suffix} = this.splitsegment(targetsegment, positionInParent - targetsegment.offset)
      this.segments.splice(insertionIndex, 1, prefix, insertion, suffix)
      return {type: 'insert', position: segmentStartInView + (positionInParent - targetsegment.offset), text}
    } else {
      while (insertionIndex < this.segments.length) {
        const subsequentsegment = this.segments[insertionIndex]
        if (parentSiteId === subsequentsegment.parentSiteId &&
            parentSequenceNumber === subsequentsegment.parentSequenceNumber) {
          if (siteId <= subsequentsegment.siteId) break
        } else {
          break
        }
        segmentEndInView += subsequentsegment.text.length
        insertionIndex++
      }

      this.segments.splice(insertionIndex, 0, insertion)
      return {type: 'insert', position: segmentEndInView, text}
    }
  }

  splitsegment (segment, position) {
    const prefix = Object.assign({}, segment)
    prefix.text = segment.text.slice(0, position)

    const suffix = Object.assign({}, segment)
    suffix.text = segment.text.slice(position)
    suffix.offset = segment.offset + position

    const segments = this.segmentsByInsertionId.get(getInsertionId(segment))
    segments.splice(segments.indexOf(segment), 1, prefix, suffix)

    return {prefix, suffix}
  }
}

function getInsertionId ({siteId, sequenceNumber}) {
  return siteId + '.' + sequenceNumber
}

function getParentInsertionId ({parentSiteId, parentSequenceNumber}) {
  return parentSiteId + '.' + parentSequenceNumber
}
