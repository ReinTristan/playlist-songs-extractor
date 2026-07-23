import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { normalizeUrl, parseMaxVideos } from '../src/utils.ts'

describe('cli main() sin TTY y sin argv ', () => {
	it('sale con código 1 e imprime uso cuando no hay argv ni TTY', () => {
		const result = spawnSync('node', ['src/index.ts'], {
			stdio: 'pipe',
			timeout: 10000,
		})
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /uso/i)
	})
})

describe('parseMaxVideos', () => {
	it('acepta enteros >= 1', () => {
		assert.equal(parseMaxVideos('5'), 5)
		assert.equal(parseMaxVideos('1'), 1)
	})
	it('acepta vacío y "todos" como sin límite', () => {
		assert.equal(parseMaxVideos(''), Infinity)
		assert.equal(parseMaxVideos('todos'), Infinity)
		assert.equal(parseMaxVideos('TODOS'), Infinity)
	})
	it('rechaza "0"', () => {
		assert.equal(parseMaxVideos('0'), null)
	})
	it('rechaza negativos', () => {
		assert.equal(parseMaxVideos('-3'), null)
	})
	it('espacio en blanco cae a sin límite (cambio deliberado vs. bug original)', () => {
		assert.equal(parseMaxVideos(' '), Infinity)
	})
	it('rechaza no numéricos', () => {
		assert.equal(parseMaxVideos('abc'), null)
	})
})

describe('normalizeUrl)', () => {
	it('deja pasar URLs completas con esquema', () => {
		assert.equal(
			normalizeUrl('https://www.youtube.com/playlist?list=X'),
			'https://www.youtube.com/playlist?list=X',
		)
	})
	it('antepone https:// cuando falta el esquema', () => {
		assert.equal(
			normalizeUrl('www.youtube.com/playlist?list=X'),
			'https://www.youtube.com/playlist?list=X',
		)
	})
	it('antepone https:// a youtu.be sin esquema', () => {
		assert.equal(normalizeUrl('youtu.be/abc123'), 'https://youtu.be/abc123')
	})
	it('construye la URL completa a partir de un ID suelto', () => {
		assert.equal(
			normalizeUrl('PLxxxx'),
			'https://youtube.com/playlist?list=PLxxxx',
		)
	})
	it('vacío devuelve vacío', () => {
		assert.equal(normalizeUrl('  '), '')
	})
})
