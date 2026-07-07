const STORAGE_PREFIX = "profile-avatar:";
const DATABASE_NAME = "profile-avatar-db";
const STORE_NAME = "avatars";
const MAX_AVATAR_EDGE = 256;
const TARGET_AVATAR_BYTES = 140 * 1024;
const ENCODING_QUALITIES = [0.82, 0.68, 0.52];

let databasePromise = null;
let migrationPromise = null;

function getStorageKey(email) {
  return `${STORAGE_PREFIX}${String(email ?? "").trim().toLowerCase()}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function canUseIndexedDb() {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

function estimateDataUrlBytes(dataUrl) {
  const [, encoded = ""] = String(dataUrl ?? "").split(",");
  return Math.floor((encoded.length * 3) / 4);
}

function openDatabase() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, 1);

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("Unable to open avatar storage."));
      };
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

async function getFromIndexedDb(storageKey) {
  const database = await openDatabase().catch(() => null);

  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(storageKey);

    request.onsuccess = () => {
      resolve(typeof request.result === "string" ? request.result : null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to read the stored avatar."));
    };
  });
}

async function putInIndexedDb(storageKey, value) {
  const database = await openDatabase().catch(() => null);

  if (!database) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(value, storageKey);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to store the avatar."));
    };
  });
}

async function deleteFromIndexedDb(storageKey) {
  const database = await openDatabase().catch(() => null);

  if (!database) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(storageKey);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to clear the stored avatar."));
    };
  });
}

async function migrateLegacyAvatars() {
  if (!canUseStorage() || !canUseIndexedDb()) {
    return;
  }

  if (!migrationPromise) {
    migrationPromise = (async () => {
      const keys = [];

      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);

        if (key?.startsWith(STORAGE_PREFIX)) {
          keys.push(key);
        }
      }

      for (const key of keys) {
        const value = window.localStorage.getItem(key);

        if (!value) {
          window.localStorage.removeItem(key);
          continue;
        }

        await putInIndexedDb(key, value);
        window.localStorage.removeItem(key);
      }
    })().finally(() => {
      migrationPromise = null;
    });
  }

  await migrationPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = window.URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      window.URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      window.URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read the uploaded image."));
    };

    image.src = objectUrl;
  });
}

async function createOptimizedAvatar(file) {
  const image = await loadImage(file);
  const sideLength = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const sourceX = Math.max(0, ((image.naturalWidth || image.width) - sideLength) / 2);
  const sourceY = Math.max(0, ((image.naturalHeight || image.height) - sideLength) / 2);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to process the uploaded image.");
  }

  canvas.width = MAX_AVATAR_EDGE;
  canvas.height = MAX_AVATAR_EDGE;
  context.clearRect(0, 0, MAX_AVATAR_EDGE, MAX_AVATAR_EDGE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sideLength,
    sideLength,
    0,
    0,
    MAX_AVATAR_EDGE,
    MAX_AVATAR_EDGE,
  );

  let smallestAvatar = null;

  for (const quality of ENCODING_QUALITIES) {
    const nextAvatar = canvas.toDataURL("image/webp", quality);

    if (!smallestAvatar || nextAvatar.length < smallestAvatar.length) {
      smallestAvatar = nextAvatar;
    }

    if (estimateDataUrlBytes(nextAvatar) <= TARGET_AVATAR_BYTES) {
      return nextAvatar;
    }
  }

  return smallestAvatar ?? canvas.toDataURL("image/png");
}

async function persistAvatar(storageKey, avatarValue) {
  await migrateLegacyAvatars().catch(() => null);

  const storedInIndexedDb = await putInIndexedDb(storageKey, avatarValue).catch(() => false);

  if (storedInIndexedDb) {
    if (canUseStorage()) {
      window.localStorage.removeItem(storageKey);
    }
    return;
  }

  if (!canUseStorage()) {
    throw new Error("Unable to access browser storage for avatars.");
  }

  try {
    window.localStorage.setItem(storageKey, avatarValue);
  } catch (error) {
    if (error?.name === "QuotaExceededError") {
      throw new Error("Avatar storage is full in this browser. Please choose a smaller image.");
    }

    throw new Error("Unable to store the uploaded image.");
  }
}

async function getAvatar(email) {
  if (!email) {
    return null;
  }

  const storageKey = getStorageKey(email);
  await migrateLegacyAvatars().catch(() => null);

  const indexedDbAvatar = await getFromIndexedDb(storageKey).catch(() => null);

  if (indexedDbAvatar) {
    return indexedDbAvatar;
  }

  if (!canUseStorage()) {
    return null;
  }

  return window.localStorage.getItem(storageKey);
}

async function clearAvatar(email) {
  if (!email) {
    return;
  }

  const storageKey = getStorageKey(email);
  await deleteFromIndexedDb(storageKey).catch(() => null);

  if (canUseStorage()) {
    window.localStorage.removeItem(storageKey);
  }
}

async function storeAvatar(email, file) {
  if (!email) {
    throw new Error("Missing user email.");
  }

  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }

  const storageKey = getStorageKey(email);
  const nextAvatar = await createOptimizedAvatar(file);

  await persistAvatar(storageKey, nextAvatar);
  return nextAvatar;
}

function getFallbackInitial(email) {
  const normalized = String(email ?? "").trim();

  if (!normalized) {
    return "?";
  }

  return normalized.charAt(0).toUpperCase();
}

export const profileAvatarStorage = {
  getAvatar,
  storeAvatar,
  clearAvatar,
  getFallbackInitial,
};
