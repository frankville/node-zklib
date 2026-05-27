const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}

const DEFAULT_MAX_BYTES = 512

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'silent'
}

function safeLoggerMethod(logger, level) {
  if (!logger) return null
  if (level === 'trace' && logger === console && typeof logger.log === 'function') {
    return logger.log.bind(logger)
  }
  if (typeof logger[level] === 'function') return logger[level].bind(logger)
  if (typeof logger.log === 'function') return logger.log.bind(logger)
  return null
}

function formatMeta(meta) {
  if (!meta || typeof meta !== 'object') return ''
  const parts = Object.keys(meta).map(key => `${key}=${meta[key]}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

function mergeMeta(baseMeta, meta) {
  if (!baseMeta || typeof baseMeta !== 'object') return meta
  if (!meta || typeof meta !== 'object') return baseMeta
  return Object.assign({}, baseMeta, meta)
}

function formatBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    return { length: 0, hex: '', truncated: false }
  }

  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  const visible = buffer.subarray(0, Math.max(0, maxBytes))

  return {
    length: buffer.length,
    hex: visible.toString('hex'),
    truncated: buffer.length > visible.length,
  }
}

function createLogger(options = {}) {
  let level = normalizeLevel(options.level)
  let logger = options.logger || null
  const namespace = options.namespace || 'node-zklib'
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  const baseMeta = options.baseMeta && typeof options.baseMeta === 'object' ? options.baseMeta : {}

  const api = {
    get level() {
      return level
    },

    setLevel(nextLevel) {
      level = normalizeLevel(nextLevel)
      return api
    },

    setLogger(nextLogger) {
      logger = nextLogger || null
      return api
    },

    isEnabled(targetLevel) {
      return LEVELS[level] >= LEVELS[targetLevel] && LEVELS[targetLevel] > 0
    },

    child(childNamespace, childMeta = {}) {
      return createLogger({
        level,
        logger,
        namespace: `${namespace}:${childNamespace}`,
        maxBytes,
        baseMeta: Object.assign({}, baseMeta, childMeta),
      })
    },

    formatBuffer(buffer, bufferOptions = {}) {
      return formatBuffer(buffer, {
        maxBytes: Number.isInteger(bufferOptions.maxBytes) ? bufferOptions.maxBytes : maxBytes,
      })
    },
  }

  Object.keys(LEVELS).forEach(targetLevel => {
    if (targetLevel === 'silent') return

    api[targetLevel] = (message, meta) => {
      if (!api.isEnabled(targetLevel)) return

      const method = safeLoggerMethod(logger, targetLevel)
      if (!method) return

      const mergedMeta = mergeMeta(baseMeta, meta)
      const line = `[${new Date().toISOString()}] [${namespace}] [${targetLevel}] ${message}${formatMeta(mergedMeta)}`
      method(line, mergedMeta)
    }
  })

  return api
}

module.exports = {
  LEVELS,
  createLogger,
  formatBuffer,
  normalizeLevel,
}
