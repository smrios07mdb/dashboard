import '@testing-library/jest-dom/vitest'

// jsdom 29's localStorage relies on Node's experimental --localstorage-file
// flag, which isn't wired up here. Swap in a simple in-memory Storage that
// behaves correctly for unit tests.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}
Object.defineProperty(window, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
Object.defineProperty(window, 'sessionStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
