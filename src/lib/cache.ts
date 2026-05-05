/**
 * IndexedDB message cache using `idb` library
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'whisperbox';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';

interface CachedMessage {
  id: string;
  conversationUserId: string; // the other user
  fromMe: boolean;
  plaintext: string;
  created_at: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
          store.createIndex('by_conversation', 'conversationUserId');
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheMessage(msg: CachedMessage) {
  const db = await getDB();
  await db.put(STORE_MESSAGES, msg);
}

export async function getCachedMessages(conversationUserId: string): Promise<CachedMessage[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE_MESSAGES, 'by_conversation', conversationUserId);
  return (all as CachedMessage[]).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export async function clearCache() {
  const db = await getDB();
  await db.clear(STORE_MESSAGES);
}

export async function deleteMessage(id: string) {
  const db = await getDB();
  await db.delete(STORE_MESSAGES, id);
}

export async function editMessage(id: string, newPlaintext: string) {
  const db = await getDB();
  const msg = await db.get(STORE_MESSAGES, id);
  if (msg) {
    msg.plaintext = newPlaintext;
    await db.put(STORE_MESSAGES, msg);
  }
}
