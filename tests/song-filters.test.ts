import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applySongFilters, dedupeSongs } from '../src/extractor.ts'
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

const noFilters = {
	videoTypeFilter: null,
	genreFilter: null,
	excludeUnavailable: false,
}

describe('dedupeSongs', () => {
	it('descarta el mismo video repetido y conserva la primera aparición', () => {
		const songs = [
			makeSong({ position: '1', videoId: 'a', songTitle: 'Uno' }),
			makeSong({ position: '2', videoId: 'b' }),
			makeSong({ position: '3', videoId: 'a', songTitle: 'Repetida' }),
		]
		const result = dedupeSongs(songs)
		assert.equal(result.length, 2)
		assert.deepEqual(
			result.map((s) => s.position),
			['1', '2'],
		)
		assert.equal(result[0].songTitle, 'Uno')
	})

	it('no colapsa las pistas expandidas de un mismo álbum', () => {
		// Comparten videoId; lo que las distingue es el startTimestamp.
		const songs = [
			makeSong({ position: '1.1', videoId: 'mix', startTimestamp: '0:00' }),
			makeSong({ position: '1.2', videoId: 'mix', startTimestamp: '3:20' }),
			makeSong({ position: '1.3', videoId: 'mix', startTimestamp: '7:05' }),
		]
		assert.equal(dedupeSongs(songs).length, 3)
	})

	it('nunca deduplica canciones sin videoId (no hay con qué distinguirlas)', () => {
		const songs = [
			makeSong({ position: '1', videoId: '', availability: 'unavailable' }),
			makeSong({ position: '2', videoId: '', availability: 'unavailable' }),
		]
		assert.equal(dedupeSongs(songs).length, 2)
	})
})

describe('applySongFilters', () => {
	const songs = [
		makeSong({ videoId: 'a', videoType: 'single', genres: ['dubstep'] }),
		makeSong({ videoId: 'b', videoType: 'mix', genres: ['deep house'] }),
		makeSong({ videoId: 'c', videoType: 'album', genres: [] }),
		makeSong({
			videoId: 'd',
			videoType: 'unknown',
			availability: 'unavailable',
		}),
	]

	it('sin filtros devuelve todo', () => {
		assert.equal(applySongFilters(songs, noFilters).length, 4)
	})

	it('filtra por tipo de video', () => {
		const result = applySongFilters(songs, {
			...noFilters,
			videoTypeFilter: ['single', 'mix'],
		})
		assert.deepEqual(
			result.map((s) => s.videoId),
			['a', 'b'],
		)
	})

	it('filtra por género sin distinguir mayúsculas', () => {
		const result = applySongFilters(songs, {
			...noFilters,
			genreFilter: ['Deep House'],
		})
		assert.deepEqual(
			result.map((s) => s.videoId),
			['b'],
		)
	})

	it('descarta las canciones sin ningún género cuando hay filtro de género', () => {
		const result = applySongFilters(songs, {
			...noFilters,
			genreFilter: ['dubstep'],
		})
		assert.deepEqual(
			result.map((s) => s.videoId),
			['a'],
		)
	})

	it('combina excludeUnavailable con los demás filtros', () => {
		const result = applySongFilters(songs, {
			videoTypeFilter: ['single', 'unknown'],
			genreFilter: null,
			excludeUnavailable: true,
		})
		assert.deepEqual(
			result.map((s) => s.videoId),
			['a'],
		)
	})
})
