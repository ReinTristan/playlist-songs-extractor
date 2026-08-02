import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

/**
 * El store de `conf` se apunta a un directorio temporal ANTES de importar
 * `config.ts`: el módulo lo crea de forma perezosa, así que basta con setear
 * la variable antes del primer acceso para no tocar la preferencia real.
 */
process.env.PLAYLIST_CONFIG_DIR = mkdtempSync(
	path.join(tmpdir(), 'ple-config-test-'),
)

const {
	getRecentUrls,
	getSavedConfig,
	pushRecentUrl,
	sanitizeConfig,
	setSavedConfig,
} = await import('../src/config.ts')
const { COLUMNS, FORMATS } = await import('../src/types.ts')
const { default: makeConfig } = await import('./helpers/make-config.ts')

describe('sanitizeConfig', () => {
	it('devuelve vacío para entradas inexistentes o no-objeto', () => {
		assert.deepEqual(sanitizeConfig(undefined), {})
	})

	it('descarta formatos y columnas que ya no existen', () => {
		const result = sanitizeConfig({
			formats: ['json', 'pdf'] as never,
			columns: ['position', 'inventada'] as never,
		})
		assert.deepEqual(result.formats, ['json'])
		assert.deepEqual(result.columns, ['position'])
	})

	it('omite la lista entera si no queda ningún valor válido', () => {
		const result = sanitizeConfig({ formats: ['pdf'] as never })
		assert.equal(result.formats, undefined)
	})

	it('descarta un songOrder desconocido pero conserva el resto', () => {
		const result = sanitizeConfig({
			songOrder: 'al-azar' as never,
			dedupe: true,
		})
		assert.equal(result.songOrder, undefined)
		assert.equal(result.dedupe, true)
	})

	it('rechaza umbrales y límites que no son enteros ≥ 1', () => {
		assert.equal(
			sanitizeConfig({ longVideoSeconds: 0 }).longVideoSeconds,
			undefined,
		)
		assert.equal(sanitizeConfig({ maxVideos: -5 }).maxVideos, undefined)
		assert.equal(sanitizeConfig({ maxVideos: 2.5 }).maxVideos, undefined)
	})

	it('conserva null como "sin filtro" y valida los tipos de video', () => {
		assert.equal(
			sanitizeConfig({ videoTypeFilter: null }).videoTypeFilter,
			null,
		)
		assert.deepEqual(
			sanitizeConfig({ videoTypeFilter: ['mix'] }).videoTypeFilter,
			['mix'],
		)
		assert.equal(
			sanitizeConfig({ videoTypeFilter: ['pelicula'] as never })
				.videoTypeFilter,
			undefined,
		)
	})
})

describe('setSavedConfig / getSavedConfig', () => {
	it('hace round-trip y rehidrata formats como Set-compatible', () => {
		setSavedConfig(
			makeConfig({
				formats: new Set(['json', 'csv']),
				columns: ['position', 'songTitle'],
				dedupe: true,
				longVideoSeconds: 600,
				genreFilter: ['dubstep'],
			}),
		)
		const saved = getSavedConfig()
		// Se guarda como array: un Set no sobrevive al JSON del store.
		assert.deepEqual(saved.formats, ['json', 'csv'])
		assert.deepEqual(saved.columns, ['position', 'songTitle'])
		assert.equal(saved.dedupe, true)
		assert.equal(saved.longVideoSeconds, 600)
		assert.deepEqual(saved.genreFilter, ['dubstep'])
	})

	it('lo guardado es válido para la versión actual', () => {
		setSavedConfig(makeConfig({}))
		const saved = getSavedConfig()
		const columnKeys = COLUMNS.map((c) => c.key)
		assert.ok(saved.formats?.every((f) => FORMATS.includes(f)))
		assert.ok(saved.columns?.every((c) => columnKeys.includes(c)))
	})
})

describe('recentUrls', () => {
	it('guarda la más reciente primero, sin repetidos, con tope de 10', () => {
		for (let i = 1; i <= 12; i++) pushRecentUrl(`https://yt/p?list=${i}`)
		pushRecentUrl('https://yt/p?list=5') // repetida: sube al frente, no duplica
		const urls = getRecentUrls()
		assert.equal(urls.length, 10)
		assert.equal(urls[0], 'https://yt/p?list=5')
		assert.equal(new Set(urls).size, urls.length)
	})

	it('ignora las URLs vacías', () => {
		const before = getRecentUrls().length
		pushRecentUrl('   ')
		assert.equal(getRecentUrls().length, before)
	})
})
