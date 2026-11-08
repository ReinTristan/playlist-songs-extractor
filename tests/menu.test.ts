import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	ensureUrl,
	extractionMenuOptions,
	mainMenuOptions,
	settingsMenuOptions,
} from '../src/cli.ts'
import { EXTRACTION_GROUPS } from '../src/types.ts'
import makeConfig from './helpers/make-config.ts'

// Without `initI18n`, `t()` returns the key: that's why the assertions compare
// against keys and not against text in some language.

const values = (options: { value: string }[]) => options.map((o) => o.value)

describe('mainMenuOptions', () => {
	it('tiene las entradas en orden, con Extract primero y History oculto', () => {
		assert.deepEqual(values(mainMenuOptions(makeConfig({}))), [
			'extract',
			'extractionOptions',
			'settings',
			'quit',
		])
	})

	it('habilitar History lo muestra entre Extraction options y Settings', () => {
		assert.deepEqual(values(mainMenuOptions(makeConfig({}), true)), [
			'extract',
			'extractionOptions',
			'history',
			'settings',
			'quit',
		])
	})

	it('el hint de Extract es la URL actual', () => {
		const [extract] = mainMenuOptions(makeConfig({ fullUrl: 'https://x.test' }))
		assert.equal(extract.hint, 'https://x.test')
	})

	it('sin URL, el hint de Extract lo avisa', () => {
		const [extract] = mainMenuOptions(makeConfig({ fullUrl: '' }))
		assert.equal(extract.hint, 'hints.noUrl')
	})

	it('Extraction options no tiene hint', () => {
		const entry = mainMenuOptions(makeConfig({})).find(
			(o) => o.value === 'extractionOptions',
		)
		assert.ok(entry)
		assert.equal(entry.hint, undefined)
	})
})

describe('extractionMenuOptions', () => {
	const options = extractionMenuOptions(makeConfig({}))

	it('define los grupos y opciones que pide el spec', () => {
		assert.deepEqual(
			EXTRACTION_GROUPS.map((g) => [g.key, [...g.options]]),
			[
				['source', ['url', 'max']],
				['output', ['formats', 'columns', 'columnOrder']],
				[
					'songs',
					[
						'expand',
						'longVideo',
						'songOrder',
						'excludeUnavailable',
						'dedupe',
						'videoTypeFilter',
						'genreFilter',
					],
				],
			],
		)
	})

	it('es una lista plana: cada header seguido de sus opciones, y Back al final', () => {
		const expected = EXTRACTION_GROUPS.flatMap((g) => [
			`group:${g.key}`,
			...g.options,
		])
		assert.deepEqual(values(options), [...expected, 'back'])
	})

	it('sólo los headers quedan disabled, y llevan el nombre del grupo decorado', () => {
		const headers = options.filter((o) => o.disabled)
		assert.deepEqual(
			headers.map((o) => o.label),
			EXTRACTION_GROUPS.map((g) => `── menu.groups.${g.key} ──`),
		)
		assert.ok(headers.every((o) => o.value.startsWith('group:')))
	})

	it('toda opción tiene su label propio y un hint con el valor actual', () => {
		for (const group of EXTRACTION_GROUPS) {
			for (const key of group.options) {
				const option = options.find((o) => o.value === key)
				assert.ok(option, `falta ${key}`)
				assert.equal(option.label, `menu.${key}`)
				assert.ok(option.hint, `${key} sin hint`)
			}
		}
	})

	it('los hints reflejan la config', () => {
		const hintOf = (key: string, config = makeConfig({})) =>
			extractionMenuOptions(config).find((o) => o.value === key)?.hint

		assert.equal(hintOf('url', makeConfig({ fullUrl: '' })), 'hints.unset')
		assert.equal(
			hintOf('url', makeConfig({ fullUrl: 'https://x' })),
			'https://x',
		)
		assert.equal(
			hintOf('max', makeConfig({ allVideos: false, maxVideos: 7 })),
			'7',
		)
		assert.equal(hintOf('dedupe', makeConfig({ dedupe: true })), 'hints.yes')
		assert.equal(
			hintOf('expand', makeConfig({ expandAlbums: false })),
			'hints.no',
		)
		assert.equal(
			hintOf('genreFilter', makeConfig({ genreFilter: ['house', 'trance'] })),
			'house, trance',
		)
		assert.equal(hintOf('genreFilter'), 'hints.noFilter')
	})
})

describe('settingsMenuOptions', () => {
	it('tiene Language con su hint, y Back', () => {
		const options = settingsMenuOptions()
		assert.deepEqual(values(options), ['language', 'back'])
		assert.ok(options[0].hint)
	})
})

describe('ensureUrl', () => {
	it('con URL definida no pregunta', async () => {
		let asked = false
		const ok = await ensureUrl(
			makeConfig({ fullUrl: 'https://x' }),
			async () => {
				asked = true
			},
		)
		assert.equal(ok, true)
		assert.equal(asked, false)
	})

	it('sin URL pregunta, y sigue si el usuario la define', async () => {
		const config = makeConfig({ fullUrl: '' })
		const ok = await ensureUrl(config, async (c) => {
			c.fullUrl = 'https://x'
		})
		assert.equal(ok, true)
		assert.equal(config.fullUrl, 'https://x')
	})

	it('si el usuario cancela el prompt, no sigue', async () => {
		const ok = await ensureUrl(makeConfig({ fullUrl: '' }), async () => {})
		assert.equal(ok, false)
	})
})
