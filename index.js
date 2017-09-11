const Document = require('./lib/document')
const {
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
} = require('./lib/serialization')

module.exports = {
  Document,
  serializeOperation, deserializeOperation,
  serializeRemotePosition, deserializeRemotePosition
}
