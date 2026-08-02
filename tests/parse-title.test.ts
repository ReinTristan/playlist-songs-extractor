import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTitle } from '../src/extractor.ts'

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

	it('saca el tipo de mezcla entre paréntesis del título de la canción', () => {
		const r = parseTitle('Calvin Harris - Feel So Close (Nero Remix)')
		assert.deepEqual(r.artists, ['Calvin Harris'])
		assert.equal(r.songTitle, 'Feel So Close')
	})

	it('saca el tipo de mezcla del segmento final tras un guion', () => {
		const r = parseTitle('Artist - Song - Extended Mix')
		assert.deepEqual(r.artists, ['Artist'])
		assert.equal(r.songTitle, 'Song')
		assert.equal(r.mixType, 'Extended Mix')
	})

	it('saca el paréntesis de mezcla pero conserva el género que traía adentro', () => {
		const r = parseTitle('Artist - Song (Deep House Remix)')
		assert.equal(r.songTitle, 'Song')
		assert.deepEqual(r.genres, ['deep house'])
		assert.ok(r.mixType.toLowerCase().includes('remix'))
	})

	it('no recorta el título cuando la keyword de mezcla está en el medio', () => {
		const r = parseTitle('Artist - Cover Me In Sunshine')
		assert.deepEqual(r.artists, ['Artist'])
		assert.equal(r.songTitle, 'Cover Me In Sunshine')
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

	it('feat. antes del guion no se come el separador', () => {
		const r = parseTitle('TheFatRat feat. Laura Brehm - MAYDAY')
		assert.deepEqual(r.artists, ['TheFatRat'])
		assert.deepEqual(r.featuredArtists, ['Laura Brehm'])
		assert.equal(r.songTitle, 'MAYDAY')
	})

	it('feat. antes del guion con varios artistas invitados y remix', () => {
		const r = parseTitle(
			'Rudimental x Skepsis feat. Charlotte Plank & Riko Dan - Green & Gold (Darren Styles Remix)',
		)
		assert.deepEqual(r.artists, ['Rudimental', 'Skepsis'])
		assert.deepEqual(r.featuredArtists, ['Charlotte Plank', 'Riko Dan'])
		assert.ok(r.mixType.toLowerCase().includes('remix'))
	})

	it('feat entre paréntesis antes del guion no deja el paréntesis huérfano', () => {
		const r = parseTitle('Jade Key - Home (feat. Enya Angel)')
		assert.deepEqual(r.artists, ['Jade Key'])
		assert.deepEqual(r.featuredArtists, ['Enya Angel'])
		assert.equal(r.songTitle, 'Home')
	})

	it('feat. pegado al nombre sin espacio ', () => {
		const r = parseTitle('Anuka - Fatal Error feat.Ddark')
		assert.deepEqual(r.featuredArtists, ['Ddark'])
	})

	it('no corta artistas con guion interno ', () => {
		const r = parseTitle('Drake - Forever ft. Jay-Z')
		assert.deepEqual(r.artists, ['Drake'])
		assert.deepEqual(r.featuredArtists, ['Jay-Z'])
		assert.equal(r.songTitle, 'Forever')
	})
	it('no corta artistas con guion interno ', () => {
		const r = parseTitle('Artist feat. T-Pain - Song')
		assert.deepEqual(r.artists, ['Artist'])
		assert.deepEqual(r.featuredArtists, ['T-Pain'])
		assert.equal(r.songTitle, 'Song')
	})
	it('no corta artistas con guion interno ', () => {
		const r = parseTitle('A-Trak feat. Todd Terry - Push')
		assert.deepEqual(r.artists, ['A-Trak'])
		assert.deepEqual(r.featuredArtists, ['Todd Terry'])
		assert.equal(r.songTitle, 'Push')
	})
	it('Evaluacion completa de la separacion con todos los casos al mismo tiempo y con mas de dos artistas', () => {
		//La idea es poner el caso mas complejo para
		const megaCollabTitle =
			'Alan Walker & Au/Ra and Unlike Pluto with Tyler the creator, Aero Chord x Martin Ingrosso vs ODESZA w/ Aviva vs. Ava Max, Kim Petras × Neoni X Dusqk * S3RL with Vau boy ft Lionfield - Best song collab ever'

		const r = parseTitle(megaCollabTitle)
		assert.deepEqual(r.artists, [
			'Alan Walker',
			'Au/Ra',
			'Unlike Pluto',
			'Tyler the creator',
			'Aero Chord',
			'Martin Ingrosso',
			'ODESZA',
			'Aviva',
			'Ava Max',
			'Kim Petras',
			'Neoni',
			'Dusqk',
			'S3RL',
			'Vau boy',
		])
		assert.deepEqual(r.featuredArtists, ['Lionfield'])
		assert.deepEqual(r.songTitle, 'Best song collab ever')
	})
	it('separa artista y canción por slash con espacios', () => {
		const r = parseTitle('Artist / Song')
		assert.deepEqual(r.artists, ['Artist'])
		assert.equal(r.songTitle, 'Song')
	})

	it('separa artista y canción por pipe cuando no hay guion', () => {
		const r = parseTitle('Artist | Song')
		assert.deepEqual(r.artists, ['Artist'])
		assert.equal(r.songTitle, 'Song')
	})

	it('no parte un artista con slash interno (guion como separador)', () => {
		const r = parseTitle('Au/Ra - Song')
		assert.deepEqual(r.artists, ['Au/Ra'])
		assert.equal(r.songTitle, 'Song')
	})

	it('no parte AC/DC por el slash sin espacios', () => {
		const r = parseTitle('AC/DC - Thunderstruck')
		assert.deepEqual(r.artists, ['AC/DC'])
		assert.equal(r.songTitle, 'Thunderstruck')
	})

	it('combina separador de artistas (coma) con separador de canción (slash)', () => {
		const r = parseTitle('SFRNG, SOVAGI / Song')
		assert.deepEqual(r.artists, ['SFRNG', 'SOVAGI'])
		assert.equal(r.songTitle, 'Song')
	})

	it('pipe como separador con género trailing', () => {
		const r = parseTitle('Artist | Song | Trance')
		assert.deepEqual(r.artists, ['Artist'])
		assert.equal(r.songTitle, 'Song')
		assert.deepEqual(r.genres, ['trance'])
	})

	it('separa por cualquier variante unicode de guion', () => {
		// U+002D, U+2010, U+2011, U+2012, U+2013, U+2014, U+2212: visualmente
		// iguales, y las fuentes/copy-paste traen cualquiera de ellas.
		for (const dash of ['-', '‐', '‑', '‒', '–', '—', '−']) {
			const r = parseTitle(`Artist ${dash} Song`)
			assert.deepEqual(
				r.artists,
				['Artist'],
				`falló con U+${dash.codePointAt(0)?.toString(16)}`,
			)
			assert.equal(r.songTitle, 'Song')
		}
	})

	it('Multiples artistas por el mismo separador', () => {
		const megaCollabTitle =
			'Alan Walker x Au/Ra x Torine x Unlike Pluto x Aviva x S3RL - Best song collab ever'
		const r = parseTitle(megaCollabTitle)
		assert.deepEqual(r.artists, [
			'Alan Walker',
			'Au/Ra',
			'Torine',
			'Unlike Pluto',
			'Aviva',
			'S3RL',
		])
		assert.deepEqual(r.featuredArtists, [])
		assert.deepEqual(r.songTitle, 'Best song collab ever')
	})
})
