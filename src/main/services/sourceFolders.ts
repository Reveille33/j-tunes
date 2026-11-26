import { isAbsolute, relative, resolve } from 'node:path'

/** True when `target` is the folder or a file inside it. */
export function isInsideFolder(folder: string, target: string): boolean {
  const rel = relative(resolve(folder), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Which files unsubscribe may trash, and whether the download folder may be removed.
 *
 * A source folder and every file inside one stay on disk.
 */
export function unsubscribeTrashPlan(input: {
  filePaths: string[]
  sourceFolders: string[]
  downloadFolder: string
}): { trash: string[]; removeDownloadFolder: boolean } {
  const trash = input.filePaths.filter(
    (file) => !input.sourceFolders.some((folder) => isInsideFolder(folder, file))
  )
  const removeDownloadFolder = !input.sourceFolders.some(
    (folder) =>
      isInsideFolder(folder, input.downloadFolder) || isInsideFolder(input.downloadFolder, folder)
  )
  return { trash, removeDownloadFolder }
}
