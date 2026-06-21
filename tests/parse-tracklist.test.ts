import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTracklist } from '../playlist-extractor.ts'

describe('parseTracklist', () => {
	it('parsea un tracklist basado en timestamps', () => {
		const desc = `Mi mix favorito
Tracklist:
0:00 Artist A - Song One
3:21 Artist B - Song Two
07:45 Artist C - Song Three (Remix)
Sígueme en redes`
		const tracks = parseTracklist(desc)
		assert.equal(tracks.length, 3)
		assert.equal(tracks[0].startTimestamp, '0:00')
		assert.equal(tracks[0].rawTrackTitle, 'Artist A - Song One')
		assert.equal(tracks[2].rawTrackTitle, 'Artist C - Song Three (Remix)')
	})

	it('parsea un tracklist numerado sin timestamps', () => {
		const desc = `Album completo
1. First Track
2. Second Track
3. Third Track
4. Fourth Track`
		const tracks = parseTracklist(desc)
		assert.equal(tracks.length, 4)
		assert.equal(tracks[0].startTimestamp, '')
		assert.equal(tracks[1].rawTrackTitle, 'Second Track')
	})

	it('devuelve vacío cuando no hay un tracklist reconocible', () => {
		assert.deepEqual(
			parseTracklist('Solo una descripción normal sin pistas.'),
			[],
		)
		assert.deepEqual(parseTracklist(''), [])
	})
})
