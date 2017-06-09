const DocumentReplica = require('./lib/document-replica')
const {
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
} = require('./lib/serialization')

module.exports = {
  DocumentReplica,
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
}
