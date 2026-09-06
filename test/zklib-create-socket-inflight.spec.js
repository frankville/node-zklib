'use strict'

const { expect } = require('chai')
const ZKLib = require('../zklib')

// Un doble de `zklibTcp` que cuenta aperturas y conexiones y puede tardar, que es lo único que
// hace visible una carrera: sin demora las dos llamadas se resuelven en el mismo tick y una
// implementación sin guarda pasa igual.
const makeInner = ({ connectDelayMs = 5, failWith = null } = {}) => ({
  socket: null,
  opened: 0,
  connects: 0,
  disconnects: 0,
  // **Cede antes de dejar el socket puesto.** Un connect real lo hace, y sin eso la carrera no
  // existe: el chequeo `if(!socket)` que ya estaba alcanza para que el segundo llamador vea el
  // socket del primero, y el caso pasa sin guarda ninguna.
  async createSocket () {
    this.opened += 1
    await new Promise(resolve => setImmediate(resolve))
    this.socket = { destroyed: false }
  },
  async connect () {
    this.connects += 1
    await new Promise(resolve => setTimeout(resolve, connectDelayMs))
    if (failWith) throw failWith
    return true
  },
  async disconnect () {
    this.disconnects += 1
    this.socket = null
  }
})

// Se devuelve **el objeto que corre**, no el literal: `Object.assign` copia los contadores
// sobre `zklibTcp`, así que afirmar sobre el original es mirar un doble que nunca se usó.
const makeZk = overrides => {
  const zk = new ZKLib('192.168.1.75', 4370, 2000, 'tcp')
  const inner = Object.assign(zk.zklibTcp, overrides)
  return { zk, inner }
}

describe('ZKLib.createSocket in-flight guard', () => {

  it('opens one socket when two callers ask at the same time', async () => {
    const { zk, inner } = makeZk(makeInner())

    const [a, b] = await Promise.all([zk.createSocket(), zk.createSocket()])

    expect(a).to.equal(true)
    expect(b).to.equal(true)
    expect(inner.opened).to.equal(1)
    expect(inner.connects).to.equal(1)
  })

  it('is a guard and not a memo — a later call connects again', async () => {
    const { zk, inner } = makeZk(makeInner())

    await zk.createSocket()
    zk.zklibTcp.socket = null
    await zk.createSocket()

    expect(inner.opened).to.equal(2)
  })

  it('shares one failure with everyone waiting on it', async () => {
    const failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const { zk, inner } = makeZk(makeInner({ failWith: failure }))

    const results = await Promise.allSettled([zk.createSocket(), zk.createSocket()])

    expect(results.map(r => r.status)).to.deep.equal(['rejected', 'rejected'])
    expect(inner.connects).to.equal(1)
  })

  // El error de la ronda anterior de esta pata: una memoización que convierte un mal momento en
  // permanente. Una falla no puede dejar la conexión cerrada para siempre.
  it('retries after a failure instead of pinning it', async () => {
    const failure = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const { zk, inner } = makeZk(makeInner({ failWith: failure }))

    await zk.createSocket().catch(() => null)
    inner.connect = async function () { this.connects += 1; return true }

    await zk.createSocket()

    expect(inner.connects).to.equal(2)
  })
})
