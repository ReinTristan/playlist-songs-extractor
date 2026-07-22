import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveChannelNames } from '../src/extractor.ts'

describe('resolveChannelNames', () => {
	it('usa el/los anchors de canal cuando existen, ignorando metaRowText', () => {
		assert.deepEqual(
			resolveChannelNames(['SomeChannel'], 'Alan Walker and Au/Ra'),
			['SomeChannel'],
		)
	})

	it('dedupea anchors con el mismo texto', () => {
		assert.deepEqual(resolveChannelNames(['X', 'X'], ''), ['X'])
	})

	it('separa dos canales de colaboración unidos por "and"', () => {
		assert.deepEqual(resolveChannelNames([], 'Alan Walker and Au/Ra'), [
			'Alan Walker',
			'Au/Ra',
		])
	})

	it('separa tres o más canales con coma de Oxford', () => {
		assert.deepEqual(resolveChannelNames([], 'A, B, and C'), ['A', 'B', 'C'])
	})

	it('separa tres o más canales sin coma de Oxford', () => {
		assert.deepEqual(resolveChannelNames([], 'A, B and C'), ['A', 'B', 'C'])
	})

	it('devuelve un array vacío cuando no hay ninguna señal', () => {
		assert.deepEqual(resolveChannelNames([], ''), [])
		assert.deepEqual(resolveChannelNames([], '   '), [])
	})
})
