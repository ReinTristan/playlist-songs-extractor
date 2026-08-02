import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	buildSongRows,
	flattenForTable,
	projectSong,
} from '../src/extractor.ts'
import {
	COLUMNS,
	type Column,
	type PlaylistVideo,
	type Song,
	type Track,
} from '../src/types.ts'

const columnsFor = (keys: (keyof Song)[]): Column[] =>
	keys.map((k) => COLUMNS.find((c) => c.key === k) as Column)

function makeSong(overrides: Partial<Song>): Song {
	return {
		position: '1',
		artists: ['A', 'B'],
		featuredArtists: [],
		songTitle: 'Song',
		mixType: 'original',
		genres: ['dubstep', 'trap'],
		rawTitle: 'A & B - Song',
		channel: ['Channel'],
		videoType: 'single',
		availability: 'available',
		duration: '3:00',
		videoId: 'vid',
		url: 'https://youtu.be/vid',
		thumbnail: '',
		parentVideoId: '',
		startTimestamp: '',
		...overrides,
	}
}

function makeVideo(overrides: Partial<PlaylistVideo>): PlaylistVideo {
	return {
		index: 1,
		rawTitle: 'Artist - Song',
		channel: ['Channel'],
		videoId: 'vid',
		url: 'https://youtu.be/vid',
		thumbnail: '',
		duration: '3:00',
		durationSeconds: 180,
		availability: 'available',
		videoType: 'single',
		isCandidate: false,
		...overrides,
	}
}

describe('projectSong', () => {
	it('devuelve sólo las columnas pedidas, en ese orden', () => {
		const out = projectSong(makeSong({}), columnsFor(['songTitle', 'position']))
		assert.deepEqual(Object.keys(out), ['songTitle', 'position'])
	})

	it('conserva los arrays como arrays (el JSON no aplana)', () => {
		const out = projectSong(makeSong({}), columnsFor(['genres']))
		assert.deepEqual(out.genres, ['dubstep', 'trap'])
	})
})

describe('flattenForTable', () => {
	it('une los arrays con "; " para CSV/XLSX', () => {
		const row = flattenForTable(makeSong({}), columnsFor(['artists', 'genres']))
		assert.equal(row.artists, 'A; B')
		assert.equal(row.genres, 'dubstep; trap')
	})

	it('convierte los vacíos en string vacío, no en "undefined"', () => {
		const row = flattenForTable(
			makeSong({ featuredArtists: [], parentVideoId: '' }),
			columnsFor(['featuredArtists', 'parentVideoId']),
		)
		assert.equal(row.featuredArtists, '')
		assert.equal(row.parentVideoId, '')
	})
})

describe('buildSongRows', () => {
	const tracks: Track[] = [
		{ trackIndex: 1, startTimestamp: '0:00', rawTrackTitle: 'Alpha - One' },
		{ trackIndex: 2, startTimestamp: '3:20', rawTrackTitle: 'Beta - Two' },
	]

	it('expande un candidato con tracklist en una fila por pista', () => {
		const video = makeVideo({ videoId: 'mix', isCandidate: true, index: 5 })
		const rows = buildSongRows([video], new Map([['mix', tracks]]))
		assert.equal(rows.length, 2)
		assert.deepEqual(
			rows.map((r) => r.position),
			['5.1', '5.2'],
		)
		assert.equal(rows[0].parentVideoId, 'mix')
	})

	it('deja el video como una sola fila si no se le encontró tracklist', () => {
		const video = makeVideo({ videoId: 'mix', isCandidate: true })
		const rows = buildSongRows([video], new Map())
		assert.equal(rows.length, 1)
		assert.equal(rows[0].position, '1')
	})

	it('nunca expande un video que no es candidato', () => {
		const video = makeVideo({ videoId: 'v', isCandidate: false })
		const rows = buildSongRows([video], new Map([['v', tracks]]))
		assert.equal(rows.length, 1)
	})
})
