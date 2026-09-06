'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibTCP = require('../zklibtcp');
const { COMMANDS } = require('../constants');

// The record layout can only be inferred from a read that returned a user — so on a
// device with none, the first write is a guess. Measured on a ZEM760: it stores
// 28-byte records, and a 72-byte write is ACKed and lands with an empty password and
// `enabled: false`. The credential does not work, and a reconciliation loop then
// rewrites it on every pass forever.
//
// ZKAccess reads device options before writing. `~SSR` reports the layout with no
// users present, which is the gap.
describe('ZKLibTCP user record layout detection', () => {
  afterEach(() => {
    sinon.restore();
  });

  const writtenPayload = executeStub => {
    const call = executeStub.getCalls().find(c => c.args[0] === COMMANDS.CMD_USER_WRQ);
    return call && call.args[1];
  };

  it('writes compact records when the device reports ~SSR 0', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '0' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234' });

    expect(option.calledWith('~SSR')).to.equal(true);
    expect(writtenPayload(execute).length).to.equal(28);
  });

  it('writes SSR records when the device reports ~SSR 1', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '1' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234' });

    expect(writtenPayload(execute).length).to.equal(72);
  });

  it('keeps the 72-byte default when the device cannot answer', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    sinon.stub(zk, 'getDeviceOptionResult').rejects(new Error('CMD_ACK_ERROR'));
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234' });

    expect(writtenPayload(execute).length).to.equal(72);
  });

  it('does not probe when the layout was already learned from a read', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    zk.userPacketSize = 28;
    const option = sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '1' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234' });

    expect(option.called, 'a read already answered this').to.equal(false);
    expect(writtenPayload(execute).length).to.equal(28);
  });

  it('does not probe when the caller states the layout', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '0' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234', packetSize: 72 });

    expect(option.called).to.equal(false);
    expect(writtenPayload(execute).length).to.equal(72);
  });

  // S1: the reply is not checked against the option that was asked for. `~SSR`'s two
  // nearest neighbours in the same namespace, `~UserExtFmt` and `~ExtendFmt`, both
  // read "1" on this panel — the value that selects the layout that corrupts the
  // record. A shifted reply is not an improbable byte collision here.
  it('ignores an options reply that answers a different option', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const reply = Buffer.concat([Buffer.alloc(8), Buffer.from('~ExtendFmt=1\0', 'ascii')]);
    sinon.stub(zk, 'executeCmd').callsFake(async (command) => (
      command === COMMANDS.CMD_OPTIONS_RRQ ? reply : Buffer.alloc(0)
    ));

    expect(await zk.getDeviceOption('~SSR')).to.equal(null);
  });

  it('keeps the default when the layout probe is answered by a different option', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    // `0` and not `1`: a stolen `1` selects 72, which is also the default, so the
    // assertion would hold for the wrong reason and measure nothing.
    const reply = Buffer.concat([Buffer.alloc(8), Buffer.from('~UserExtFmt=0\0', 'ascii')]);
    const execute = sinon.stub(zk, 'executeCmd').callsFake(async (command) => (
      command === COMMANDS.CMD_OPTIONS_RRQ ? reply : Buffer.alloc(0)
    ));

    await zk.setUser({ uid: 1, userId: '1', name: 'X', password: '1234' });

    const write = execute.getCalls().find(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(write.args[1].length, 'a stolen reply must not choose the layout').to.equal(72);
  });

  it('reads an option that answers itself', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const reply = Buffer.concat([Buffer.alloc(8), Buffer.from('~SSR=0\0', 'ascii')]);
    sinon.stub(zk, 'executeCmd').resolves(reply);

    expect(await zk.getDeviceOption('~SSR')).to.equal('0');
  });

  // S2: a firmware that cannot answer must be asked once, not once per write. This
  // work exists to stop over-talking to the terminal.
  it('probes once when the device attributes an empty answer to the option', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '' });
    sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    for (let i = 0; i < 5; i += 1) {
      await zk.setUser({ uid: i + 1, userId: String(i + 1), name: 'X', password: '1234' });
    }

    expect(option.callCount, 'an unanswerable probe must not run per write').to.equal(1);
  });

  /**
   * T1: S1 and S2 are each right and their combination was not.
   *
   * The echo check correctly refuses a reply about another option — and the
   * memoization then made that refusal permanent, so the instance fell back to 72
   * and never asked again. On a panel that needs 28 that is every write for the rest
   * of the session storing an unusable record. Before the memoization it
   * self-corrected: the next write re-probed.
   *
   * The two misses are different facts. `""` is an unimplemented option, which will
   * not become implemented — remember it. `null` is a reply about something else,
   * which is a shifted session and transient — ask again.
   */
  it('re-probes after a reply that answered a different option', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult');
    option.onFirstCall().resolves({ attributable: false, value: null });
    option.resolves({ attributable: true, value: '0' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'A', password: '1234' });
    zk.userPacketSizeProbedAt -= 60000;
    await zk.setUser({ uid: 2, userId: '2', name: 'B', password: '1234' });

    expect(option.callCount, 'a shifted reply is transient, not an answer').to.equal(2);
    const writes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(writes[0].args[1].length, 'the first write falls back').to.equal(72);
    expect(writes[1].args[1].length, 'and the second recovers').to.equal(28);
  });

  // T2: the panel is the authority on its own option names, and a variant spelling of
  // the name asked for is not an answer about a different option.
  [
    ['a lower-case echo', '~ssr=0'],
    ['a NUL inside the echoed name', '~SSR\u0000=0'],
    ['padding around the echoed name', ' ~SSR =0']
  ].forEach(([label, payload]) => {
    it(`accepts ${label}`, async () => {
      const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
      const reply = Buffer.concat([Buffer.alloc(8), Buffer.from(payload, 'ascii')]);
      sinon.stub(zk, 'executeCmd').resolves(reply);

      expect(await zk.getDeviceOption('~SSR')).to.equal('0');
    });
  });

  /**
   * U1: permanence is now **positive**, not inferred from the shape of a failure.
   *
   * Only a reply the device attributed to `~SSR` — one that carried an `=` and echoed
   * the name — settles the question. Measured on the panel: an option that does not
   * exist is answered `~NoExistOption=`, so the one genuinely permanent failure
   * arrives *with* an `=` and is covered. Everything else — a reply about another
   * option, a frame with no `=` at all, a throw — is a broken moment, not a fact
   * about the firmware, and reply-stealing produces the missing-reply arm as readily
   * as the wrong-reply one.
   */
  const NO_EQUALS_REPLY = Buffer.concat([Buffer.alloc(8), Buffer.from('garbage\0', 'ascii')]);

  it('re-probes after a reply that carried no option assignment', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const execute = sinon.stub(zk, 'executeCmd');
    execute.withArgs(COMMANDS.CMD_OPTIONS_RRQ).onFirstCall().resolves(NO_EQUALS_REPLY);
    execute.withArgs(COMMANDS.CMD_OPTIONS_RRQ).resolves(
      Buffer.concat([Buffer.alloc(8), Buffer.from('~SSR=0\0', 'ascii')])
    );
    execute.resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'A', password: '1234' });
    zk.userPacketSizeProbedAt -= 60000;
    await zk.setUser({ uid: 2, userId: '2', name: 'B', password: '1234' });

    const writes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(writes[0].args[1].length, 'the first write falls back').to.equal(72);
    expect(writes[1].args[1].length, 'and a later one recovers').to.equal(28);
  });

  it('re-probes after the option command throws', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult');
    option.onFirstCall().rejects(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA'));
    option.resolves({ attributable: true, value: '0' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'A', password: '1234' });
    zk.userPacketSizeProbedAt -= 60000;
    await zk.setUser({ uid: 2, userId: '2', name: 'B', password: '1234' });

    const writes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(writes[1].args[1].length, 'a timeout is a moment, not a firmware fact').to.equal(28);
  });

  /**
   * …but the retries are bounded **in time, not in attempts**.
   *
   * A count is the wrong unit: it scales with write volume, so a 90-credential site
   * burns the budget thirty times faster than a three-credential one under identical
   * conditions, and nothing about the hazard depends on site size. Worse, the count
   * can only ever be spent on failures — an attributable reply settles — so a few
   * unlucky moments early in a pass exhaust it and every remaining write goes out at
   * the default, while the device answers correctly the whole time.
   */
  it('does not probe more than once inside the retry interval', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult').rejects(new Error('shifted'));
    sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    for (let i = 0; i < 8; i += 1) {
      await zk.setUser({ uid: i + 1, userId: String(i + 1), name: 'X', password: '1234' });
    }

    expect(option.callCount, 'a broken session must not cost a probe per write').to.equal(1);
  });

  it('probes again once the retry interval has passed, and never gives up', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult');
    option.onFirstCall().rejects(new Error('shifted'));
    option.resolves({ attributable: true, value: '0' });
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'A', password: '1234' });
    // Wind the last attempt back past the interval rather than waiting it out.
    zk.userPacketSizeProbedAt -= 60000;
    await zk.setUser({ uid: 2, userId: '2', name: 'B', password: '1234' });

    const writes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(writes[0].args[1].length, 'the contended write falls back').to.equal(72);
    expect(writes[1].args[1].length, 'and the layout is still learnable later').to.equal(28);
  });

  it('recovers after many contended writes, not just the first few', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult');
    option.rejects(new Error('shifted'));
    const execute = sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    // Twenty writes, each its own contended moment. A count-based bound would have
    // been spent long before this and pinned the default for the rest of the pass.
    for (let i = 0; i < 20; i += 1) {
      zk.userPacketSizeProbedAt -= 60000;
      await zk.setUser({ uid: i + 1, userId: String(i + 1), name: 'X', password: '1234' });
    }
    option.resolves({ attributable: true, value: '0' });
    zk.userPacketSizeProbedAt -= 60000;
    await zk.setUser({ uid: 99, userId: '99', name: 'Z', password: '1234' });

    const writes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_USER_WRQ);
    expect(writes[writes.length - 1].args[1].length,
      'the budget is time, so it is never exhausted by volume').to.equal(28);
  });

  // The one genuinely permanent failure: the panel answers an option it does not
  // implement with `<name>=`, attributable and empty. Asked once.
  it('asks once when the device attributes an empty answer to the option', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const reply = Buffer.concat([Buffer.alloc(8), Buffer.from('~SSR=\0', 'ascii')]);
    const execute = sinon.stub(zk, 'executeCmd');
    execute.withArgs(COMMANDS.CMD_OPTIONS_RRQ).resolves(reply);
    execute.resolves(Buffer.alloc(0));

    for (let i = 0; i < 5; i += 1) {
      await zk.setUser({ uid: i + 1, userId: String(i + 1), name: 'X', password: '1234' });
    }

    const probes = execute.getCalls().filter(call => call.args[0] === COMMANDS.CMD_OPTIONS_RRQ);
    expect(probes, 'an unimplemented option stays unimplemented').to.have.length(1);
  });

  it('probes once and reuses the answer for later writes', async () => {
    const zk = new ZKLibTCP('127.0.0.1', 4370, 1000);
    const option = sinon.stub(zk, 'getDeviceOptionResult').resolves({ attributable: true, value: '0' });
    sinon.stub(zk, 'executeCmd').resolves(Buffer.alloc(0));

    await zk.setUser({ uid: 1, userId: '1', name: 'A', password: '1234' });
    await zk.setUser({ uid: 2, userId: '2', name: 'B', password: '5678' });

    expect(option.callCount, 'the layout does not change under us').to.equal(1);
  });
});
