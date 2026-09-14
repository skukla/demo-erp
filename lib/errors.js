/* Errors the action wrapper turns into HTTP statuses. Anything else is a 500. */

class HttpError extends Error {
  constructor (statusCode, code, message) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

/** @returns {HttpError} a 400 */
function badRequest (message) {
  return new HttpError(400, 'BAD_REQUEST', message)
}

/** @returns {HttpError} a 404 */
function notFound (what) {
  return new HttpError(404, 'NOT_FOUND', `${what} was not found.`)
}

module.exports = { HttpError, badRequest, notFound }
