import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTitle } from '../playlist-extractor.ts'

describe('parseTitle', () => {
	it('separa varios artistas principales por comas', () => {
		const r = parseTitle('SFRNG, SOVAGI, Aizu - IN MY HEAD')
		assert.deepEqual(r.artists, ['SFRNG', 'SOVAGI', 'Aizu'])
		assert.equal(r.songTitle, 'IN MY HEAD')
	})

	it('separa artistas por & y limpia ruido (Official Video)', () => {
		const r = parseTitle(
			'Martin Garrix & Bebe Rexha - In The Name Of Love (Official Video)',
		)
		assert.deepEqual(r.artists, ['Martin Garrix', 'Bebe Rexha'])
		assert.equal(r.songTitle, 'In The Name Of Love')
		assert.equal(r.mixType, 'original')
	})

	it('extrae artistas invitados (feat.) múltiples', () => {
		const r = parseTitle('Drake - Forever ft. Kanye West, Lil Wayne & Eminem')
		assert.deepEqual(r.featuredArtists, ['Kanye West', 'Lil Wayne', 'Eminem'])
		assert.deepEqual(r.artists, ['Drake'])
		assert.equal(r.songTitle, 'Forever')
	})

	it('detecta el tipo de mezcla (remix) y lo mantiene en mixType', () => {
		const r = parseTitle('Calvin Harris - Feel So Close (Nero Remix)')
		assert.ok(r.mixType.toLowerCase().includes('remix'))
	})

	it('marca como original cuando no hay tipo de mezcla', () => {
		assert.equal(parseTitle('Artist - Song').mixType, 'original')
	})

	it('detecta géneros entre corchetes', () => {
		const r = parseTitle('Calvin Harris - Feel So Close (Nero Remix) [Dubstep]')
		assert.deepEqual(r.genres, ['dubstep'])
	})

	it('detecta géneros en segmentos con pipe (formato NCS) y conserva la canción', () => {
		const r = parseTitle(
			'DJ PUMA - LOVESICK | Trance | NCS - Copyright Free Music',
		)
		assert.deepEqual(r.artists, ['DJ PUMA'])
		assert.equal(r.songTitle, 'LOVESICK')
		assert.deepEqual(r.genres, ['trance'])
	})

	it('descarta géneros genéricos contenidos en otro más específico', () => {
		const r = parseTitle(
			'SFRNG - IN MY HEAD | Deep House | NCS - Copyright Free Music',
		)
		assert.deepEqual(r.genres, ['deep house'])
	})

	it('sin separador deja artists vacío y usa el título completo', () => {
		const r = parseTitle('Some Song Without Artist Separator')
		assert.deepEqual(r.artists, [])
		assert.equal(r.songTitle, 'Some Song Without Artist Separator')
	})
})
