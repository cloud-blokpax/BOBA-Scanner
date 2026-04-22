/**
 * Bounded concurrency for per-cell OCR during binder-mode live scanning.
 *
 * Each binder cell enqueues OCR jobs every live cycle (~2fps). Without
 * a pool, a 3×3 grid with slow cells would pile up 9 concurrent OCR
 * calls every 500ms and starve the main thread. This pool caps in-flight
 * jobs and supersedes stale jobs for the same cell so the queue can't
 * build an unbounded backlog when one cell is consistently slow.
 *
 * Concurrency is device-adaptive: phones with low `navigator.deviceMemory`
 * run fewer workers. OCR work is ultimately serialized on a single
 * PaddleOCR instance — the pool mainly protects against submission
 * pileups, not CPU oversubscription.
 */

interface OCRJob<T> {
	id: string;
	work: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
}

export class OCRWorkerPool {
	private maxConcurrent: number;
	private inFlight = 0;
	private queue: OCRJob<unknown>[] = [];
	private lastJobByCell = new Map<string, OCRJob<unknown>>();

	constructor(maxConcurrent: number) {
		this.maxConcurrent = maxConcurrent;
	}

	/**
	 * Submit a unit of OCR work for a given cell key. If a previous job
	 * for the same key is still queued, it is superseded — only the
	 * newest frame for a cell matters.
	 */
	submit<T>(cellKey: string, work: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const job: OCRJob<T> = {
				id: `${cellKey}-${performance.now()}`,
				work,
				resolve,
				reject
			};
			const existing = this.lastJobByCell.get(cellKey);
			if (existing && this.queue.includes(existing as OCRJob<unknown>)) {
				existing.reject(new Error('superseded'));
				this.queue = this.queue.filter((j) => j !== existing);
			}
			this.lastJobByCell.set(cellKey, job as OCRJob<unknown>);
			this.queue.push(job as OCRJob<unknown>);
			this.drain();
		});
	}

	private drain(): void {
		while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
			const job = this.queue.shift();
			if (!job) return;
			this.inFlight++;
			job
				.work()
				.then((r) => job.resolve(r))
				.catch((e) => job.reject(e))
				.finally(() => {
					this.inFlight--;
					// Clean up the last-job pointer only if it still references
					// THIS job. A newer submit may have replaced the entry while
					// we were running — in that case, leave the newer pointer
					// alone.
					const cellKey = this.findCellKeyForJob(job);
					if (cellKey !== null && this.lastJobByCell.get(cellKey) === job) {
						this.lastJobByCell.delete(cellKey);
					}
					this.drain();
				});
		}
	}

	private findCellKeyForJob(job: OCRJob<unknown>): string | null {
		for (const [k, v] of this.lastJobByCell) {
			if (v === job) return k;
		}
		return null;
	}

	pause(): void {
		this.maxConcurrent = 0;
	}

	resume(maxConcurrent: number): void {
		this.maxConcurrent = maxConcurrent;
		this.drain();
	}
}

/**
 * 2 workers on low-mem devices (<=3GB), 3 on mid-tier (<=6GB), 4 otherwise.
 * `navigator.deviceMemory` is Chrome/Edge only; absent on Safari/Firefox
 * where we default to 3 — a conservative middle ground.
 */
export function deriveMaxConcurrent(): number {
	const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
	if (typeof mem !== 'number') return 3;
	if (mem <= 3) return 2;
	if (mem <= 6) return 3;
	return 4;
}
