const assert = require('assert');
const { createLogger, formatBuffer, normalizeLevel } = require('../helpers/logger');
const ZKLib = require('../zklib');

function captureLogger() {
  const calls = [];
  const logger = {};
  ['error', 'warn', 'info', 'debug', 'trace', 'log'].forEach(level => {
    logger[level] = (line, meta) => calls.push({ level, line, meta });
  });
  return { logger, calls };
}

describe('structured logger', () => {
  it('defaults to silent and emits nothing', () => {
    const { logger, calls } = captureLogger();
    const log = createLogger({ logger, namespace: 'test' });

    log.error('hidden');
    log.trace('hidden');

    assert.strictEqual(calls.length, 0);
  });

  it('honours level ordering', () => {
    const { logger, calls } = captureLogger();
    const log = createLogger({ level: 'debug', logger, namespace: 'test' });

    log.info('visible');
    log.trace('hidden');

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].level, 'info');
    assert.match(calls[0].line, /\[test\] \[info\] visible/);
  });

  it('allows trace logging with structured metadata', () => {
    const { logger, calls } = captureLogger();
    const log = createLogger({ level: 'trace', logger, namespace: 'test' });

    log.trace('packet', { length: 4, hex: '01020304' });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].level, 'trace');
    assert.deepStrictEqual(calls[0].meta, { length: 4, hex: '01020304' });
    assert.match(calls[0].line, /length=4 hex=01020304/);
  });

  it('formats buffers with truncation metadata', () => {
    const formatted = formatBuffer(Buffer.from([1, 2, 3, 4]), { maxBytes: 2 });

    assert.deepStrictEqual(formatted, {
      length: 4,
      hex: '0102',
      truncated: true,
    });
  });

  it('normalizes unknown levels to silent', () => {
    assert.strictEqual(normalizeLevel('debug'), 'debug');
    assert.strictEqual(normalizeLevel('verbose'), 'silent');
  });

  it('uses console.log for trace when logger is console', () => {
    const originalLog = console.log;
    const originalTrace = console.trace;
    const calls = [];

    console.log = line => calls.push({ method: 'log', line });
    console.trace = line => calls.push({ method: 'trace', line });

    try {
      const log = createLogger({ level: 'trace', logger: console, namespace: 'test' });
      log.trace('packet');
    } finally {
      console.log = originalLog;
      console.trace = originalTrace;
    }

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'log');
  });

  it('adds base metadata to every log call', () => {
    const { logger, calls } = captureLogger();
    const log = createLogger({
      level: 'error',
      logger,
      namespace: 'test',
      baseMeta: { ip: '192.168.1.10', transport: 'tcp' },
    });

    log.error('no valid connect reply');

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].meta, { ip: '192.168.1.10', transport: 'tcp' });
    assert.match(calls[0].line, /ip=192\.168\.1\.10/);
    assert.match(calls[0].line, /transport=tcp/);
  });

  it('merges child metadata with parent metadata', () => {
    const { logger, calls } = captureLogger();
    const log = createLogger({
      level: 'debug',
      logger,
      namespace: 'test',
      baseMeta: { ip: '192.168.1.10' },
    });

    log.child('tcp', { port: 4370, transport: 'tcp' }).debug('sending connect command');

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].meta, {
      ip: '192.168.1.10',
      port: 4370,
      transport: 'tcp',
    });
  });
});

describe('ZKLib logger integration', () => {
  it('propagates log level and logger to transports', () => {
    const { logger, calls } = captureLogger();
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp', undefined, 0, {
      logLevel: 'error',
      logger,
    });

    zk.setLogLevel('trace');
    zk.zklibTcp.logger.trace('tcp trace');
    zk.zklibUdp.logger.debug('udp debug');

    assert.strictEqual(calls.length, 2);
    assert.match(calls[0].line, /\[node-zklib:tcp\] \[trace\] tcp trace/);
    assert.match(calls[0].line, /ip=127\.0\.0\.1/);
    assert.match(calls[0].line, /transport=tcp/);
    assert.match(calls[1].line, /\[node-zklib:udp\] \[debug\] udp debug/);
    assert.match(calls[1].line, /ip=127\.0\.0\.1/);
    assert.match(calls[1].line, /transport=udp/);
  });

  it('can replace the logger after construction', () => {
    const first = captureLogger();
    const second = captureLogger();
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'udp', 5500, 0, {
      logLevel: 'debug',
      logger: first.logger,
    });

    zk.setLogger(second.logger);
    zk.zklibUdp.logger.debug('udp debug');

    assert.strictEqual(first.calls.length, 0);
    assert.strictEqual(second.calls.length, 1);
  });

  it('accepts options in the comm_code position when no comm_code is needed', () => {
    const { logger, calls } = captureLogger();
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp', undefined, {
      logLevel: 'debug',
      logger,
    });

    zk.zklibTcp.logger.debug('tcp debug');

    assert.strictEqual(zk.zklibTcp.comm_code, 0);
    assert.strictEqual(calls.length, 1);
  });
});
