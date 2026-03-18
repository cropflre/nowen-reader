/**
 * IndexedDB 备份工具 — 为小说书签/划线提供持久化存储
 * 
 * localStorage 可能在清除浏览器数据时丢失，
 * IndexedDB 作为备份提供更好的数据持久性。
 * 读取优先级：localStorage > IndexedDB
 * 写入时同时写入两处。
 */

const DB_NAME = "nowen-reader-data";
const DB_VERSION = 1;
const STORE_NAME = "novel-data";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存数据到 IndexedDB（作为 localStorage 的备份）
 */
export async function idbSave(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(JSON.stringify(value), key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB 不可用时静默失败
  }
}

/**
 * 从 IndexedDB 读取数据（当 localStorage 为空时的降级方案）
 */
export async function idbLoad<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    const result = await new Promise<T>((resolve) => {
      request.onsuccess = () => {
        if (request.result) {
          try {
            resolve(JSON.parse(request.result as string) as T);
          } catch {
            resolve(fallback);
          }
        } else {
          resolve(fallback);
        }
      };
      request.onerror = () => resolve(fallback);
    });
    db.close();
    return result;
  } catch {
    return fallback;
  }
}
