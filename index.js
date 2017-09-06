const DocumentHistory = require('./lib/document-history')
const {
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
} = require('./lib/serialization')

module.exports = {
  DocumentHistory,
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
}
