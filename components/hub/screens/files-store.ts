"use client";

import { useState } from "react";
import { createDownloadUrl, createDownloadUrls, createFolder, deleteFolder, moveFiles, renameFolder, type ActionResult } from "@/lib/hub-files/actions";
import { cleanFolderName } from "@/lib/hub-files/catalog";
import type { HubFilesState, HubFolder, HubStoredFile } from "@/lib/hub-files/types";
import { downloadAsZip } from "@/lib/hub-files/zip";

export type FilesStore = ReturnType<typeof useFilesStore>;

const done = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const zipName = () => `oalab-dateien-${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date())}.zip`;

/**
 * Folders, moves and downloads of the files page. Real logins change folders through server actions
 * (the page refreshes with the new data); the preview and the public demo keep their changes in this tab.
 */
export function useFilesStore(state: HubFilesState) {
  const live = state.source === "supabase";
  const [localFolders, setLocalFolders] = useState(state.folders);
  const [localFiles, setLocalFiles] = useState(state.files);
  const folders = live ? state.folders : localFolders;
  const files = live ? state.files : localFiles;

  const place = (fileIds: string[], customerId: string, folderId: string | null) => setLocalFiles((list) => list.map((file) => {
    if (!fileIds.includes(file.id)) return file;
    const folderIds = { ...file.folderIds };
    if (folderId) folderIds[customerId] = folderId; else delete folderIds[customerId];
    return { ...file, folderIds };
  }));

  async function addFolder(customerId: string, name: string): Promise<ActionResult<{ id: string; name: string }>> {
    if (live) return createFolder(customerId, name);
    const clean = cleanFolderName(name);
    if (!clean.ok) return clean;
    if (localFolders.some((folder) => folder.customerId === customerId && folder.name === clean.name)) return { ok: false, error: "Einen Ordner mit diesem Namen gibt es schon." };
    const folder: HubFolder = { id: `local-${Date.now()}`, customerId, name: clean.name };
    setLocalFolders((list) => [...list, folder]);
    return done({ id: folder.id, name: folder.name });
  }

  async function rename(folder: HubFolder, name: string): Promise<ActionResult<{ name: string }>> {
    if (live) return renameFolder(folder.id, name);
    const clean = cleanFolderName(name);
    if (!clean.ok) return clean;
    if (localFolders.some((item) => item.id !== folder.id && item.customerId === folder.customerId && item.name === clean.name)) return { ok: false, error: "Einen Ordner mit diesem Namen gibt es schon." };
    setLocalFolders((list) => list.map((item) => item.id === folder.id ? { ...item, name: clean.name } : item));
    return done({ name: clean.name });
  }

  async function remove(folder: HubFolder): Promise<ActionResult<null>> {
    if (live) return deleteFolder(folder.id);
    place(localFiles.filter((file) => file.folderIds[folder.customerId] === folder.id).map((file) => file.id), folder.customerId, null);
    setLocalFolders((list) => list.filter((item) => item.id !== folder.id));
    return done(null);
  }

  async function move(fileIds: string[], customerId: string, folderId: string | null): Promise<ActionResult<{ count: number }>> {
    if (live) return moveFiles(fileIds, customerId, folderId);
    place(fileIds, customerId, folderId);
    return done({ count: fileIds.length });
  }

  /** One file downloads directly; several become a ZIP built in the browser. */
  async function download(selection: HubStoredFile[]): Promise<ActionResult<null>> {
    try {
      if (selection.length === 1 && !selection[0].sampleHref) {
        const result = await createDownloadUrl(selection[0].id);
        if (!result.ok) return result;
        window.location.assign(result.data.url);
        return done(null);
      }
      const samples = selection.filter((file) => file.sampleHref).map((file) => ({ url: file.sampleHref!, fileName: file.fileName }));
      const real = selection.filter((file) => !file.sampleHref);
      const signed = real.length ? await createDownloadUrls(real.map((file) => file.id)) : done([]);
      if (!signed.ok) return signed;
      await downloadAsZip([...samples, ...signed.data.map(({ url, fileName }) => ({ url, fileName }))], zipName());
      return done(null);
    } catch (failure) {
      return { ok: false, error: failure instanceof Error ? failure.message : "Der Download ist fehlgeschlagen." };
    }
  }

  return { live, files, folders, addFolder, rename, remove, move, download };
}
