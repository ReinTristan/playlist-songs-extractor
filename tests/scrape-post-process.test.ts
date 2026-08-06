import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toPlaylistVideos } from '../src/extractor.ts'
import type { RawPlaylistVideo } from '../src/types.ts'

/** Un video crudo con valores por defecto razonables, para no repetir 9 campos. */
function rawVideo(over: Partial<RawPlaylistVideo> = {}): RawPlaylistVideo {
	return {
		index: 1,
		rawTitle: 'Artist - Song',
		chanAnchorTexts: ['SomeChannel'],
		metaRowText: '',
		videoId: 'abc123',
		url: 'https://www.youtube.com/watch?v=abc123',
		thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
		duration: '3:30',
		availability: 'available',
		...over,
	}
}

describe('toPlaylistVideos', () => {
	it('deriva durationSeconds del texto de la duración', () => {
		const [video] = toPlaylistVideos([rawVideo({ duration: '1:02:03' })], 1080)
		assert.equal(video.durationSeconds, 3723)
	})

	it('sin duración deja durationSeconds en 0', () => {
		const [video] = toPlaylistVideos([rawVideo({ duration: '' })], 1080)
		assert.equal(video.durationSeconds, 0)
	})

	it('clasifica un video corto normal como single no candidato', () => {
		const [video] = toPlaylistVideos([rawVideo()], 1080)
		assert.equal(video.videoType, 'single')
		assert.equal(video.isCandidate, false)
	})

	it('un video largo sin keyword es candidato pero sigue siendo single', () => {
		// Un extended de 25 min se abre para buscar tracklist, pero no es álbum ni mix.
		const [video] = toPlaylistVideos(
			[rawVideo({ rawTitle: 'Artist - Song (Extended)', duration: '25:00' })],
			1080,
		)
		assert.equal(video.videoType, 'single')
		assert.equal(video.isCandidate, true)
	})

	it('un video no disponible queda como unknown, sin clasificar', () => {
		// Sin título real no hay nada que clasificar: aplicar las heurísticas sobre
		// "[Private video]" sólo produce etiquetas inventadas.
		const [video] = toPlaylistVideos(
			[
				rawVideo({
					rawTitle: '[Private video]',
					availability: 'unavailable',
					duration: '',
					videoId: '',
				}),
			],
			1080,
		)
		assert.equal(video.videoType, 'unknown')
		assert.equal(video.isCandidate, false)
	})

	it('respeta un umbral de video largo distinto del default', () => {
		const raw = [rawVideo({ rawTitle: 'DJ Set 2024', duration: '10:00' })]
		assert.equal(toPlaylistVideos(raw, 1080)[0].isCandidate, false)
		assert.equal(toPlaylistVideos(raw, 300)[0].isCandidate, true)
	})

	it('resuelve el canal desde los anchors cuando existen', () => {
		const [video] = toPlaylistVideos(
			[
				rawVideo({
					chanAnchorTexts: ['NoCopyrightSounds'],
					metaRowText: 'Otra cosa',
				}),
			],
			1080,
		)
		assert.deepEqual(video.channel, ['NoCopyrightSounds'])
	})

	it('resuelve una colaboración sin anchors desde el texto de metadata', () => {
		const [video] = toPlaylistVideos(
			[rawVideo({ chanAnchorTexts: [], metaRowText: 'Alan Walker and Au/Ra' })],
			1080,
		)
		assert.deepEqual(video.channel, ['Alan Walker', 'Au/Ra'])
	})

	it('sin ninguna señal de canal devuelve un array vacío', () => {
		const [video] = toPlaylistVideos(
			[rawVideo({ chanAnchorTexts: [], metaRowText: '' })],
			1080,
		)
		assert.deepEqual(video.channel, [])
	})

	it('no expone las señales crudas en el video procesado', () => {
		const [video] = toPlaylistVideos([rawVideo()], 1080)
		assert.equal('chanAnchorTexts' in video, false)
		assert.equal('metaRowText' in video, false)
	})

	it('conserva el resto de los campos crudos tal cual', () => {
		const raw = rawVideo({ index: 7 })
		const [video] = toPlaylistVideos([raw], 1080)
		assert.equal(video.index, 7)
		assert.equal(video.rawTitle, raw.rawTitle)
		assert.equal(video.videoId, raw.videoId)
		assert.equal(video.url, raw.url)
		assert.equal(video.thumbnail, raw.thumbnail)
		assert.equal(video.duration, raw.duration)
		assert.equal(video.availability, 'available')
	})

	it('no muta la entrada', () => {
		const raw = rawVideo()
		const snapshot = structuredClone(raw)
		toPlaylistVideos([raw], 1080)
		assert.deepEqual(raw, snapshot)
	})

	it('procesa la lista entera respetando el orden', () => {
		const videos = toPlaylistVideos(
			[
				rawVideo({ index: 1, videoId: 'a' }),
				rawVideo({ index: 2, videoId: 'b' }),
				rawVideo({ index: 3, videoId: 'c' }),
			],
			1080,
		)
		assert.deepEqual(
			videos.map((v) => v.videoId),
			['a', 'b', 'c'],
		)
	})

	it('con una lista vacía devuelve una lista vacía', () => {
		assert.deepEqual(toPlaylistVideos([], 1080), [])
	})
})
