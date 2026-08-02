import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runExtraction } from '../src/extractor.ts'
import type { ExtractConfig } from '../src/types.ts'
import makeConfig from './helpers/make-config.ts'

function baseConfig(): ExtractConfig {
	return makeConfig({
		fullUrl: 'https://youtube.com/playlist?list=X',
		formats: new Set(['json']),
		expandAlbums: false,
		columns: ['position', 'songTitle'],
	})
}

describe('runExtraction validación previa', () => {
	it('rechaza con formats vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.formats = new Set()
		await assert.rejects(() => runExtraction(config), /formats/i)
	})
	it('rechaza con columns vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.columns = []
		await assert.rejects(() => runExtraction(config), /columns/i)
	})
	it('rechaza con fullUrl vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.fullUrl = ''
		await assert.rejects(() => runExtraction(config), /fullUrl/i)
	})
})
