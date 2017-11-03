const SplayTree = require('./splay-tree')
const {ZERO_POINT, compare, traverse, traversal, characterIndexForPosition, extentForText} = require('./point-helpers')

module.exports =
class SplitTree extends SplayTree {
  constructor (segment) {
    super()
    this.startSegment = segment
    this.startSegment.splitLeft = null
    this.startSegment.splitRight = null
    this.startSegment.splitParent = null
    this.startSegment.splitSubtreeExtent = this.startSegment.extent
    this.root = this.startSegment
  }

  getStart () {
    return this.startSegment
  }

  getParent (node) {
    return node.splitParent
  }

  setParent (node, value) {
    node.splitParent = value
  }

  getLeft (node) {
    return node.splitLeft
  }

  setLeft (node, value) {
    node.splitLeft = value
  }

  getRight (node) {
    return node.splitRight
  }

  setRight (node, value) {
    node.splitRight = value
  }

  updateSubtreeExtent (node) {
    node.splitSubtreeExtent = ZERO_POINT
    if (node.splitLeft) node.splitSubtreeExtent = traverse(node.splitSubtreeExtent, node.splitLeft.splitSubtreeExtent)
    node.splitSubtreeExtent = traverse(node.splitSubtreeExtent, node.extent)
    if (node.splitRight) node.splitSubtreeExtent = traverse(node.splitSubtreeExtent, node.splitRight.splitSubtreeExtent)
  }

  findSegmentContainingOffset (offset) {
    let segment = this.root
    let leftAncestorEnd = ZERO_POINT
    while (segment) {
      let start = leftAncestorEnd
      if (segment.splitLeft) start = traverse(start, segment.splitLeft.splitSubtreeExtent)
      const end = traverse(start, segment.extent)

      if (compare(offset, start) <= 0 && segment.splitLeft) {
        segment = segment.splitLeft
      } else if (compare(offset, end) > 0) {
        leftAncestorEnd = end
        segment = segment.splitRight
      } else {
        this.splayNode(segment)
        return segment
      }
    }

    throw new Error('No segment found')
  }

  splitSegment (segment, offset) {
    const splitIndex = characterIndexForPosition(segment.text, offset)

    this.splayNode(segment)
    const suffix = Object.assign({}, segment)
    suffix.text = segment.text.slice(splitIndex)
    suffix.extent = traversal(segment.extent, offset)

    suffix.spliceId = Object.assign({}, segment.spliceId)
    suffix.offset = traverse(suffix.offset, offset)
    suffix.deletions = new Set(suffix.deletions)
    segment.text = segment.text.slice(0, splitIndex)
    segment.extent = offset
    segment.nextSplit = suffix

    this.root = suffix
    suffix.splitParent = null
    suffix.splitLeft = segment
    segment.splitParent = suffix
    suffix.splitRight = segment.splitRight
    if (suffix.splitRight) suffix.splitRight.splitParent = suffix
    segment.splitRight = null

    this.updateSubtreeExtent(segment)
    this.updateSubtreeExtent(suffix)

    return suffix
  }

  getSuccessor (segment) {
    return segment.nextSplit
  }

  getSegments () {
    const segments = []
    let segment = this.getStart()
    while (segment) {
      segments.push(segment)
      segment = segment.nextSplit
    }
    return segments
  }
}
