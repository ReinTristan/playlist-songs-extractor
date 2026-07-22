import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applySongOrder } from '../src/extractor.ts'
import type { Song } from '../src/types.ts'

function makeSong(overrides: Partial<Song>): Song {
	return {
		position: '1',
		artists: [],
		featuredArtists: [],
		songTitle: '',
		mixType: '',
		genres: [],
		rawTitle: '',
		channel: ['Channel'],
		videoType: 'single',
		availability: 'available',
		duration: '3:00',
		videoId: '',
		url: '',
		thumbnail: '',
		parentVideoId: '',
		startTimestamp: '',
		...overrides,
	}
}

const songs = [
	makeSong({ position: '1', videoId: 'a', songTitle: 'Banana' }),
	makeSong({ position: '2', videoId: 'b', songTitle: 'Apple' }),
	makeSong({ position: '3', videoId: 'c', songTitle: 'Cherry' }),
]

describe('applySongOrder', () => {
	it('"original" no modifica el arreglo ni las posiciones', () => {
		const result = applySongOrder(songs, 'original')
		assert.deepEqual(
			result.map((s) => s.videoId),
			['a', 'b', 'c'],
		)
		assert.deepEqual(
			result.map((s) => s.position),
			['1', '2', '3'],
		)
	})

	it('"reverse" invierte el orden y renumera position', () => {
		const result = applySongOrder(songs, 'reverse')
		assert.deepEqual(
			result.map((s) => s.videoId),
			['c', 'b', 'a'],
		)
		assert.deepEqual(
			result.map((s) => s.position),
			['1', '2', '3'],
		)
	})

	it('"alphabetical-asc" ordena por songTitle y renumera position', () => {
		const result = applySongOrder(songs, 'alphabetical-asc')
		assert.deepEqual(
			result.map((s) => s.videoId),
			['b', 'a', 'c'],
		)
		assert.deepEqual(
			result.map((s) => s.position),
			['1', '2', '3'],
		)
	})

	it('"alphabetical-desc" es el inverso exacto de "alphabetical-asc"', () => {
		const asc = applySongOrder(songs, 'alphabetical-asc')
		const desc = applySongOrder(songs, 'alphabetical-desc')
		assert.deepEqual(
			desc.map((s) => s.videoId),
			[...asc.map((s) => s.videoId)].reverse(),
		)
	})

	it('"shuffle" mantiene el mismo conjunto de canciones y renumera position', () => {
		const result = applySongOrder(songs, 'shuffle')
		assert.deepEqual(
			new Set(result.map((s) => s.videoId)),
			new Set(['a', 'b', 'c']),
		)
		assert.deepEqual(
			result.map((s) => s.position),
			['1', '2', '3'],
		)
	})
})
