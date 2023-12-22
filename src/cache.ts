import path from 'node:path'
import process from 'node:process'
import fs from 'fs-extra'
import { readPackageUp } from 'read-package-up'
import { hash } from 'ohash'
import type { BaseLogger, BaseResult, PluginInput } from '.'

const defaultCacheDirName = '.export-cache'

/** Returns a computed path to the cache directory - this may or may not exist. */
export async function getCacheDir(cacheDirName: string = defaultCacheDirName) {
  const likelyProjectRoot = await readPackageUp({ cwd: process.cwd(), normalize: true })

  if (!likelyProjectRoot) {
    return path.join(process.cwd(), cacheDirName)
  }

  const { dir } = path.parse(likelyProjectRoot.path)

  return path.join(dir, cacheDirName)
}

/** Ensure the cache directory exists, and return the path. */
async function loadCacheDir(customName?: string) {
  const cacheDirPath = await getCacheDir(customName)
  await fs.ensureDir(cacheDirPath)
  return cacheDirPath
}

/**
 * Creates a hash for a specific input operation.
 * This uses the input query, input variables, and the input store name + API version
 * to create the hash key.
 */
function createHash(input: PluginInput) {
  return hash({
    query: input.query,
    variables: input.variables,
    store: {
      name: input.store.name,
      apiVersion: input.store.apiVersion,
    },
  })
}

/** Loads all files in a cache directory, and adds them to a map. */
async function loadCacheMap(cacheDirPath: string): Promise<Map<string, string>> {
  const cacheDirFiles = await fs.readdir(cacheDirPath, { withFileTypes: true })

  const cacheFileKeys = cacheDirFiles.flatMap((file): [string, string][] => {
    if (!file.isFile()) {
      return []
    }

    const { name, ext } = path.parse(file.name)
    // May need to improve this check in future
    if (ext !== '.json') {
      return []
    }

    return [
      [name, path.join(cacheDirPath, file.name)],
    ]
  })

  return new Map(cacheFileKeys)
}

interface Cache {
  /** Create a hash for an operation */
  createHash: (input: PluginInput) => string
  /** Save a result to cache */
  put: (input: PluginInput, data: unknown[]) => Promise<void>
  /** Load a result from cache */
  get: <T>(input: PluginInput) => Promise<Array<BaseResult<T>> | undefined>
}

/**
 * A simple helper that creates a cache instance, and returns helper methods.
 * If the cache is disabled, then the helper methods can still be called, but they won't do anything.
 */
export async function createCache(options: PluginInput['cache'], logger: BaseLogger): Promise<Cache> {
  const enabled = typeof options === 'boolean' ? options : true
  const customCacheDir = typeof options === 'string' ? options : undefined

  // Cache is disabled, so return mocks
  if (!enabled) {
    logger.debug('Cache is disabled - mocking functionality.')
    return {
      createHash,
      put: async () => {},
      get: async () => undefined,
    }
  }

  // Ensure we have a cache directory
  const cacheDirPath = await loadCacheDir(customCacheDir)
  logger.debug(`Loaded cache directory at: ${cacheDirPath}`)

  // Load all file paths in cache directory, and save to map
  const cacheKeyMap = await loadCacheMap(cacheDirPath)
  logger.debug(`Loaded cache map with ${cacheKeyMap.size} entries`)

  return {
    createHash,
    get: async (input) => {
      const inputHash = createHash(input)

      const cachedFilePath = cacheKeyMap.get(inputHash)
      if (!cachedFilePath) { return }

      logger.debug(`Found cache item at ${cachedFilePath} for key ${inputHash}, loading item`)

      const data = await fs.readFile(cachedFilePath, 'utf-8')
      return JSON.parse(data)
    },
    put: async (input, data) => {
      const inputHash = createHash(input)

      const cachedFilePath = path.format({
        dir: cacheDirPath,
        ext: '.json',
        name: inputHash,
      })

      logger.debug(`Saving file to cache, with key ${inputHash} and path ${cacheDirPath}`)

      await fs.writeFile(cachedFilePath, JSON.stringify(data))
    },
  }
}
