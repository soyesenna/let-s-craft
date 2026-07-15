import { describe, expect, it } from "vitest";
import { createUsageBarController } from "../src/statusbar/controller.js";
import type {
	Clock,
	IntervalHandle,
	Reporter,
	Scheduler,
	UsageBarController,
	UsageControllerDeps,
	UsageLoader,
	UsageWidgetSink,
} from "../src/statusbar/controller.js";
import type { UsageViewModel } from "../src/statusbar/view-model.js";

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for the pure lifecycle controller (plan §6 Step 1 / §9).
// Everything is wired through injected fakes: no real time, no real omp. The
// FakeSink faithfully models the index.ts `ctx.ui.custom` overlay adapter — a
// per-open `done` (== ownDone) plus an async `.then` that clears the *global*
// `activeDone` only when it is still that open's — so the generation-guard /
// finding-#4 ordering is exercised exactly as it will run against the real
// adapter. Currently RED only because ../src/statusbar/controller.js does not
// exist yet (the craft skill implements it to this contract).
// ─────────────────────────────────────────────────────────────────────────────

const INTERVAL_MS = 5 * 60_000;

/** Drain the microtask queue our async fakes schedule (overlay .then, refresh awaits). */
async function flush(rounds = 5): Promise<void> {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** A minimal, reference-distinct view-model. Each call returns a fresh object so
 *  tests can assert *which* VM rendered via identity (`toBe`), not deep-equality. */
function makeVm(empty = false): UsageViewModel {
	return {
		empty,
		columns: empty
			? []
			: [
					{
						provider: "anthropic",
						title: "Anthropic",
						slots: [{ key: "5h", header: "5h", label: "5 hours" }],
						accounts: [{ label: "acct", isSubscription: true, freshness: "fresh", cells: [] }],
					},
				],
	};
}

class FakeClock implements Clock {
	constructor(public t = 1_000_000) {}
	now(): number {
		return this.t;
	}
}

class FakeScheduler implements Scheduler {
	intervals: Array<{ fn: () => void; ms: number; handle: IntervalHandle }> = [];
	cleared: IntervalHandle[] = [];
	private next = 1;

	setInterval(fn: () => void, ms: number): IntervalHandle {
		const handle = this.next++ as unknown as IntervalHandle;
		this.intervals.push({ fn, ms, handle });
		return handle;
	}

	clearInterval(h: IntervalHandle): void {
		this.cleared.push(h);
	}

	/** Fire a scheduled interval callback (default: the sole armed interval). */
	tick(i = 0): void {
		this.intervals[i]?.fn();
	}
}

interface LoaderCall {
	now: number;
	signal: AbortSignal;
	resolve: (vm: UsageViewModel) => void;
	reject: (err: unknown) => void;
}

/** Records each load call and lets the test settle it (or reject it) on demand,
 *  modelling omp's shared fetch that "only rejects this caller, never the shared
 *  upstream" — an aborted loader may still resolve late (F6). */
class FakeLoader {
	calls: LoaderCall[] = [];
	load: UsageLoader = (now, signal) =>
		new Promise<UsageViewModel>((resolve, reject) => {
			this.calls.push({ now, signal, resolve, reject });
		});

	settle(i: number, vm: UsageViewModel): void {
		this.calls[i].resolve(vm);
	}

	fail(i: number, err: unknown): void {
		this.calls[i].reject(err);
	}
}

class FakeReporter implements Reporter {
	reports: Array<{ key: string; err: unknown }> = [];
	resets = 0;

	report(key: string, err: unknown): void {
		this.reports.push({ key, err });
	}

	reset(): void {
		this.resets++;
	}
}

interface OpenRecord {
	getVm: () => UsageViewModel | undefined;
	onClose: () => void;
	settled: boolean;
	done: () => void;
}

/**
 * Faithful model of the index.ts `ctx.ui.custom({overlay:true})` adapter:
 *  - each open captures a per-open `done` (the factory's done == ownDone) and sets
 *    the module-scoped `activeDone` to it;
 *  - calling `done()` resolves the overlay promise; the adapter's async `.then`
 *    then clears `activeDone` ONLY when it is still this open's (`activeDone === ownDone`)
 *    and invokes `onClose` — reproducing the microtask gap the overlayGeneration
 *    guard defends against;
 *  - `closeExpanded()` force-closes via a capture-and-clear of the current `activeDone`;
 *  - `clear()` only touches the below-editor widget and NEVER settles an overlay
 *    (finding #4 — the empty path must go through closeExpanded, not clear).
 */
class FakeSink implements UsageWidgetSink {
	events: string[] = [];
	collapsedRenders: UsageViewModel[] = [];
	clearCount = 0;
	closeExpandedCount = 0;
	opens: OpenRecord[] = [];
	renderThrows = false;
	private activeDone: (() => void) | undefined;

	renderCollapsed(vm: UsageViewModel): void {
		this.events.push("render");
		if (this.renderThrows) throw new Error("sink render boom");
		this.collapsedRenders.push(vm);
	}

	openExpanded(getVm: () => UsageViewModel | undefined, onClose: () => void): void {
		this.events.push("open");
		let resolveP!: () => void;
		const p = new Promise<void>((res) => {
			resolveP = res;
		});
		const rec: OpenRecord = { getVm, onClose, settled: false, done: () => {} };
		const done = (): void => {
			if (rec.settled) return; // ctx.ui.custom's promise resolves at most once
			rec.settled = true;
			resolveP();
		};
		rec.done = done;
		this.activeDone = done;
		void p.then(() => {
			if (this.activeDone === done) this.activeDone = undefined;
			onClose();
		});
		this.opens.push(rec);
	}

	closeExpanded(): void {
		this.events.push("close");
		this.closeExpandedCount++;
		const d = this.activeDone;
		this.activeDone = undefined;
		d?.();
	}

	clear(): void {
		this.events.push("clear");
		this.clearCount++;
	}

	/** Simulate the overlay settling itself (its own handleInput chord/Esc → done()). */
	settleOpen(i: number): void {
		this.opens[i].done();
	}
}

interface Harness {
	controller: UsageBarController;
	clock: FakeClock;
	scheduler: FakeScheduler;
	sink: FakeSink;
	loader: FakeLoader;
	reporter: FakeReporter;
}

function makeHarness(): Harness {
	const clock = new FakeClock();
	const scheduler = new FakeScheduler();
	const sink = new FakeSink();
	const loader = new FakeLoader();
	const reporter = new FakeReporter();
	const deps: UsageControllerDeps = {
		clock,
		scheduler,
		sink,
		load: loader.load,
		reporter,
		intervalMs: INTERVAL_MS,
		makeAbort: () => new AbortController(),
	};
	return { controller: createUsageBarController(deps), clock, scheduler, sink, loader, reporter };
}

describe("createUsageBarController — start / interval / refresh", () => {
	it("renders once and arms the ~5-min interval on start", async () => {
		const h = makeHarness();
		h.controller.start();
		expect(h.scheduler.intervals).toHaveLength(1);
		expect(h.scheduler.intervals[0].ms).toBe(INTERVAL_MS);
		expect(h.loader.calls).toHaveLength(1); // the "session" refresh fired immediately

		const vm = makeVm();
		h.loader.settle(0, vm);
		await flush();

		expect(h.sink.collapsedRenders).toHaveLength(1);
		expect(h.sink.collapsedRenders[0]).toBe(vm);
	});

	it("passes the clock's now() into each load call", async () => {
		const h = makeHarness();
		h.clock.t = 777;
		h.controller.start();
		expect(h.loader.calls[0].now).toBe(777);
	});

	it("fires a fresh refresh when the scheduler interval ticks", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();
		expect(h.loader.calls).toHaveLength(1);

		h.scheduler.tick(); // interval callback → void refresh("timer").catch(...)
		expect(h.loader.calls).toHaveLength(2);

		const vm2 = makeVm();
		h.loader.settle(1, vm2);
		await flush();
		expect(h.sink.collapsedRenders).toHaveLength(2);
		expect(h.sink.collapsedRenders[1]).toBe(vm2);
	});
});

describe("createUsageBarController — stop / teardown", () => {
	it("clears the interval, aborts the in-flight load, clears the widget, and closes the overlay on stop", () => {
		const h = makeHarness();
		h.controller.start();
		const clearsBefore = h.sink.clearCount;
		const closesBefore = h.sink.closeExpandedCount;

		h.controller.stop();

		expect(h.scheduler.cleared).toHaveLength(1);
		expect(h.scheduler.cleared[0]).toBe(h.scheduler.intervals[0].handle);
		expect(h.loader.calls[0].signal.aborted).toBe(true);
		expect(h.sink.clearCount).toBeGreaterThan(clearsBefore);
		expect(h.sink.closeExpandedCount).toBeGreaterThan(closesBefore);
	});

	it("renders nothing when a load resolves after stop (no resurrection)", async () => {
		const h = makeHarness();
		h.controller.start();
		h.controller.stop();

		h.loader.settle(0, makeVm()); // the session load resolves *after* teardown
		await flush();

		expect(h.sink.collapsedRenders).toHaveLength(0);
	});
});

describe("createUsageBarController — generation-guarded latest-wins", () => {
	it("renders only the newest VM when a fast-new refresh resolves before a slow-old one", async () => {
		const h = makeHarness();
		h.controller.start(); // load 0 (session, epoch 1)
		const pSlow = h.controller.refresh("slow"); // load 1 (epoch 2) — aborts load 0
		const pFast = h.controller.refresh("fast"); // load 2 (epoch 3) — aborts load 1

		const vmFast = makeVm();
		const vmSlow = makeVm();
		h.loader.settle(2, vmFast);
		await pFast;
		expect(h.sink.collapsedRenders).toHaveLength(1);
		expect(h.sink.collapsedRenders[0]).toBe(vmFast);

		h.loader.settle(1, vmSlow); // the slow-old refresh resolves late
		await pSlow;
		expect(h.sink.collapsedRenders).toHaveLength(1); // epoch bailed — no stale overwrite
		expect(h.sink.collapsedRenders[0]).toBe(vmFast);
		expect(h.reporter.reports).toEqual([]); // a superseded bail is silent
	});

	it("swallows an aborted old refresh's rejection without reporting it", async () => {
		const h = makeHarness();
		h.controller.start(); // load 0
		const pSlow = h.controller.refresh("slow"); // load 1 — aborted by "fast"
		const pFast = h.controller.refresh("fast"); // load 2

		const vmFast = makeVm();
		h.loader.settle(2, vmFast);
		await pFast;
		expect(h.loader.calls[1].signal.aborted).toBe(true);

		h.loader.fail(1, new Error("aborted upstream")); // old await rejects post-abort
		await pSlow; // resolves (never rejects) — no unhandled rejection

		expect(h.reporter.reports).toEqual([]); // aborted ⇒ not reported
		expect(h.sink.collapsedRenders[0]).toBe(vmFast);
	});

	it("ignores a late-resolving aborted loader that ignored its signal", async () => {
		const h = makeHarness();
		h.controller.start(); // load 0
		const pOld = h.controller.refresh("old"); // load 1 (epoch 2)
		const pNew = h.controller.refresh("new"); // load 2 (epoch 3)

		const vmNew = makeVm();
		h.loader.settle(2, vmNew);
		await pNew;
		expect(h.sink.collapsedRenders).toHaveLength(1);
		expect(h.sink.collapsedRenders[0]).toBe(vmNew);

		// The old loader ignored its aborted signal and resolves *after* the newer one:
		h.loader.settle(1, makeVm());
		await pOld;
		expect(h.sink.collapsedRenders).toHaveLength(1); // old epoch bailed — no stale render
		expect(h.sink.collapsedRenders[0]).toBe(vmNew);
		expect(h.reporter.reports).toEqual([]);
	});
});

describe("createUsageBarController — refresh never rejects", () => {
	it("routes a post-await sink.renderCollapsed throw to the reporter and still resolves", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm()); // the session refresh renders cleanly first
		await flush();

		h.sink.renderThrows = true;
		const p = h.controller.refresh("boom");
		h.loader.settle(1, makeVm());
		await expect(p).resolves.toBeUndefined(); // never rejects

		expect(h.reporter.reports).toHaveLength(1);
		expect(h.reporter.reports[0].key).toBe("refresh");
	});

	it("routes a load rejection to reporter.report exactly once", async () => {
		const h = makeHarness();
		h.controller.start(); // load 0 — live, not aborted, running
		h.loader.fail(0, new Error("network boom"));
		await flush();

		expect(h.reporter.reports).toHaveLength(1);
		expect(h.reporter.reports[0].key).toBe("refresh");
	});

	it("swallows a throwing sink render fired from the interval callback", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.sink.renderThrows = true;
		h.scheduler.tick(); // void refresh("timer").catch(...) — must not leak an unhandled rejection
		expect(h.loader.calls).toHaveLength(2);
		h.loader.settle(1, makeVm());
		await flush();

		expect(h.reporter.reports).toHaveLength(1);
		expect(h.reporter.reports[0].key).toBe("refresh");
	});
});

describe("createUsageBarController — empty VM routes through forceCloseExpanded", () => {
	it("clears the widget (no render, no overlay close) for an empty VM while collapsed", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		const rendersBefore = h.sink.collapsedRenders.length;
		const closesBefore = h.sink.closeExpandedCount;
		const clearsBefore = h.sink.clearCount;

		const p = h.controller.refresh("empty");
		h.loader.settle(1, makeVm(true)); // empty VM
		await p;

		expect(h.sink.collapsedRenders).toHaveLength(rendersBefore); // no render
		expect(h.sink.closeExpandedCount).toBe(closesBefore); // nothing open ⇒ forceClose early-returns
		expect(h.sink.clearCount).toBe(clearsBefore + 1); // widget cleared
	});

	it("closes+invalidates an open overlay BEFORE any onClose fires, then clears (finding #4)", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open overlay A (gen 1)
		expect(h.controller.isExpanded()).toBe(true);
		expect(h.sink.opens).toHaveLength(1);

		h.sink.events.length = 0; // isolate the empty-refresh event ordering
		const closesBefore = h.sink.closeExpandedCount;

		const p = h.controller.refresh("empty");
		h.loader.settle(1, makeVm(true)); // empty VM while expanded
		await p;

		// forceCloseExpanded() flipped the flags + called sink.closeExpanded synchronously,
		// *before* the overlay's async onClose could fire:
		expect(h.sink.closeExpandedCount).toBe(closesBefore + 1);
		expect(h.controller.isExpanded()).toBe(false);
		const closeIdx = h.sink.events.indexOf("close");
		const clearIdx = h.sink.events.indexOf("clear");
		expect(closeIdx).toBeGreaterThanOrEqual(0);
		expect(clearIdx).toBeGreaterThan(closeIdx); // close then clear
		expect(h.sink.events).not.toContain("render");

		await flush(); // the force-closed overlay's late onClose_A must be inert
		expect(h.controller.isExpanded()).toBe(false);
		h.sink.settleOpen(0); // a further late settle is a no-op (promise already settled)
		await flush();
		expect(h.controller.isExpanded()).toBe(false);
	});
});

describe("createUsageBarController — expanded toggle state", () => {
	it("opens the overlay once; a second toggle closes it via forceCloseExpanded (no re-open)", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();
		expect(h.controller.isExpanded()).toBe(false);

		h.controller.toggleExpanded();
		expect(h.controller.isExpanded()).toBe(true);
		expect(h.sink.opens).toHaveLength(1);

		const closesBefore = h.sink.closeExpandedCount;
		h.controller.toggleExpanded(); // else-branch → forceCloseExpanded
		expect(h.controller.isExpanded()).toBe(false);
		expect(h.sink.opens).toHaveLength(1); // NOT re-opened
		expect(h.sink.closeExpandedCount).toBe(closesBefore + 1);
	});

	it("exposes a live VM getter to the overlay that reflects later refreshes", async () => {
		const h = makeHarness();
		h.controller.start();
		const first = makeVm();
		h.loader.settle(0, first);
		await flush();

		h.controller.toggleExpanded();
		const getVm = h.sink.opens[0].getVm;
		expect(getVm()).toBe(first);

		const p = h.controller.refresh("update");
		const second = makeVm();
		h.loader.settle(1, second);
		await p;
		expect(getVm()).toBe(second); // the same overlay now sees the refreshed VM
	});

	it("flips expanded back when the overlay reports its own close", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open (gen 1)
		expect(h.controller.isExpanded()).toBe(true);

		h.sink.settleOpen(0); // overlay closes itself (chord/Esc → done → onClose)
		await flush();

		expect(h.controller.isExpanded()).toBe(false);
		expect(h.sink.opens).toHaveLength(1); // no reopen
	});

	it("is a no-op before start and after stop", () => {
		const h = makeHarness();
		h.controller.toggleExpanded(); // before start
		expect(h.controller.isExpanded()).toBe(false);
		expect(h.sink.opens).toHaveLength(0);

		h.controller.start();
		h.controller.stop();
		h.controller.toggleExpanded(); // after stop
		expect(h.controller.isExpanded()).toBe(false);
		expect(h.sink.opens).toHaveLength(0);
	});

	it("closes the overlay and resets expanded on stop; a late onClose is inert", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open (gen 1)
		expect(h.controller.isExpanded()).toBe(true);
		const closesBefore = h.sink.closeExpandedCount;

		h.controller.stop(); // teardown closes overlay + bumps generation
		expect(h.controller.isExpanded()).toBe(false);
		expect(h.sink.closeExpandedCount).toBe(closesBefore + 1);

		await flush(); // A's onClose microtask runs — inert (generation bumped + !running)
		expect(h.controller.isExpanded()).toBe(false);
		h.sink.settleOpen(0);
		await flush();
		expect(h.controller.isExpanded()).toBe(false);
	});
});

describe("createUsageBarController — overlayGeneration close→reopen→old-close", () => {
	it("keeps the reopened overlay intact when a stale old-overlay onClose fires late", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open A (gen 1)
		expect(h.sink.opens).toHaveLength(1);

		// force-close A via the else-branch (gen → 2): done_A fires, onClose_A is *scheduled*
		h.controller.toggleExpanded();
		expect(h.controller.isExpanded()).toBe(false);

		// reopen B (gen 3) synchronously — BEFORE onClose_A's microtask runs:
		h.controller.toggleExpanded();
		expect(h.sink.opens).toHaveLength(2);
		expect(h.controller.isExpanded()).toBe(true);

		await flush(); // now the stale onClose_A runs — must be inert (gen 1 ≠ 3)
		expect(h.controller.isExpanded()).toBe(true); // B stays open

		h.sink.settleOpen(1); // B closes on its OWN onClose (gen 3 matches)
		await flush();
		expect(h.controller.isExpanded()).toBe(false);
	});

	it("routes a subsequent force-close to the reopened overlay (B), never the stale one (A)", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open A (gen 1)
		h.controller.toggleExpanded(); // force-close A (gen 2) → A's own done fires
		expect(h.sink.opens[0].settled).toBe(true);

		h.controller.toggleExpanded(); // reopen B (gen 3) — activeDone is now B's done
		expect(h.sink.opens).toHaveLength(2);
		expect(h.sink.opens[1].settled).toBe(false);

		h.sink.settleOpen(0); // A's late settlement is a no-op; must not clear B's activeDone
		await flush();
		expect(h.sink.opens[1].settled).toBe(false); // B untouched by the stale A settle
		expect(h.controller.isExpanded()).toBe(true);

		h.controller.toggleExpanded(); // subsequent force-close (gen 4) must hit B's own done
		expect(h.sink.opens[1].settled).toBe(true);
		expect(h.controller.isExpanded()).toBe(false);
	});
});

describe("createUsageBarController — restart (session switch / branch)", () => {
	it("re-arms and invalidates a prior overlay's stale onClose across a restart", async () => {
		const h = makeHarness();
		h.controller.start();
		h.loader.settle(0, makeVm());
		await flush();

		h.controller.toggleExpanded(); // open A under the first generation
		expect(h.controller.isExpanded()).toBe(true);

		// session_switch/session_branch → the registrar calls controller.start() again,
		// whose internal stop() clears the old interval, closes A, and bumps the generation.
		h.controller.start();
		expect(h.controller.isExpanded()).toBe(false);
		expect(h.scheduler.cleared).toHaveLength(1); // the old interval was cleared
		expect(h.scheduler.intervals).toHaveLength(2); // a fresh interval was armed

		await flush(); // A's stale onClose runs against the restarted controller — inert (gen bumped)
		expect(h.controller.isExpanded()).toBe(false);
		h.sink.settleOpen(0);
		await flush();
		expect(h.controller.isExpanded()).toBe(false); // a stale overlay cannot flip restarted state
	});
});

describe("createUsageBarController — subsystem inert without start (hasUI gate)", () => {
	// The registrar's session_start handler is `ctx = c; if (!c.hasUI) return; controller.start()`.
	// Modelling that gate here proves the ENTIRE subsystem stays inert headless — no interval,
	// no fetch, no widget, no overlay — because everything hangs off controller.start().
	function sessionStart(ctx: { hasUI: boolean }, controller: UsageBarController): void {
		if (!ctx.hasUI) return;
		controller.start();
	}

	it("arms no interval, runs no load, and cannot open the overlay until a hasUI start", () => {
		const h = makeHarness();

		sessionStart({ hasUI: false }, h.controller);
		expect(h.scheduler.intervals).toHaveLength(0);
		expect(h.loader.calls).toHaveLength(0);
		h.controller.toggleExpanded(); // toggle before any start is a no-op too
		expect(h.sink.opens).toHaveLength(0);
		expect(h.controller.isExpanded()).toBe(false);

		sessionStart({ hasUI: true }, h.controller);
		expect(h.scheduler.intervals).toHaveLength(1);
		expect(h.loader.calls).toHaveLength(1);
	});
});
