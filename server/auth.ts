import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
const options = { N: 1 << 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }

function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt)
  return salt + ':' + key.toString('hex')
}

export async function checkPassword(password: string, stored?: string) {
  const [salt, hex] = (stored ?? '0'.repeat(32) + ':' + '0'.repeat(64)).split(':')
  const key = await derive(password, salt)
  return timingSafeEqual(key, Buffer.from(hex, 'hex')) && Boolean(stored)
}

export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
export const newToken = () => randomBytes(32).toString('hex')

