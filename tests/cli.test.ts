import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
	normalizeUrl,
	parseFlags,
	parseLangFlag,
	parsePositiveInt,
} from '../src/utils.ts'

/**
 * El CLI se spawnea con idioma fijo y un conf aislado: así las aserciones no
 * dependen ni del locale del sistema ni de la preferencia guardada del usuario
 * que corre los tests.
 */
function runCli(args: string[]) {
	return spawnSync('node', ['src/index.ts', ...args], {
		stdio: 'pipe',
		timeout: 20000,
		env: {
			...process.env,
			PLAYLIST_LANG: 'en',
			PLAYLIST_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'ple-test-')),
		},
	})
}

describe('cli main() sin TTY y sin argv ', () => {
	it('sale con código 1 e imprime uso cuando no hay argv ni TTY', () => {
		const result = runCli([])
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /usage/i)
	})
})

describe('cli main() con locale inválido', () => {
	it('sale con código 1 y lista los idiomas disponibles', () => {
		const result = runCli(['--lang=de', 'https://youtube.com/playlist?list=X'])
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /unsupported language/i)
	})
})

describe('cli main() con límite inválido', () => {
	it('sale con código 1 sin abrir el navegador', () => {
		const result = runCli(['https://youtube.com/playlist?list=X', 'todos'])
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /invalid limit/i)
	})
})

describe('parsePositiveInt', () => {
	it('acepta enteros >= 1', () => {
		assert.equal(parsePositiveInt('5'), 5)
		assert.equal(parsePositiveInt('1'), 1)
		assert.equal(parsePositiveInt(' 10 '), 10)
	})
	it('rechaza vacío y espacios (el "todos" ahora es allVideos, no una palabra)', () => {
		assert.equal(parsePositiveInt(''), null)
		assert.equal(parsePositiveInt(' '), null)
		assert.equal(parsePositiveInt(undefined), null)
		assert.equal(parsePositiveInt(null), null)
	})
	it('rechaza las palabras que antes significaban "sin límite"', () => {
		assert.equal(parsePositiveInt('todos'), null)
		assert.equal(parsePositiveInt('all'), null)
	})
	it('rechaza "0", negativos y no numéricos', () => {
		assert.equal(parsePositiveInt('0'), null)
		assert.equal(parsePositiveInt('-3'), null)
		assert.equal(parsePositiveInt('abc'), null)
		assert.equal(parsePositiveInt('1.5'), null)
	})
})

describe('parseLangFlag', () => {
	it('lee --lang=<code> y lo saca de los posicionales', () => {
		assert.deepEqual(parseLangFlag(['URL', '10', '--lang=fr']), {
			lang: 'fr',
			rest: ['URL', '10'],
		})
	})
	it('lee --lang <code> como dos argumentos', () => {
		assert.deepEqual(parseLangFlag(['--lang', 'es', 'URL']), {
			lang: 'es',
			rest: ['URL'],
		})
	})
	it('acepta el alias --locale', () => {
		assert.deepEqual(parseLangFlag(['--locale=en', 'URL']), {
			lang: 'en',
			rest: ['URL'],
		})
	})
	it('funciona con el flag antes de los posicionales sin alterar su orden', () => {
		assert.deepEqual(parseLangFlag(['--lang=fr', 'URL', '10']), {
			lang: 'fr',
			rest: ['URL', '10'],
		})
	})
	it('sin flag deja el argv intacto', () => {
		assert.deepEqual(parseLangFlag(['URL', '10']), {
			lang: undefined,
			rest: ['URL', '10'],
		})
	})
})

describe('parseFlags', () => {
	it('lee --flag=valor y deja los posicionales intactos', () => {
		const { flags, rest } = parseFlags(['URL', '--formats=json,csv', '10'])
		assert.equal(flags.get('formats'), 'json,csv')
		assert.deepEqual(rest, ['URL', '10'])
	})

	it('un flag sin valor queda en true', () => {
		const { flags, rest } = parseFlags(['URL', '--dedupe'])
		assert.equal(flags.get('dedupe'), true)
		assert.deepEqual(rest, ['URL'])
	})

	it('sólo los flags declarados con valor consumen el argumento siguiente', () => {
		// Sin la lista, "--dedupe" se comería la URL.
		const { flags, rest } = parseFlags(['--dedupe', 'URL'], ['lang'])
		assert.equal(flags.get('dedupe'), true)
		assert.deepEqual(rest, ['URL'])
	})

	it('acepta --flag valor para los declarados con valor', () => {
		const { flags, rest } = parseFlags(['--lang', 'fr', 'URL'], ['lang'])
		assert.equal(flags.get('lang'), 'fr')
		assert.deepEqual(rest, ['URL'])
	})

	it('sin flags devuelve el argv como posicionales', () => {
		const { flags, rest } = parseFlags(['URL', '10'])
		assert.equal(flags.size, 0)
		assert.deepEqual(rest, ['URL', '10'])
	})
})

describe('cli main() con flags inválidos', () => {
	it('sale con código 1 ante un valor no soportado', () => {
		const result = runCli([
			'https://youtube.com/playlist?list=X',
			'--formats=pdf',
		])
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /invalid value for --formats/i)
	})

	it('sale con código 1 ante una opción desconocida', () => {
		const result = runCli(['https://youtube.com/playlist?list=X', '--turbo'])
		assert.equal(result.status, 1)
		assert.match(result.stderr.toString(), /unknown option/i)
	})
})

describe('normalizeUrl)', () => {
	it('deja pasar URLs completas con esquema', () => {
		assert.equal(
			normalizeUrl('https://www.youtube.com/playlist?list=X'),
			'https://www.youtube.com/playlist?list=X',
		)
	})
	it('antepone https:// cuando falta el esquema', () => {
		assert.equal(
			normalizeUrl('www.youtube.com/playlist?list=X'),
			'https://www.youtube.com/playlist?list=X',
		)
	})
	it('antepone https:// a youtu.be sin esquema', () => {
		assert.equal(normalizeUrl('youtu.be/abc123'), 'https://youtu.be/abc123')
	})
	it('construye la URL completa a partir de un ID suelto', () => {
		assert.equal(
			normalizeUrl('PLxxxx'),
			'https://youtube.com/playlist?list=PLxxxx',
		)
	})
	it('vacío devuelve vacío', () => {
		assert.equal(normalizeUrl('  '), '')
	})
})
