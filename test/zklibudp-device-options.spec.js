'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLibUDP = require('../zklibudp');
const { COMMANDS } = require('../constants');

// U2: UDP was switched onto the shared options parser with no coverage at all —
// reverting it broke nothing. It is the desktop's default transport, and the one
// desktop caller of getDeviceOption runs on it.
const optionReply = payload =>
  Buffer.concat([Buffer.alloc(8), Buffer.from(payload, 'ascii')]);

describe('ZKLibUDP device options', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('reads an option that answers itself', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    sinon.stub(zk, 'executeCmd').resolves(optionReply('~SSR=0\0'));

    expect(await zk.getDeviceOption('~SSR')).to.equal('0');
  });

  it('returns null when the reply answers a different option', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    sinon.stub(zk, 'executeCmd').resolves(optionReply('~ExtendFmt=1\0'));

    expect(await zk.getDeviceOption('~SSR')).to.equal(null);
  });

  it('accepts a variant spelling of the option it asked for', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    sinon.stub(zk, 'executeCmd').resolves(optionReply('~ssr=0\0'));

    expect(await zk.getDeviceOption('~SSR')).to.equal('0');
  });

  it('passes a reply with no assignment through unchanged', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    sinon.stub(zk, 'executeCmd').resolves(optionReply('bare\0'));

    expect(await zk.getDeviceOption('~SSR')).to.equal('bare');
  });

  it('asks with the option name and a NUL terminator', async () => {
    const zk = new ZKLibUDP('127.0.0.1', 4370, 1000, 5500);
    const execute = sinon.stub(zk, 'executeCmd').resolves(optionReply('~SSR=0\0'));

    await zk.getDeviceOption('~SSR');

    const [command, payload] = execute.firstCall.args;
    expect(command).to.equal(COMMANDS.CMD_OPTIONS_RRQ);
    expect(payload.toString('ascii')).to.equal('~SSR\0');
  });
});
