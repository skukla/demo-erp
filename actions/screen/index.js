/* GET screen/ and its assets; screen/api/<action>/… runs that action for the screen, behind the key. */
const { serveScreen } = require('../../lib/screen')

const handlers = {
  health: require('../health'),
  settings: require('../settings'),
  admin: require('../admin'),
  products: require('../products'),
  partners: require('../partners'),
  pricing: require('../pricing'),
  orders: require('../orders'),
  events: require('../events')
}

// Written by scripts/build-screen.js before every build (the pre-app-build hook).
const assets = require('./assets.generated')

exports.main = (params) => serveScreen(params, { assets, handlers })
