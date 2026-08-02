import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyVideoType } from '../src/extractor.ts'
import { durationToSeconds, sanitizeFilename } from '../src/utils.ts'

describe('durationToSeconds', () => {
	it('convierte mm:ss', () => assert.equal(durationToSeconds('3:30'), 210))
	it('convierte h:mm:ss', () =>
		assert.equal(durationToSeconds('1:02:30'), 3750))
	it('devuelve 0 para entrada inválida', () =>
		assert.equal(durationToSeconds(''), 0))
})

describe('classifyVideoType', () => {
	it('un video corto normal es single y no candidato', () => {
		assert.deepEqual(
			classifyVideoType('Artist - Song', durationToSeconds('3:30')),
			{
				videoType: 'single',
				isCandidate: false,
			},
		)
	})

	it('un video largo es candidato a expandir', () => {
		assert.equal(
			classifyVideoType('Best EDM Mix 2024', durationToSeconds('1:02:30'))
				.isCandidate,
			true,
		)
	})

	it('un video largo con "Full Album" se etiqueta como album', () => {
		assert.equal(
			classifyVideoType(
				'Daft Punk - Discovery (Full Album)',
				durationToSeconds('59:50'),
			).videoType,
			'album',
		)
	})

	it('un video largo sin keyword se abre pero no se etiqueta como album/mix', () => {
		// Un extended/concierto de 25 min es candidato (se intenta la tracklist),
		// pero sin keyword no hay motivo para llamarlo álbum ni mix en el export.
		assert.deepEqual(
			classifyVideoType('Artist - Song (Extended)', durationToSeconds('25:00')),
			{ videoType: 'single', isCandidate: true },
		)
	})

	it('una canción corta con (Remix) no es candidato', () => {
		assert.equal(
			classifyVideoType('Song (Tiësto Remix)', durationToSeconds('4:10'))
				.isCandidate,
			false,
		)
	})
})

describe('sanitizeFilename', () => {
	it('elimina caracteres inválidos para el sistema de archivos', () => {
		assert.equal(sanitizeFilename('My/Play:list*?"<>|'), 'MyPlaylist')
	})

	it('usa "playlist" como fallback para nombres vacíos', () => {
		assert.equal(sanitizeFilename('   '), 'playlist')
	})
})
