import type { UsageViewModel } from "./view-model.js";

// ---------------------------------------------------------------------------
// PURE lifecycle controller (plan §4/§6 Step 1). Imports only the VM type
// (`import type` from ./view-model.js), so it loads under vitest-on-Node. All
// side effects (time, scheduling, rendering, overlay) enter through injected
// ports, so the whole latest-wins / generation-guard / never-reject contract is
// unit-testable with fakes and no real omp.
// ---------------------------------------------------------------------------

export interface Clock {
	now(): number;
}

/**
 * Opaque interval handle. Names the owning `NodeJS.Timeout` directly (the real
 * `setInterval` return) plus the browser `number` form and a branded fallback,
 * so the injected scheduler can hand back any of them.
 */
export type IntervalHandle = NodeJS.Timeout | number | { __brand: "interval" };

export interface Scheduler {
	setInterval(fn: () => void, ms: number): IntervalHandle;
	clearInterval(h: IntervalHandle): void;
}

export interface UsageWidgetSink {
	renderCollapsed(vm: UsageViewModel): void;
	openExpanded(getVm: () => UsageViewModel | undefined, onClose: () => void): void;
	closeExpanded(): void;
	clear(): void;
}

export type UsageLoader = (now: number, signal: AbortSignal) => Promise<UsageViewModel>;

export interface Reporter {
	report(key: string, err: unknown): void;
	reset(): void;
}

export interface UsageControllerDeps {
	clock: Clock;
	scheduler: Scheduler;
	sink: UsageWidgetSink;
	load: UsageLoader;
	reporter: Reporter;
	intervalMs: number;
	makeAbort: () => AbortController;
}

export interface UsageBarController {
	start(): void;
	refresh(reason: string): Promise<void>;
	toggleExpanded(): void;
	isExpanded(): boolean;
	stop(): void;
}

/** Create the injected-port lifecycle controller (pure; no real time/omp). */
export function createUsageBarController(deps: UsageControllerDeps): UsageBarController {
	const { clock, scheduler, sink, load, reporter, intervalMs, makeAbort } = deps;

	let epoch = 0;
	let running = false;
	let abort: AbortController | undefined;
	let intervalHandle: IntervalHandle | undefined;
	let vm: UsageViewModel | undefined;
	let expanded = false;
	let overlayOpen = false;
	let overlayGeneration = 0;

	// The single programmatic overlay-close owner. Early-returns when nothing is
	// open so the empty path never calls sink.closeExpanded needlessly.
	const forceCloseExpanded = (): void => {
		if (!expanded && !overlayOpen) return;
		expanded = false;
		overlayOpen = false;
		++overlayGeneration;
		sink.closeExpanded();
	};

	const refresh = async (reason: string): Promise<void> => {
		void reason;
		const myEpoch = ++epoch;
		abort?.abort();
		const ac = makeAbort();
		abort = ac;
		let next: UsageViewModel;
		try {
			next = await load(clock.now(), ac.signal);
		} catch (e) {
			// A superseded / aborted / stopped refresh bails silently; a live one reports.
			if (!(ac.signal.aborted || myEpoch !== epoch || !running)) reporter.report("refresh", e);
			return;
		}
		if (ac.signal.aborted || myEpoch !== epoch || !running) return;
		try {
			vm = next;
			if (next.empty) {
				forceCloseExpanded();
				sink.clear();
			} else {
				sink.renderCollapsed(next);
			}
		} catch (e) {
			reporter.report("refresh", e);
		}
	};

	const stop = (): void => {
		running = false;
		epoch++;
		overlayGeneration++;
		if (intervalHandle !== undefined) {
			scheduler.clearInterval(intervalHandle);
			intervalHandle = undefined;
		}
		abort?.abort();
		abort = undefined;
		expanded = false;
		overlayOpen = false;
		sink.closeExpanded();
		vm = undefined;
		sink.clear();
		reporter.reset();
	};

	const start = (): void => {
		stop();
		running = true;
		void refresh("session").catch((e) => reporter.report("refresh", e));
		intervalHandle = scheduler.setInterval(() => {
			void refresh("timer").catch((e) => reporter.report("refresh", e));
		}, intervalMs);
	};

	const toggleExpanded = (): void => {
		if (!running) return;
		if (!expanded) {
			const gen = ++overlayGeneration;
			expanded = true;
			overlayOpen = true;
			sink.openExpanded(
				() => vm,
				() => {
					if (gen !== overlayGeneration || !running) return;
					overlayOpen = false;
					expanded = false;
				},
			);
		} else {
			forceCloseExpanded();
		}
	};

	return {
		start,
		refresh,
		toggleExpanded,
		isExpanded: () => expanded,
		stop,
	};
}
