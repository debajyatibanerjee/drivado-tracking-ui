import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackingPoint } from '../types';

// FIFO of updates captured while offline. Persisted to AsyncStorage on every
// change, so it survives the app being killed or the phone restarting.
export class OfflineQueue {
  private items: TrackingPoint[] = [];
  private writing: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  // One queue per logged-in driver, stored under its own key.
  constructor(private readonly key: string) {
    this.ready = this.load();
  }

  private async load() {
    try {
      const raw = await AsyncStorage.getItem(this.key);
      this.items = raw ? JSON.parse(raw) : [];
    } catch {
      this.items = [];
    }
  }

  get size() {
    return this.items.length;
  }

  push(point: TrackingPoint) {
    this.items.push(point);
    this.persist();
  }

  peek(n: number): TrackingPoint[] {
    return this.items.slice(0, n);
  }

  drop(n: number) {
    this.items.splice(0, n);
    this.persist();
  }

  clear() {
    this.items = [];
    this.persist();
  }

  // Deletes the stored queue (when the driver logs out).
  async remove() {
    this.items = [];
    await this.writing;
    await AsyncStorage.removeItem(this.key).catch(() => {});
  }

  // Writes are chained so they land in order.
  private persist() {
    const json = JSON.stringify(this.items);
    this.writing = this.writing.then(() => AsyncStorage.setItem(this.key, json)).catch(() => {});
  }
}
