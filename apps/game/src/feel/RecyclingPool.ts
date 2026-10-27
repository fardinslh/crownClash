/**
 * Fixed-size object pool that reuses the oldest busy item when exhausted.
 * Floating combat numbers used to create and destroy a Text per event,
 * which re-rasterises a new canvas each time on low-end Canvas renderers.
 */
export class RecyclingPool<T> {
  private readonly free: T[] = [];
  private readonly busy: T[] = [];
  private created = 0;

  constructor(private readonly create: () => T, private readonly max: number) {}

  /** `recycled` is true when a still-busy item was taken over. */
  acquire(): { item: T; recycled: boolean } {
    let item = this.free.pop();
    let recycled = false;
    if (item === undefined) {
      if (this.created < this.max) {
        item = this.create();
        this.created++;
      } else {
        item = this.busy.shift()!;
        recycled = true;
      }
    } else {
      this.removeBusy(item);
    }
    this.busy.push(item);
    return { item, recycled };
  }

  release(item: T): void {
    if (!this.removeBusy(item)) return;
    this.free.push(item);
  }

  get size(): number {
    return this.created;
  }

  private removeBusy(item: T): boolean {
    const index = this.busy.indexOf(item);
    if (index < 0) return false;
    this.busy.splice(index, 1);
    return true;
  }
}
