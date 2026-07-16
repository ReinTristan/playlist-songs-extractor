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

	it('limpia un timestamp residual al inicio del título (Bug 3, estrategia A)', () => {
		// Rango "0:00 - 5:36": se quita el primero como m[0] y queda el segundo pegado.
		const desc = `Tracklist
0:00 - 05:36 John Dish ft. Naika - You & Me
05:36 - 31:23 Au5 ft. Danyka Nadeau - Crossroad
31:23 - 55:28 Klaypex ft. GRÉTA - Robot Love`
		const tracks = parseTracklist(desc)
		assert.equal(tracks.length, 3)
		assert.equal(tracks[0].rawTrackTitle, 'John Dish ft. Naika - You & Me')
		assert.equal(tracks[2].rawTrackTitle, 'Klaypex ft. GRÉTA - Robot Love')
	})

	it('limpia el timestamp inicial en un tracklist numerado (Bug 3, estrategia B)', () => {
		// Sólo una línea trae timestamp → estrategia A queda con <3 y cae a la B.
		const desc = `Album
1. 05:36 Alpha - One
2. Beta - Two
3. Gamma - Three
4. Delta - Four`
		const tracks = parseTracklist(desc)
		assert.equal(tracks.length, 4)
		assert.equal(tracks[0].rawTrackTitle, 'Alpha - One')
		assert.equal(tracks[0].startTimestamp, '05:36')
		assert.equal(tracks[1].rawTrackTitle, 'Beta - Two')
	})

	it('devuelve vacío cuando no hay un tracklist reconocible', () => {
		assert.deepEqual(
			parseTracklist('Solo una descripción normal sin pistas.'),
			[],
		)
		assert.deepEqual(parseTracklist(''), [])
	})
})
