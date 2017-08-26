const SplayTree = require('./splay-tree')
const {ZERO_POINT, compare, traverse} = require('./point-helpers')

module.exports =
class DocumentTree extends SplayTree {
  constructor (firstSegment, lastSegment, isSegmentVisible) {
    super()
    this.firstSegment = firstSegment
    this.firstSegment.documentRight = lastSegment
    this.firstSegment.documentRight.documentParent = this.firstSegment
    this.firstSegment.documentLeft = null
    this.firstSegment.documentSubtreeExtent = ZERO_POINT
    lastSegment.documentSubtreeExtent = ZERO_POINT
    this.root = this.firstSegment
    this.isSegmentVisible = isSegmentVisible
  }

  getSegmentIndex (segment) {
    let index = segment.documentLeft ? segment.documentLeft.documentSubtreeSize : 0

    while (segment.documentParent) {
      if (segment.documentParent.documentRight === segment) {
        index++
        if (segment.documentParent.documentLeft) {
          index += segment.documentParent.documentLeft.documentSubtreeSize
        }
      }
      segment = segment.documentParent
    }

    return index
  }

  getParent (node) {
    return node.documentParent
  }

  setParent (node, value) {
    node.documentParent = value
  }

  getLeft (node) {
    return node.documentLeft
  }

  setLeft (node, value) {
    node.documentLeft = value
  }

  getRight (node) {
    return node.documentRight
  }

  setRight (node, value) {
    node.documentRight = value
  }

  findSegmentContainingPosition (position) {
    let segment = this.root
    let leftAncestorEnd = ZERO_POINT
    while (segment) {
      let start = leftAncestorEnd
      if (segment.documentLeft) start = traverse(start, segment.documentLeft.documentSubtreeExtent)
      let end = start
      if (this.isSegmentVisible(segment)) end = traverse(end, segment.extent)

      if (compare(position, start) <= 0 && segment !== this.firstSegment) {
        segment = segment.documentLeft
      } else if (compare(position, end) > 0) {
        leftAncestorEnd = end
        segment = segment.documentRight
      } else {
        return {segment, start, end}
      }
    }

    throw new Error('No segment found')
  }

  insertBetween (prev, next, newSegment) {
    this.splayNode(prev)
    this.splayNode(next)
    this.root = newSegment
    newSegment.documentLeft = prev
    prev.documentParent = newSegment
    newSegment.documentRight = next
    next.documentParent = newSegment
    next.documentLeft = null
    this.updateSubtreeExtent(next)
    this.updateSubtreeExtent(newSegment)
  }

  splitSegment (prefix, suffix) {
    this.splayNode(prefix)

    this.root = suffix
    suffix.documentParent = null
    suffix.documentLeft = prefix
    prefix.documentParent = suffix
    suffix.documentRight = prefix.documentRight
    if (suffix.documentRight) suffix.documentRight.documentParent = suffix
    prefix.documentRight = null

    this.updateSubtreeExtent(prefix)
    this.updateSubtreeExtent(suffix)
  }

  updateSubtreeExtent (node, undoCountOverrides) {
    node.documentSubtreeExtent = ZERO_POINT
    node.documentSubtreeSize = 1
    if (node.documentLeft) {
      node.documentSubtreeExtent = traverse(node.documentSubtreeExtent, node.documentLeft.documentSubtreeExtent)
      node.documentSubtreeSize += node.documentLeft.documentSubtreeSize
    }
    if (this.isSegmentVisible(node, undoCountOverrides)) {
      node.documentSubtreeExtent = traverse(node.documentSubtreeExtent, node.extent)
    }
    if (node.documentRight) {
      node.documentSubtreeExtent = traverse(node.documentSubtreeExtent, node.documentRight.documentSubtreeExtent)
      node.documentSubtreeSize += node.documentRight.documentSubtreeSize
    }
  }

  getSegmentPosition (segment) {
    this.splayNode(segment)
    if (segment.documentLeft) {
      return segment.documentLeft.documentSubtreeExtent
    } else {
      return ZERO_POINT
    }
  }

  getSegments () {
    const treeSegments = []
    function visitTreeInOrder (node) {
      if (node.documentLeft) visitTreeInOrder(node.documentLeft)
      treeSegments.push(node)
      if (node.documentRight) visitTreeInOrder(node.documentRight)
    }
    visitTreeInOrder(this.root)
    return treeSegments
  }
}
