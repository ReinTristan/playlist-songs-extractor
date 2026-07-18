import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trackToSong, videoToSong } from '../src/extractor.ts'

const video = {
	index: 1,
	rawTitle: 'Some Title Without Dash',
	channel: 'SomeChannel',
	videoId: 'abc',
	url: 'https://youtube.com/watch?v=abc',
	thumbnail: '',
	duration: '10:00',
	durationSeconds: 600,
	availability: 'available' as const,
	videoType: 'single' as const,
	isCandidate: false,
}

describe('artists fallback a canal', () => {
	it('videoToSong usa el canal como fallback cuando no hay artista detectable', () => {
		const song = videoToSong(video)
		assert.deepEqual(song.artists, ['SomeChannel'])
	})
	it('trackToSong también debería usar el canal como fallback (paridad con videoToSong)', () => {
		const track = {
			trackIndex: 1,
			startTimestamp: '',
			rawTrackTitle: 'Untitled Track',
		}
		const song = trackToSong(video, track)
		assert.deepEqual(song.artists, ['SomeChannel'])
	})
})
