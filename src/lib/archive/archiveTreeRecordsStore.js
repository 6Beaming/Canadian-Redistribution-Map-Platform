import { getArchiveTreeRecords } from "@/services/workspaceApi.js";

export class ArchiveTreeRecordsStore {
  #listeners = new Set();

  #runGeneration = 0;

  #snapshot = {
    records: [],
    error: "",
    loaded: false,
  };

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getSnapshot() {
    return this.#snapshot;
  }

  async refresh() {
    const runId = this.#runGeneration + 1;
    this.#runGeneration = runId;
    try {
      const records = await getArchiveTreeRecords();
      if (runId !== this.#runGeneration) return this.#snapshot;
      this.#snapshot = { records, error: "", loaded: true };
      this.#notify();
      return this.#snapshot;
    } catch (error) {
      if (runId !== this.#runGeneration) return this.#snapshot;
      this.#snapshot = {
        records: this.#snapshot.records,
        error: error.message || "Archived records could not be loaded.",
        loaded: this.#snapshot.loaded || this.#snapshot.records.length > 0,
      };
      this.#notify();
      throw error;
    }
  }

  #notify() {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}

let sharedStore = null;

export function getArchiveTreeRecordsStore() {
  if (!sharedStore) {
    sharedStore = new ArchiveTreeRecordsStore();
  }
  return sharedStore;
}
