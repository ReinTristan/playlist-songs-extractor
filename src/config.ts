/**
 * Preferencias persistentes del usuario (hoy: el idioma elegido).
 *
 * Envuelve `conf` para que el resto del código no dependa de su API. El store
 * se crea de forma perezosa: importar este módulo no debe tocar el disco (a
 * `src/index.ts` lo spawnean los tests). `PLAYLIST_CONFIG_DIR` permite apuntar
 * el store a un directorio temporal en las pruebas.
 */

import Conf from 'conf'

interface StoreShape {
	locale?: string
}

let store: Conf<StoreShape> | null = null

function getStore(): Conf<StoreShape> {
	store ??= new Conf<StoreShape>({
		projectName: 'playlist-extractor',
		cwd: process.env.PLAYLIST_CONFIG_DIR || undefined,
	})
	return store
}

/** Locale guardado en una corrida anterior, o `undefined` si nunca se eligió. */
export function getSavedLocale(): string | undefined {
	return getStore().get('locale')
}

export function setSavedLocale(locale: string): void {
	getStore().set('locale', locale)
}

/** `false` la primera vez que se abre el CLI: dispara el prompt de idioma. */
export function hasSavedLocale(): boolean {
	return getStore().has('locale')
}

/** Ruta del archivo de configuración (para mostrarla en el CLI). */
export function configPath(): string {
	return getStore().path
}
