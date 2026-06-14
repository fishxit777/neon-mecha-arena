export const STORE_COLLECTIONS = Object.freeze(["sessions", "pilots", "events", "metrics", "assets"]);

export class MemoryProjectStore {
  constructor(collections = STORE_COLLECTIONS) {
    this.collections = new Map(collections.map((name) => [name, new Map()]));
  }

  ensureCollection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name);
  }

  put(collectionName, id, record) {
    if (!id) throw new TypeError("record id is required");
    const collection = this.ensureCollection(collectionName);
    const stored = cloneRecord(record);
    collection.set(id, stored);
    return cloneRecord(stored);
  }

  append(collectionName, record, id = record?.id) {
    return this.put(collectionName, id, record);
  }

  get(collectionName, id) {
    const record = this.ensureCollection(collectionName).get(id);
    return record ? cloneRecord(record) : null;
  }

  list(collectionName) {
    return [...this.ensureCollection(collectionName).values()].map(cloneRecord);
  }

  count(collectionName) {
    return this.ensureCollection(collectionName).size;
  }

  snapshot() {
    return Object.fromEntries([...this.collections.keys()].map((name) => [name, this.list(name)]));
  }
}

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
