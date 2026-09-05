'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const ZKLib = require('../zklib');
const { ZKError } = require('../zkerror');

const makeTcpClient = () => {
  const zk = new ZKLib('127.0.0.1', 4370, 1000, 'tcp');
  return zk;
};

describe('ZKLib.createSocket connection failures', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects when the device refuses the TCP connection', async () => {
    const zk = makeTcpClient();
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4370'), {
      code: 'ECONNREFUSED'
    });
    sinon.stub(zk.zklibTcp, 'createSocket').rejects(refused);
    sinon.stub(zk.zklibTcp, 'disconnect').resolves();

    let caught = null;
    try {
      await zk.createSocket();
    } catch (err) {
      caught = err;
    }

    expect(caught, 'ECONNREFUSED must not resolve as a successful connection')
      .to.be.instanceOf(ZKError);
    expect(caught.err).to.equal(refused);
    expect(caught.command).to.equal('TCP CONNECT');
  });

  it('still rejects on connection errors other than ECONNREFUSED', async () => {
    const zk = makeTcpClient();
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    sinon.stub(zk.zklibTcp, 'createSocket').rejects(reset);
    sinon.stub(zk.zklibTcp, 'disconnect').resolves();

    let caught = null;
    try {
      await zk.createSocket();
    } catch (err) {
      caught = err;
    }

    expect(caught).to.be.instanceOf(ZKError);
    expect(caught.err).to.equal(reset);
  });

  // El `await disconnect()` de la ruta de falla no es corto: `CMD_EXIT` tiene 2000 ms de
  // timeout y `closeSocket()` otros 2000 ms de respaldo. `createSocket` no tiene guarda de
  // concurrencia — mira `if(!this.zklibTcp.socket)` y nada más — así que en esa ventana otro
  // llamador abre una sesión nueva y la conecta. Nulificar a ciegas al volver la deja huérfana:
  // conectada, sin referencia y sin `CMD_EXIT`, o sea una ranura de sesión quemada en el
  // terminal, que es justo el recurso que este trabajo existe para dejar de gastar.
  it('does not discard a socket another caller opened while it was cleaning up', async () => {
    const zk = makeTcpClient();
    const failedSocket = { destroyed: true, id: 'failed' };
    const replacementSocket = { destroyed: false, id: 'replacement' };

    sinon.stub(zk.zklibTcp, 'createSocket').callsFake(async () => {
      zk.zklibTcp.socket = failedSocket;
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    });
    sinon.stub(zk.zklibTcp, 'disconnect').callsFake(async () => {
      // El otro llamador entra acá: ve el socket nulo, abre uno nuevo y lo conecta.
      zk.zklibTcp.socket = replacementSocket;
    });

    await zk.createSocket().catch(() => {});

    expect(zk.zklibTcp.socket, 'a live socket opened meanwhile must survive the cleanup')
      .to.equal(replacementSocket);
  });

  it('leaves no socket behind when the connection is refused', async () => {
    const zk = makeTcpClient();
    // net.Socket is assigned before connect() fails, and the close event only
    // nulls it a tick later — so a failed connect must clear it itself, or a
    // destroyed socket reads as a live connection in between.
    sinon.stub(zk.zklibTcp, 'createSocket').callsFake(async () => {
      zk.zklibTcp.socket = { destroyed: true };
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    });
    const disconnect = sinon.stub(zk.zklibTcp, 'disconnect').resolves();

    await zk.createSocket().catch(() => {});

    expect(disconnect.called).to.equal(true);
    expect(zk.zklibTcp.socket).to.equal(null);
  });
});

// Every facade method routes through functionWrapper, which builds the operator
// facing command string as `[TCP] ${command}`. Without the argument the operator
// is shown `[TCP] undefined` for every failure, whatever actually failed.
const WRAPPED_TCP_COMMANDS = [
  ['getUsers', 'getUsers', []],
  ['getAttendances', 'getAttendances', [null]],
  ['setUser', 'setUser', [{ uid: 1, userId: '1', name: 'x' }]],
  ['getTimezone', 'getTimezone', [1]],
  ['setTimezone', 'setTimezone', [{ index: 1 }]],
  ['getUserTimezones', 'getUserTimezones', [1]],
  ['setUserTimezones', 'setUserTimezones', [{ uid: 1 }]],
  ['getGroupTimezones', 'getGroupTimezones', [1, {}]],
  ['setGroupTimezones', 'setGroupTimezones', [{ group: 1 }, {}]],
  ['getDeviceOption', 'getDeviceOption', ['~DeviceName']],
  ['setDeviceOption', 'setDeviceOption', ['~DeviceName', 'x']],
  ['getUserGroup', 'getUserGroup', [1]],
  ['setUserGroup', 'setUserGroup', [{ uid: 1, group: 1 }]],
  ['getUnlockGroup', 'getUnlockGroup', [1]],
  ['setUnlockGroup', 'setUnlockGroup', [{ combination: 1 }, {}]],
  ['getUnlockGroups', 'getUnlockGroups', []],
  ['setUnlockGroups', 'setUnlockGroups', [{}, {}]],
  ['deleteUser', 'deleteUser', [1]],
  ['refreshData', 'refreshData', []],
  ['openDoor', 'openDoor', []],
  ['restartDevice', 'restartDevice', []],
  ['disconnect', 'disconnect', []],
  ['freeData', 'freeData', []],
  ['disableDevice', 'disableDevice', []],
  ['enableDevice', 'enableDevice', []],
  ['getInfo', 'getInfo', []],
  ['clearAttendanceLog', 'clearAttendanceLog', []],
  ['executeCmd', 'executeCmd', [1000, '']]
  // getRealTimeLogs is deliberately absent: it catches its own ZKError and returns
  // false, so the command name is constructed and thrown away and there is nothing
  // to assert on. Left as-is — startListening() already synthesises its own error
  // code — but recorded here so the gap is a decision rather than an oversight.
  // getSocketStatus is deliberately absent: the facade exposes it but neither
  // zklibtcp.js nor zklibudp.js implements it, so it cannot be stubbed. With the
  // command name in place its failure is at least legible as `[TCP] getSocketStatus`.
];

describe('ZKLib names the command that failed', () => {
  afterEach(() => {
    sinon.restore();
  });

  WRAPPED_TCP_COMMANDS.forEach(([method, expectedCommand, args]) => {
    it(`reports ${method} failures as [TCP] ${expectedCommand}`, async () => {
      const zk = makeTcpClient();
      zk.zklibTcp.socket = {};
      const failure = new Error('device stopped answering');
      sinon.stub(zk.zklibTcp, method).rejects(failure);

      let caught = null;
      try {
        await zk[method](...args);
      } catch (err) {
        caught = err;
      }

      expect(caught, `${method} should surface the transport failure`).to.be.instanceOf(ZKError);
      expect(caught.command).to.equal(`[TCP] ${expectedCommand}`);
    });
  });

  // El nombre del comando es la mitad de lo que ve el operador; la otra mitad es la causa, y
  // se perdía entera: `ZKError` no es un `Error` y no tenía `toJSON`, así que los sitios del
  // escritorio que hacen `JSON.stringify(err)` renderizaban `err: {}`.
  it('serialises to something an operator can read', async () => {
    const zk = makeTcpClient();
    zk.zklibTcp.socket = {};
    const failure = Object.assign(new Error('connection reset by the terminal'), {
      code: 'ECONNRESET'
    });
    sinon.stub(zk.zklibTcp, 'getUsers').rejects(failure);

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    const serialised = JSON.parse(JSON.stringify(caught));
    expect(serialised.command).to.equal('[TCP] getUsers');
    expect(serialised.ip).to.equal('127.0.0.1');
    expect(serialised.err.message).to.equal('connection reset by the terminal');
    expect(serialised.err.code).to.equal('ECONNRESET');
  });

  it('names the command on the UDP path too', async () => {
    const zk = new ZKLib('127.0.0.1', 4370, 1000, 'udp', 5500);
    zk.zklibUdp.socket = {};
    sinon.stub(zk.zklibUdp, 'getUsers').rejects(new Error('timeout'));

    let caught = null;
    try {
      await zk.getUsers();
    } catch (err) {
      caught = err;
    }

    expect(caught).to.be.instanceOf(ZKError);
    expect(caught.command).to.equal('[UDP] getUsers');
  });
});
