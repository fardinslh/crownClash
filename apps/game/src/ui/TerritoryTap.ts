/** Coordinates are CSS pixels; render scale must not change the tap threshold. */
export class TerritoryTap {
    private press?: {
        id: string;
        x: number;
        y: number;
        time: number;
        distance: number;
    };
    begin(id: string, x: number, y: number, time: number): void { this.press = { id, x, y, time, distance: 0 }; }
    move(x: number, y: number): void {
        if (this.press)
            this.press.distance = Math.max(this.press.distance, Math.hypot(x - this.press.x, y - this.press.y));
    }
    finish(x: number, y: number, time: number, dispatchGesture: boolean): string | undefined {
        this.move(x, y);
        const press = this.press;
        this.press = undefined;
        return press && !dispatchGesture && time - press.time >= 0 && time - press.time <= 250 && press.distance < 10 ? press.id : undefined;
    }
    cancel(): void { this.press = undefined; }
}
