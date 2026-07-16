# Plan — release-gate (lsc_craft_release 승인 게이트 패키지)

- 기준: spec.md(수용 기준·제약 SSOT), trace.md(증거 지도). 모든 file:line 인용은 현행 HEAD **cc17764**에서 재검증됨 (2026-07-17, lsc-explore 3-lane 검증 + 직접 확인).
- 모드: **DELIBERATE** (보안 게이트 feature — pre-mortem·확장 테스트 계획 포함).
- 소스 루트: `.lsc/worktrees/release-gate/` (pre-craft 워크트리, 메인 리포와 동일 콘텐츠). 인용 경로는 리포 상대 경로.
- 개정: consensus iteration 1 — architect Change Spec **CS1~CS11** + critic **F-11~F-14** 전부 반영 (개정 기록: `plan/plan-1.md`).

---

## 1. Requirements Summary

**목표** (spec Goal): 문서화된 유일 보안 MEDIUM — `src/craft/release.ts:25-40`의 `performCraftRelease`가 `getActiveCraft()` truthy 검사(:26-29) 외 승인 검증 0행으로 실행됨(`approval:"read"`(:68)는 tier 분류일 뿐 게이트 아님) — 을 3부 패키지로 닫는다:

- **A-1 nonce 승인 토큰**: `lsc_confirm`이 파괴적 게이트 태그 질문에서 플랫폼 산출 yes일 때 UUID nonce를 발급, `lsc_craft_release`는 그 nonce의 소비를 TS 레벨 fail-closed로 전제.
- **A-2 open-release 증거 계약**: release 시점에 증거(태그·응답 원문·매니페스트 지문·reason)를 `.craft-state.json`에 선기록; open-release 미폐쇄 동안 `lsc_verify_hash`는 신설 게이트로, `lsc_run_tests`는 기존 가드(run-tests.ts:206-211)의 메시지 업그레이드로 재베이스라인 안내와 함께 거부. `lsc_craft_init` 재베이스라인이 close하며 old/new 매니페스트 diff 요약을 기록 (verify blind 창 = hash-manifest.ts:310의 ctx.cwd 폴백을 상태머신으로 봉쇄).
- **A-3 상태 토큰화**: 발급·소비 사실을 durable 파일에 남겨 재시작 후에도 **판별**(소비 아님) 가능.

**CORE 개념** (spec Ontology): **소비 권위 = in-process 메모리 슬롯 1개** (모델 쓰기 불가; 소비·abort·세션 이벤트·재시작에 더해 **새 tagged prompt 시작(재발급 포함)·craft identity 변화·증거 persist 실패**에 실효 — CS11, §8 ADR) / **`.craft-state.json` = 판별·감사 전용 증거 원장** (EXCLUDED_FILES(hash-manifest.ts:57)라 해시 위반 미유발, `writeFileAtomicSync`(src/utils/atomic-write.ts:20-28) 원자 쓰기, shape 무검증 로드(state.ts:86-91)라 optional 역호환).

**Must Have** (Constraints 발췌): 권위/증거 분리(C2) · CraftState 확장 전원 optional+읽기 관용(C3) · writeFileAtomicSync(C4) · enforcement 확장 금지(C5) · fixture 동일 경로 발급·소비(C6) · land 예외 조항(C7) · A-2 표면 = verify 신설 1곳 + run_tests 메시지 업그레이드(C8) · 순수 함수/thin wrapper — 발급은 performConfirm 내부가 아닌 execute 래퍼(ask.ts:627-629)(C9) · 태그 상수 TS 모듈 SSOT, 별칭 금지, 시나리오5 `[Release]`→`[Canon Amendment]` 정규화(C10) · 질문 태깅 규약 불변(C11) · 주입-예시 소독/ tarball 대조 미구현(C1).

**Must NOT Have** (Non-Goals): lsc_land 도구 신설(소비자는 release만 — [Land]는 발급 인프라만) · lsc_restore_tests 소비 게이트 · enforcement tool_call 블록의 open-release 창 확장 · 시간 기반 nonce 만료 · CraftState 스키마 버전 필드 · 정본 문서 라인 소급 수정.

**AC 7항** (run_test.sh 기계 검증, vitest 순수/도구 계층, 실 LLM 불요): (1) 무승인 release 거부 (2) 승인 직후 성공 (3) 일회용 (4) open-release 중 verify/run_tests 거부+재베이스라인 안내 (5) 재-init 후 복귀+close+diff 기록 (6) 구버전 상태 파일 관용 (7) 기존 단위 스위트 전수 green.

---

## 2. DR 요약

**Mode**: DELIBERATE.

### Principles (5)

1. **Fail-closed**: 무발급·기소비·태그/identity 불일치·open-release 미폐쇄는 전부 isError — 예외 없음. 정상 플로우 무손상 근거는 스킬 계약이 이미 모든 release 전 confirm을 강제(skills/craft/SKILL.md:26, :124)한다는 것.
2. **권위=메모리 / 증거=파일**: 소비 가능성은 in-process 슬롯에서만 나오고, `.craft-state.json`은 판별·감사 원장이다. 모듈 경계가 이 분리를 물리적으로 표현해야 한다.
3. **순수 reducer + SDK-independent effectful core + thin wrapper** (CS8): vitest가 omp SDK 값을 import할 수 없으므로(release.ts:20-24 주석 등 6파일 관례) 계층을 3분한다 — **pure**는 tag match·consume 판정·closeOpenRelease·guidance 구성뿐이고, 슬롯 mutator와 파일 reader/writer는 **SDK-independent effectful core**(pure 아님 — persist 순서와 rollback이 그 자체로 테스트 대상), `pi.zod`/`pi.registerTool` 배선만 thin wrapper다.
4. **최소 표면** (A-2 교정): 신설 게이트는 verify 1곳(hash-manifest.ts:310 폴백 전), run_tests는 기존 가드(run-tests.ts:206-211)의 메시지 업그레이드만, enforcement는 무변경.
5. **역호환 우선**: CraftState 확장 전원 optional(failureSignature 선례 state.ts:38-48), 기존 성공 메시지·details shape 불변, 증거 부재 시 기존 동작 그대로.

### Decision Drivers (top 3)

1. **보안 MEDIUM(V1 WIDE OPEN)을 TS 레벨에서 닫되 정상 플로우 0 손상** — 게이트 부재 = 거부(fail-closed)면서, confirm-선행이 이미 계약인 플로우는 그대로 통과해야 한다.
2. **테스트 제약**: AC 7항의 기계 검증이 `npm test`(LLM 불요) 계층에서 성립해야 한다 → **모든 결정은 pure reducer로 검증하며, effectful adapter도 SDK runtime value 없이 import 가능해야 한다** (CS8).
3. **부트스트랩 무차단** (Constraint 7): 이 feature 자신의 구현·감사·land가 현재 세션(개조 이전 dist)에서 진행 가능해야 한다.

### Options (≥2 실행 가능 + 1 무효화)

**Option A (채택) — 신규 `src/craft/destructive-approval.ts`(generic 파괴적 승인 권위+태그 SSOT) + `state.ts` 확장(증거+리더) + `hash-manifest.ts` 헬퍼(close+지문)**
- **채택의 핵심 사유 (CS1): 휘발성 권위(pending approval)가 durable `CraftState`에 우발적으로 직렬화(accidental persistence)되는 것을 모듈 경계가 물리적으로 차단한다** — 권위/증거 분리(CORE)의 구조적 강제.
- 장점: destructive-approval.ts는 **repo-internal runtime import 0**(node:crypto만, state/fs 무import)이라 tag/consume reducer 단독 단위 테스트 최경량; state.ts의 module-private `persist`(:61-65) 불변 유지; import 방향 단방향(state→approval, ask→{approval,state}, release→{approval,state,hash-manifest}) — 순환 없음.
- 단점: 모듈 +1; state lifecycle과의 **cross-module invariant**(전이 4지점 실효 배선)가 생겨 event wiring 테스트가 필수(§4 W1); state.ts를 import하는 기존 6모듈이 게이트를 간접 load. **주의: "state 회귀 반경 축소"는 Option A의 장점이 아니다** — A도 state.ts 전이 4함수를 전부 수정한다(과장 논거 철회 — CS1).

**Option B — state.ts 단일 확장 (슬롯·태그·증거 전부 state.ts에)**
- 장점(steelman): volatile capability와 active craft lifecycle을 **한 상태기계의 transition choke point에서 원자적으로** 변경 — 실효 배선 누락·publish 순서 실수를 구조적으로 회피; seam 1곳; import 추가 최소.
- 단점: 직렬화 금지 대상(권위)과 직렬화 대상(증거)이 한 파일에 공존해 future persistence 실수(pending approval의 우발 직렬화) 위험; 태그 SSOT가 상태 관리 모듈에 매몰되어 스킬/테스트가 참조할 상수 위치로 부자연.

**Option C — release.ts에 게이트 내장 (무효화)**
- 무효화 근거: 발급자(ask.ts)가 소비자 도구 모듈(release.ts)을 import하게 되어 발급/소비 대칭이 깨지고, init close·verify 게이트의 증거 접근까지 release.ts 경유가 되어 도구 모듈이 허브로 역전된다. 태그 SSOT가 단일 도구 파일에 갇혀 [Land]/[Hash Violation] 발급 인프라(비목표의 확장 여지)와 모순.

**채택: A (generic module).** 이 모듈은 `[Canon Amendment]`뿐 아니라 `[Land]`/`[Hash Violation]`의 발급 슬롯까지 소유하는 generic destructive-approval infrastructure이므로 이름도 실제 책임대로 `destructive-approval.ts`로 한다(`release-gate` 명명은 책임보다 좁고 release 도메인 역결합 유발 — 기각, CS1). Option B의 lifecycle 원자성 장점은 **state 전이 commit point 통일(CS3) + 전이 4지점 실효 배선 + 실배선 wiring 테스트(§4 W1)**로 흡수한다. 태그 SSOT 하위 결정: 별도 gate-tags.ts는 비-게이트 소비자가 생길 때까지 YAGNI — `DESTRUCTIVE_GATE_TAGS`는 destructive-approval.ts 상수로 시작하되, **소비자별 허용 집합 `RELEASE_CONSUMABLE_TAGS`는 소비자 모듈 release.ts가 소유**한다(발급 인프라는 소비자를 모른다 — CS1).

---

## 3. Implementation Steps

6단계, 각 단계는 독립 커밋 가능 단위(각 커밋에서 `npm test` green + `tsc` 통과 — RULE의 feature 단위 커밋 규율). 시나리오5 co-evolution을 소비 게이트와 같은 커밋(Step 4)에 동봉하므로 e2e 번들(LSC_E2E 전용, `npm test` 미포함 — package.json:15-16)을 포함한 **모든 커밋 시점의 테스트 계약이 일관 — known-red 커밋 구간 없음**(§3.7, CS9).

> **크래프트 루프와의 관계**: Stage 4 테스트 canon(§4)이 RED 씨앗을 먼저 제공하고, executor가 아래 순서로 GREEN을 만든다. 아래 "단위 검증"은 executor가 각 단계에서 좁게 실행할 명령이다(프로젝트 전체 스위트는 run_test.sh 몫).

### Step 1 — 태그 SSOT + 인메모리 권위 코어 (신규 `src/craft/destructive-approval.ts`) + 전이 실효 배선·commit point 통일

**신규 파일 `src/craft/destructive-approval.ts`** — runtime import는 `node:crypto`(randomUUID)뿐, **state/fs 무import** (repo-internal runtime dependency 0 — CS1). src/craft 내 UUID 사용 선례 없음(grep 확인) — `crypto.randomUUID()` 최초 도입, `createHash` 선례(hash-manifest.ts:13)와 동일한 node:crypto 계열.

책임 경계: **generic 파괴적 승인 권위(메모리 슬롯)와 태그 집합 SSOT만**. 파일/fs 접근 0행, CraftState 무의존, 소비자 무인지. Export 목록(전체):

```ts
export const DESTRUCTIVE_GATE_TAGS = ["[Canon Amendment]", "[Land]", "[Hash Violation]"] as const; // TS SSOT — 별칭 금지 (C10)
export type DestructiveGateTag = (typeof DESTRUCTIVE_GATE_TAGS)[number];
export interface ApprovalCraftIdentity { feature: string; projectRoot: string; worktreeRoot?: string; } // capability의 craft 귀속 (CS1)
export interface PendingDestructiveApproval {
	nonce: string;        // crypto.randomUUID()
	tag: DestructiveGateTag;
	question: string;     // confirm 질문 원문
	response: "yes";      // 플랫폼 산출 응답 (confirmResult, ask.ts:96-105)
	issuedAt: string;     // ISO 8601
	identity: ApprovalCraftIdentity; // 발급 시점 active craft 귀속 — 비교는 반드시 feature/projectRoot/worktreeRoot "필드 동등". 참조 비교 금지: recordTestResult가 state.ts:117/:126에서 spread로 activeCraft 객체를 교체하므로 참조는 신뢰 불가 (F-12)
}
export type ConsumeApprovalResult =
	| { ok: true; approval: PendingDestructiveApproval }
	| { ok: false; reason: "no-pending-approval" }
	| { ok: false; reason: "tag-mismatch" | "identity-mismatch"; pendingTag: DestructiveGateTag };
export function matchDestructiveGateTag(question: string): DestructiveGateTag | undefined; // 질문 prefix 정확 매칭 (태깅 규약 C11 — 인식만, 규약 불변) — pure
export function sameCraftIdentity(a: ApprovalCraftIdentity | undefined, b: ApprovalCraftIdentity | undefined): boolean; // 필드 동등 비교 — pure (F-12)
export function createPendingApproval(input: { tag: DestructiveGateTag; question: string; identity: ApprovalCraftIdentity }): PendingDestructiveApproval; // prepare — 슬롯 무접촉, 레코드 생성만 (CS2)
export function installPendingApproval(record: PendingDestructiveApproval): void; // install — 슬롯 교체의 유일 지점; durable 증거 persist 성공 후에만 호출된다 (Step 3 (e))
export function consumePendingApproval(input: { acceptedTags: readonly DestructiveGateTag[]; identity: ApprovalCraftIdentity }): ConsumeApprovalResult; // single-use: ok일 때만 슬롯 클리어; tag/identity mismatch는 isError 재료(pendingTag)만 반환하고 슬롯 보존 — 조건부 비소각 (CS11, §8 ADR)
export function invalidatePendingApproval(): void;
export function peekPendingApproval(): PendingDestructiveApproval | undefined; // 테스트/관측 전용 — 소비 경로 아님
```

module-private: `let pendingApproval: PendingDestructiveApproval | undefined;` (state.ts:59 `activeCraft` 싱글턴과 동급 관례). **슬롯 mutator(install/consume/invalidate)는 pure가 아니라 SDK-independent effectful core로 분류한다** (CS8).

**`src/craft/state.ts` 전이 실효 배선 + commit point 통일 (CS3)** — `import { invalidatePendingApproval } from "./destructive-approval.js"` 추가. **모든 security-relevant mutation은 "invalidate → `persist(next)` 성공 → singleton 대입" 순서로 통일** — durable commit 이후에만 in-memory 공개 (현행 setActiveCraft의 :74 대입 → :75 persist 순서(publish-before-persist)를 **역전**):

- `setActiveCraft`(:73-76): `invalidatePendingApproval()` → `persist(next)` → `activeCraft = next`. persist throw 시 대입 없음(이전 값 유지) — 실패한 활성화가 active state를 공개하지 않는다. 새 craft 활성화 시 이전 컨텍스트의 승인 실효("방금 소비" freshness: re-init을 건너뛴 stale 승인 차단).
- `loadActiveCraft`(:86-91): 파일 JSON을 **local 변수로 parse** → `invalidatePendingApproval()` → 대입. (unclosed openRelease 미승격 규칙은 Step 2에서 openRelease 필드와 함께 추가.)
- `markCraftAborted`(:132-136): next 계산(`aborted: true`) → `invalidatePendingApproval()` → `persist(next)` → 대입. spec 명시 실효 이벤트(abort).
- `clearActiveCraft`(:139-141): `invalidatePendingApproval()` → `activeCraft = undefined` (파일 잔존 계약 :138 불변). 세션 이벤트(registerCraftStateResets :151-155가 3종 모두 이를 경유)와 release 자체의 클리어를 한 번에 커버. 소비 직후의 재실효는 멱등 no-op.

재시작 실효는 메모리 슬롯의 본성으로 자동 성립(코드 0행).

**단위 검증**: 신규 destructive-approval 단위 파일 + `npx vitest run test/craft-release.test.ts test/craft-state.test.ts` green — 소비자가 아직 없으므로 기존 동작 무변화(persist-대입 순서 역전은 성공 경로에서 관측 불가).
**커밋**: `feat: destructive-approval 권위 코어·태그 SSOT 신설 + state 전이 commit point 통일`

### Step 2 — durable 증거 스키마·기록자·리더 (`state.ts` 확장 + `hash-manifest.ts` 헬퍼) + active-open 불변식

**`CraftState` 확장** (state.ts:18-57 인터페이스에 optional 2필드 추가 — C3, failureSignature 선례 양식의 주석 포함):

```ts
export interface ReleaseApprovalEvidence { // A-1 발급 증거 + A-3 durable 판별 토큰 — 소비 권위 아님
	nonce: string; tag: string; question: string; response: string; issuedAt: string;
	consumedAt?: string; // release 소비 시각 — recordOpenRelease가 스탬프
}
export interface OpenReleaseDiffSummary { added: string[]; removed: string[]; modified: string[]; } // HashViolation[] 요약 — post-craft 감사 입력
export interface OpenReleaseEvidence { // A-2 상태머신: closedAt 부재 = open
	nonce: string; tag: string; question: string; response: string;
	reason: string;               // lsc_craft_release의 예정 수정 범위 파라미터 (release.ts zod :47-54)
	manifestFingerprint?: string; // 해제 시점 .hash-manifest.json 지문 — 파일 부재 시 생략; 감사 증거일 뿐 race lock 아님(§4 관측 (iii))
	openedAt: string;
	closedAt?: string;            // lsc_craft_init 재베이스라인이 스탬프
	rebaselineDiff?: OpenReleaseDiffSummary; // old manifest 부재 시 생략
}
// CraftState에 추가 — 둘 다 "직전 릴리스 1건" 단일 슬롯: 새 증거가 직전 증거를 덮어쓸 때까지 승계·보존된다 (F-14):
//   releaseApproval?: ReleaseApprovalEvidence;
//   openRelease?: OpenReleaseEvidence;
```

**신규 state.ts export** — **mutator는 전부 CS3 순서: next 계산 → `persist(next)` → 대입** (persist throw 시 in-memory 미반영·예외 전파), no-op sans active craft:

```ts
export function recordReleaseApproval(evidence: ReleaseApprovalEvidence): void; // next = { ...activeCraft, releaseApproval: evidence } → persist(next) → 대입. 단일 슬롯 — 새 발급이 직전 발급 증거를 덮어쓴다 (F-14)
export function recordOpenRelease(evidence: OpenReleaseEvidence): void;        // next 계산(openRelease 설정 + releaseApproval 존재 시 consumedAt = evidence.openedAt 스탬프) → persist 1회 → 대입
export function readPersistedCraftState(root: string, feature: string): CraftState | undefined; // exact-root 리더 — init 재베이스라인 전용, 후보 추측 없음 (CS4)
export function findPersistedCraftState(cwd: string, feature: string): CraftState | undefined;  // inactive verify/run_tests 전용 lookup — open 우선 (CS4)
export function hasOpenRelease(state: CraftState | undefined): boolean;        // !!state?.openRelease && state.openRelease.closedAt === undefined — pure
export function openReleaseGuidance(feature: string, evidence: OpenReleaseEvidence): string; // verify/run_tests 공용 재베이스라인 안내 — 문자열 "lsc_craft_init" 포함 계약 (AC4) — pure
```

두 리더 모두 **loadActiveCraft(:86-91)와 달리 싱글턴을 절대 건드리지 않는다**(loadActiveCraft를 게이트에 쓰면 클리어된 craft가 부활해 enforcement가 재점화됨 — 금지). `findPersistedCraftState` 후보 규칙(CS4): persist(:62)가 `worktreeRoot ?? projectRoot`에 썼으므로 `cwd`와 `worktreePath(cwd, feature)` 아래 `.craft-state.json`(craftStatePath, src/artifacts/paths.ts:69-71) **두 후보를 모두 읽고, 어느 하나가 unclosed openRelease면 그 후보를 반환(open 우선) — stale closed 후보가 open 후보를 가리지 못한다**. 둘 다 open이 아니면 워크트리 파일 존재 우선. `import { craftStatePath, worktreePath } from "../artifacts/paths.js"` (craftStatePath는 기존 import).

**active-open 불변식 (CS3)** — "tool boundary 밖에서는 active craft와 unclosed open-release가 공존하지 않는다":
- `setActiveCraft`: `next.openRelease`가 unclosed면 **직접 activation 거부(throw)** — 유일한 합법 경로는 init이 closeOpenRelease로 닫힌 증거를 넘기는 것(Step 5b).
- `loadActiveCraft`: parse 결과가 unclosed openRelease면 **record는 반환하되 `activeCraft`로 승격하지 않음** — run_tests의 기존 `!craft` 가드(run-tests.ts:206-211)가 open 상태에서도 그대로 fail-closed로 작동한다(C8 "메시지 업그레이드만" 유지의 전제).

**신규 hash-manifest.ts export** (매니페스트 도메인 소유 — diffManifests(:102-112)·loadManifest(:114-117) 재사용; `import type { OpenReleaseEvidence } from "./state.js"`는 기존 runtime import(:19)에 편승, 신규 의존 edge 없음):

```ts
export function fingerprintManifestFile(manifestPath: string): string | undefined; // sha256 hex over 파일 raw bytes; 부재 시 undefined — SDK-independent effectful (fs read)
export function closeOpenRelease(
	open: OpenReleaseEvidence | undefined,
	oldManifest: HashManifest | undefined,
	newManifest: HashManifest,
	closedAt: string,
): OpenReleaseEvidence | undefined; // pure
// 진리표: undefined→undefined
//        · 기폐쇄(closedAt 존재)→**동일 closed 증거 그대로 반환** — 재-init을 거듭해도 감사 기록이 살아남고, 다음 release의 recordOpenRelease가 새 증거로 교체할 때까지 승계된다 (CS4/F-14)
//        · open→ { ...open, closedAt, rebaselineDiff: diffManifests(old,new)의 kind별 path 그룹화 } (old 부재 시 rebaselineDiff 생략)
```

**단위 검증**: 증거 mutator persist 라운드트립(writeFileAtomicSync 산출 재독 — 필드별 단언, 스냅샷 금지 관례) + persist 실패 시 in-memory 미반영(CS3), 구버전 shape JSON 관용 파싱(AC6 선행), closeOpenRelease 진리표(기폐쇄 승계 포함), readPersistedCraftState exact-root·findPersistedCraftState open-우선·양쪽 싱글턴 무접촉, setActiveCraft unclosed 거부·loadActiveCraft unclosed 미승격. 도구 행동 무변화.
**커밋**: `feat: CraftState에 release 승인·open-release 증거 원장 확장 (optional 역호환·active-open 불변식)`

### Step 3 — 발급 트랜잭션 래퍼 (`src/ask.ts`) — revoke → confirm → identity 확인 → durable persist → install (CS2)

ask.ts는 현재 craft를 전혀 모른다(imports :22-23뿐). 추가: `import { getActiveCraft, recordReleaseApproval } from "./craft/state.js"`, `import { createPendingApproval, installPendingApproval, invalidatePendingApproval, matchDestructiveGateTag, sameCraftIdentity } from "./craft/destructive-approval.js"`.

**lsc_confirm execute 래퍼 개조** (ask.ts:627-629 — 유일한 코드 변경 지점, lsc_ask(:551-564)/lsc_select(:598-611) 불변). **(a)~(f) 순서 자체가 계약이다 (CS2)**:

```ts
async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ConfirmResultDetails>> {
	const tag = matchDestructiveGateTag(params.question);        // (a) await 전 tag match
	const craftAtPrompt = tag ? getActiveCraft() : undefined;    // (a) 질문 시점 craft 귀속 캡처
	if (tag) invalidatePendingApproval();                        // (b) tagged prompt는 결과와 무관하게 기존 pending 선철회 — 최신 same-tag no/free/cancel이 오래된 yes를 철회한다 (stale-yes 차단)
	const result = await performConfirm(channelFor(pi, ctx), ctx.ui, params); // (c)
	if (
		tag && craftAtPrompt && !result.isError
		&& result.details?.confirmed === true                     // (d) 플랫폼 산출 boolean — free answer(confirmed===null)·no는 미발급
		&& sameCraftIdentity(craftAtPrompt, getActiveCraft())     // (d) await 경계 identity 재확인 — feature/projectRoot/worktreeRoot 필드 동등 비교 (참조 비교 금지, F-12)
	) {
		const record = createPendingApproval({ tag, question: params.question,
			identity: { feature: craftAtPrompt.feature, projectRoot: craftAtPrompt.projectRoot, worktreeRoot: craftAtPrompt.worktreeRoot } });
		recordReleaseApproval({ nonce: record.nonce, tag: record.tag, question: record.question,
			response: record.response, issuedAt: record.issuedAt }); // (e) durable 발급 증거 persist — throw 시 install 미실행·예외 전파, 슬롯은 (b)에서 비워진 채 유지 = fail-closed
		installPendingApproval(record);                            // (e) persist 성공 후에만 capability 공개
	}
	return result;                                               // (f) 그 외 모든 결과(no/free/cancel/isError/무craft/identity 변화)는 슬롯 빈 채 원래 result 반환
}
```

`performConfirm`(:486-492) 자체는 무변경 — craft-agnostic 순수성 보존(C9). fixture 분기(:494-504)와 UI 분기(:506-525)가 `confirmResult`(:96-105)로 수렴한 **뒤**의 details를 판정하므로 fixture 동일 경로 발급(C6)이 자동 충족된다. (b)의 무조건 선철회로 same-tag `no`/free answer/cancel이 **철회 이벤트**가 된다 — "방금 사용자 yes" 계약(spec)의 실체화(§5 P8). (d)의 identity 재확인은 confirm await 중 세션/craft 전이가 일어나도 발급이 다른 craft로 귀속되지 않게 하는 저비용 fail-closed 방어. (e)의 persist-before-install은 증거 없는 live capability를 구조적으로 차단(§5 P7). 별도 exported 발급 헬퍼는 두지 않는다 — 트랜잭션 계약이 execute 래퍼 순서 그 자체이고, 검증은 mock `pi`로 capture한 등록 execute의 실제 호출로 한다(§4 W1, CS6/CS7).

**단위 검증**: 캡처된 lsc_confirm execute 트랜잭션 매트릭스(mock `pi` capture — 선례 test/ask-schema.test.ts:1-42) — yes 발급 / no·free answer(`confirmed===null`)·cancel(isError) 각각이 기존 pending까지 철회 / 무craft·무태그 / `[Land]` 태그도 발급(인프라) / await 중 craft 전이 시 yes여도 무발급 / persist 실패 시 슬롯·증거 모두 미설치 / 재발급 시 슬롯 교체. 소비자 부재로 기존 플로우 무변화.
**커밋**: `feat: lsc_confirm 래퍼에 파괴적 승인 revoke→confirm→persist→install 트랜잭션 부착`

### Step 4 — 소비 게이트 (`src/craft/release.ts`) + 단위·e2e 소비자 co-evolution (CS9)

**(4a) performCraftRelease(:25-40) 개조** — 소비 검증·증거 기록은 :26(getActiveCraft)과 :30(clearActiveCraft) **사이**, persist는 clearActiveCraft **전**(spec Technical Context). **소비자 허용 집합은 이 모듈이 소유한다 (CS1)**:

```ts
export const RELEASE_CONSUMABLE_TAGS: readonly DestructiveGateTag[] = ["[Canon Amendment]"]; // 소비자 바인딩 — release가 소비 가능한 유일 태그 (소유: release.ts)

export function performCraftRelease(reason: string): AgentToolResult<CraftReleaseDetails> {
	const craft = getActiveCraft();
	if (!craft) { /* 기존 :27-29 그대로 */ }
	const consumed = consumePendingApproval({
		acceptedTags: RELEASE_CONSUMABLE_TAGS,
		identity: { feature: craft.feature, projectRoot: craft.projectRoot, worktreeRoot: craft.worktreeRoot },
	});
	if (!consumed.ok) {
		return { isError: true, content: [{ type: "text", text: /* fail-closed 거부 — §관측 메시지 계약 */ }] };
	}
	const openedAt = new Date().toISOString();
	recordOpenRelease({
		nonce: consumed.approval.nonce, tag: consumed.approval.tag,
		question: consumed.approval.question, response: consumed.approval.response,
		reason, openedAt,
		manifestFingerprint: fingerprintManifestFile(
			craftHashManifestPath(craft.worktreeRoot ?? craft.projectRoot, craft.feature)),
	});
	clearActiveCraft(); // :30 — 내부에서 pending 재실효(멱등)
	return /* 기존 :31-40 성공 반환 — text·details shape 완전 불변 */;
}
```

imports 추가: `consumePendingApproval, type DestructiveGateTag` (./destructive-approval.js), `recordOpenRelease` (./state.js에 편승), `fingerprintManifestFile` (./hash-manifest.js — 신규 edge: release→hash-manifest; 역방향 import 없음, 순환 없음), `craftHashManifestPath` (../artifacts/paths.js). `recordOpenRelease`가 CS3 순서(persist 성공 후 대입)이므로 persist 실패 시 open 증거 미기록·activeCraft 유지·예외 전파, 소비된 승인은 복원하지 않음(재확인 필요) — fail-closed(§5 P7).

**(4b) 거부 메시지 계약** (관측 — 테스트 앵커): 사유 공통으로 안정 substring `"requires a fresh user approval"`과 `[Canon Amendment]` confirm 안내 포함; `tag-mismatch`/`identity-mismatch`는 pendingTag 명시. **mismatch는 action만 거부하고 슬롯은 보존한다**(조건부 비소각 — CS11, §8 ADR). 정확한 산문은 executor 재량.

**CraftReleaseDetails 불변** — 기존 exact `toEqual` 단언(test/craft-release.test.ts:36-43) 보존을 위해 details에 nonce/tag를 추가하지 않는다(증거는 durable 원장이 담당).

**(4c) test/craft-release.test.ts co-evolution** (같은 커밋 — 없으면 스위트 red): 기존 3 tests(:28-73)에 `setActiveCraft` **후** `installPendingApproval(createPendingApproval({ tag: "[Canon Amendment]", question: …, identity: 활성 craft와 동일 필드 }))` 선행 삽입(순서 중요 — setActiveCraft가 실효시키므로), freshState 헬퍼(:24-26)는 그대로. 신규 거부 4암: 무발급 / 기소비(성공 소비 후 두 번째 consume) / 태그 불일치(`[Land]` 설치 상태에서 release) / identity 불일치(다른 feature identity로 설치). ※ Stage 4 canon이 이 파일의 개정판을 자산으로 소유하는 경우(§4) executor는 canon과 일치시키는 방향으로 구현한다.

**(4d) test/enforcement-rules.test.ts 시나리오5 co-evolution** (:344-435 — **같은 커밋**, CS9: gate 소비 활성화와 e2e 계약 갱신을 한 커밋에 묶어 known-red 창을 제거):
- **태그 정규화** (load-bearing — 발급 조건이 질문 prefix이므로): 프롬프트(:380-381) `"[Release] Protected test canon …"` → `"[Canon Amendment] Protected test canon needs an approved, intentional modification. Release hash protection and proceed? Proceed?"`. fixture 규칙(:361-368) `"^\\[Release\\]"` → `"^\\[Canon Amendment\\]"`, 주석의 "redundant" 서술을 "질문 태그가 승인 발급 조건이라 load-bearing" 서술로 갱신 (catch-all default {confirm:true}(:367-368)도 yes를 산출하므로 발급은 어느 쪽이든 성립 — 규칙은 문서화 가치).
- **무승인 거부 1암 추가**: 프롬프트에 confirm **이전** `lsc_craft_release` 선행 호출 단계를 삽입 — "이 호출은 오류로 거부되어야 한다. **예상된 오류를 확인한 뒤 멈추지 말고 다음 단계를 계속하라**"를 프롬프트에 명시(CS9), "각각 정확히 한 번씩" 문구 조정. 단언(CS9): `executions.find(...)` 대신 **`executions.filter(...)`로 `lsc_craft_release` 실행이 정확히 2건**임을 단언하고, **첫 번째는 `isError === true` + 거부 anchor substring, 두 번째는 기존 성공 단언(:403-406) 유지, confirm 실행이 두 release 호출 사이에 위치**함을 순서로 단언. 단일 `runOmpPrint` 유지(토큰 비용), earlyExit 앵커(`/hash verification passed/`) 불변. 비결정성이 실제 관측되면 별도 `it` 분리 — Stage 4 full-e2e 작성자 재량(§4 W3).
- (선택 보강, 같은 재량) open-window 암: release 직후·재-init 전에 `lsc_verify_hash`/`lsc_run_tests` 호출 단계를 넣고 isError + "lsc_craft_init" 안내 단언 — AC4의 e2e 층(단, AC4의 필수 방어선은 §4 W2의 actual execute integration이다 — CS7).

**단위 검증**: `npx vitest run test/craft-release.test.ts` — AC1/AC2/AC3 단위 계층 green. 이 커밋 시점에 `npm test`·e2e(LSC_E2E) 계약 모두 일관(§3.7).
**커밋**: `feat: lsc_craft_release 승인 소비 게이트·open-release 증거 선기록 + 시나리오5 co-evolution`

### Step 5 — open-release 게이트 표면 (`hash-manifest.ts` verify+init, `run-tests.ts` 메시지)

**(5a) verify 신설 게이트** — 삽입 지점: `getActiveCraft()`(:309)와 root 폴백(:310) **사이** (F-11). 활성 craft가 이 feature일 때는 게이트 미개입(기존 경로 그대로 — active-open 불변식(Step 2) 덕에 active면서 unclosed일 수 없다; 방어적으로 active state의 `openRelease`를 먼저 검사하는 보강도 C8 비위반, executor 재량):

```ts
const craft = getActiveCraft();
if (!craft || craft.feature !== feature) {
	const persisted = findPersistedCraftState(ctx.cwd, feature); // open 우선 lookup (CS4)
	if (hasOpenRelease(persisted)) {
		return { isError: true, content: [{ type: "text",
			text: openReleaseGuidance(feature, persisted.openRelease) }] };
	}
}
const root = craft && craft.feature === feature ? (craft.worktreeRoot ?? craft.projectRoot) : ctx.cwd; // 기존 :310 불변
```

증거 부재(구버전 파일·파일 없음·위조 삭제) 시 기존 ctx.cwd 폴백 동작 완전 보존 — AC6/AC7의 무회귀 축이자 수용된 V2 잔존 트레이드오프(§6 R1).

**(5b) init 재베이스라인 close + 증거 승계 — A-2 트랜잭션 (CS5)**. 고정 순서(전 구간 동기 — critical section에 `await` 없음; 보장 범위는 **single-process/single-writer**뿐이며 cross-process 동시 init은 현행 process-local singleton 아키텍처의 지원 밖):

```ts
// ① exact-root craft state 선독 (root는 :240의 worktreeRoot ?? ctx.cwd)
const previousState = readPersistedCraftState(root, feature);                 // CS4 — 후보 추측 없음
// ② old manifest 선독 — saveManifest(:265)가 덮어쓰기 전
const previousManifest = loadManifest(craftHashManifestPath(root, feature));
// ③ new manifest 계산 — computeManifest(:264, 기존)
// ④ manifest 원자 저장 — saveManifest(:265, 기존)
// ⑤ 스냅샷 — writeSnapshots/ensureSnapshotsGitignored(:266-271, 기존)
// ⑥ closed 증거 포함 craft state persist → active publish — setActiveCraft 내부의 CS3 순서(invalidate→persist(next)→대입)가 보장
setActiveCraft({
	feature, projectRoot: ctx.cwd, worktreeRoot,
	testsPassed: false, lastFailureSummary: undefined, aborted: false,
	releaseApproval: previousState?.releaseApproval, // 증거 승계 (CS4) — 소거 금지
	openRelease: closeOpenRelease(previousState?.openRelease, previousManifest, manifest, new Date().toISOString()),
});
```

- **증거 승계 (CS4/F-14)**: fresh 객체가 `releaseApproval`과 closed `openRelease`를 **승계**한다 — 두 번째·세 번째 init에도 감사 증거(consumedAt·closedAt·rebaselineDiff)가 살아남고, **다음 release의 recordOpenRelease(및 다음 발급의 recordReleaseApproval)가 단일 슬롯을 새 증거로 덮어쓸 때만 교체**된다. capability는 setActiveCraft hook이 항상 철회하므로 durable 증거 보존이 권위를 되살리지 않는다(권위/증거 분리 C2).
- **persist 실패 시 (CS5)**: setActiveCraft가 대입 전에 throw → init tool 오류, active craft는 undefined/이전 값 그대로(미공개), persisted open은 닫히지 않고 잔존 → verify/run_tests가 계속 거부한다 — A-2 fail-closed 유지(§5 P7).
- `manifestFingerprint`는 감사 증거일 뿐 race lock이 아니다 — init은 지문 대조를 수행하지 않으며, missing/mismatch는 post-craft가 식별할 관측 상태다(§4 관측 계약 (iii)). old-before-save 선독은 self-overwrite bug를 막을 뿐 외부 process/tamper를 봉쇄하지 않는다(§6 R1).

**(5c) run_tests 메시지 업그레이드** — run-tests.ts:203의 `_ctx`를 `ctx`로 활성화(F-11), 가드(:206-211) 조건·isError shape 불변(C8), 메시지만 분기:

```ts
if (!craft || craft.feature !== feature) {
	const persisted = findPersistedCraftState(ctx.cwd, feature);
	const text = hasOpenRelease(persisted)
		? openReleaseGuidance(feature, persisted.openRelease)   // 재베이스라인 안내 포함 (AC4)
		: `lets-craft: no active craft for "${feature}". Call lsc_craft_init first.`; // 기존 문자열 그대로
	return { isError: true, content: [{ type: "text", text }] };
}
```

imports 추가: `findPersistedCraftState, hasOpenRelease, openReleaseGuidance` (기존 ./state.js import :15에 편승). enforcement.ts는 무변경(C5).

**단위 검증**: closeOpenRelease 진리표(승계 포함), 게이트 판정(hasOpenRelease×craft 유무 조합), openReleaseGuidance의 "lsc_craft_init" 포함 — pure 계층. **production wiring(actual init/verify/run_tests execute)의 검증은 §4 W2 integration이 소유한다(CS7)** — 수동 helper 시퀀스 재연은 wiring 검증으로 불인정.
**커밋**: `feat: open-release 상태머신 — verify fail-closed 게이트·init 증거 승계 트랜잭션·run_tests 안내 업그레이드`

### Step 6 — 스킬 문서 co-evolution (SKILL.md 문구)

(시나리오5 정규화·무승인 거부 암은 Step 4d로 이동 — CS9. 이 단계에는 문서 문구만 남는다.)

**skills/craft/SKILL.md 문구 수준 갱신** (불변식·게이트 질문 형식(:121)·태깅 규약 전부 불변 — C11, (f) 범위):
- :26 (tool inventory): `lsc_craft_release`가 "[Canon Amendment] confirm의 플랫폼 yes 직후에만 성공하도록 **플랫폼이 nonce로 강제**하며, 무승인 호출은 isError"라는 1구절 추가.
- :124 (Approved→ 절차): 3) re-init 서술에 "re-init이 open-release 기록을 close하고 old/new 매니페스트 diff를 감사용으로 남긴다" 1구절, 그리고 release 직후~re-init 전 구간에서 verify/run_tests가 재베이스라인 안내와 함께 거부된다는 1구절 추가.
- :126 (free answer 금지): 현행 유지 — nonce 조건(`confirmed===true`)이 이 산문을 코드로 백업하게 되었다는 언급만 선택적.
- **canonical `fixtures/sample-ts-cli/answers.json` 불변**: `proceed\??$` confirmation 규칙과 default가 `[Canon Amendment] … Proceed?` 질문을 이미 yes 처리(발급은 질문 태그 기준, fixture 규칙 불요) — 변경 없음을 확인 사항으로 기록.

**단위 검증**: `npm test` 전수 green(시나리오5는 LSC_E2E 없이 skip — 개정은 이미 Step 4d에서 완료). e2e는 §7의 최종 검증에서 1회.
**커밋**: `docs: craft 스킬 문구 co-evolution (승인 게이트·open-release 안내)`

### 3.7 커밋 시퀀스 요약 (독립 커밋 가능성)

| Step | 커밋 후 `npm test` | 커밋 후 e2e(LSC_E2E) | 비고 |
|---|---|---|---|
| 1 권위 코어 | green | green | 소비자 없음 |
| 2 증거 스키마 | green | green | 도구 행동 무변화 |
| 3 발급 래퍼 | green | green | 발급만, 소비 없음 |
| 4 소비 게이트 | green (단위 co-evolution 동봉) | **green (시나리오5 co-evolution 동봉 — CS9)** | known-red 구간 없음 |
| 5 open-release 표면 | green | green | |
| 6 SKILL 문구 | green | green | 문서만 |

### 3.8 land 예외 조항 운영 절차 ((h) — Constraint 7, CS10)

이 feature **자신의** land는 개조 **이전** dist로 수행한다. nonce 소비 강제는 다음 feature부터 활성.

**소유권 (CS10)**: canonical post-craft land flow(skills/post-craft/SKILL.md:213-229)는 merge와 worktree 정리까지만 규정하며 **build를 실행하지 않는다**. 아래 one-time build는 자동 land 절차가 아니라 **현재 run의 main orchestrator가 직접 소유하는 운영 step**이다 — feature branch의 SKILL.md에 넣어도 land 전에 이미 로드된 old skill에는 소급 적용되지 않는다.

1. **craft·post-craft 전 과정은 현행(개조 이전) dist 아래에서 진행** — run_test.sh는 vitest로 워크트리 **소스**(`../src` import)를 직접 검증하므로 게이트 로직 검증에 dist 불요. audit-fix 재순환(post-craft REJECT→craft)도 동일하게 무영향.
2. **post-craft의 `[Land]` 승인과 `git merge --no-ff`**(skills/post-craft/SKILL.md:213-229, merge는 :217)는 현행 dist의 무게이트 경로 그대로 수행 — 이중 안전: (i) land는 이 feature의 소비자가 아니고(Non-Goal), (ii) 새 코드가 아직 로드되지 않았다.
3. **terminal gate (완료 판정선, CS10)**: `merge 성공 → main root에서 npm run build(package.json:14) exit 0 → 새 세션 시작 → 다음 craft 허용`. **merge 성공만으로 완료 보고 금지** — main-root build exit 0과 새 세션 handoff까지가 이 feature의 terminal checklist이며, build 성공 전 다음 craft는 금지된다.
4. **실패/누락 복구표 (CS10)**:

| 상황 | 복구 |
|---|---|
| merge **전** main checkout에서 build함 | old source의 build라 무해 — merge **후** main에서 재실행 |
| feature **worktree**에서 build함 | ignored worktree-local `dist/`만 변경, 현재 plugin 무영향 — main에서 재실행 |
| merge 후 build **실패/누락** | **merge rollback 불요** — main source는 남아 있으므로 worktree 제거 후에도 main root에서 `npm run build` 재시도. 성공 전 다음 craft 금지; 그동안 old dist가 계속 동작하고 다음 세션의 drift 배너(main.ts:77-96, session_start 전용)가 경고 |
| build **성공 후** | 현재 세션은 여전히 old dist(이미 로드된 모듈은 불변 — dist hot-reload 경로 없음) — **다음 craft 시작 전 새 세션 필수** |

5. 이 예외는 **이 feature의 land 1회 한정** — post-craft 핸드오프 보고에 본 절 링크와 3의 terminal gate 체크리스트를 명시할 것.

---

## 4. Expanded Test Plan

Stage 4 테스트 작성자 4인이 그대로 집행하는 명세. 공통 관례(trace Lane 5): **비즈니스 mock·스냅샷 전무**(단, SDK 경계의 mock `pi` capture는 리포 선례 test/ask-schema.test.ts:1-42를 따르는 유일한 예외), 실제 싱글턴 + `mkdtempSync(tmpdir())`, 필드별 단언, `beforeEach/afterEach`에서 `clearActiveCraft()`(craft-release.test.ts:8-16 양식). **계층 규율 (CS8)**: pure reducer(match/consume 판정/closeOpenRelease/guidance)는 직접 호출로, SDK-independent effectful core(슬롯 mutator·persist·리더)는 실제 tmpdir fs로, production wiring은 mock `pi`로 capture한 **등록된 execute의 실제 호출**로 검증한다 — 올바른 helper 순서를 수동 재연하는 테스트는 wiring 검증으로 인정하지 않는다(CS7). run_test.sh는 선례(.lsc/crafts/provider-usage-status-bar/test/run_test.sh) 구조를 따르되 **AC7 때문에 전수 `npm test`를 반드시 포함**한다(스코프 축소 금지; e2e 파일은 LSC_E2E 부재 시 자체 skip): assets sync → (node_modules 부재 시 npm ci) → `npm run build`(타입 게이트) → `npm test` 전수 → (LSC_E2E=1일 때만) `npm run e2e` → 집계.

### 작성자별 산출물

**W1 — unit** (`assets/test/destructive-approval.test.ts` 신규 + `craft-release.test.ts` 개정판):
- 슬롯 코어: createPendingApproval(슬롯 무접촉 확인)→installPendingApproval→peek, 재설치 교체(최신 승리), consume 성공→슬롯 클리어, 빈 슬롯 consume `no-pending-approval`, `[Land]` 설치 후 `RELEASE_CONSUMABLE_TAGS` consume `tag-mismatch`+**슬롯 보존**, **mismatch 직후 same-tag `no` confirm이 슬롯을 철회하는 연속 시나리오(CS11)**, identity 불일치 consume `identity-mismatch`+슬롯 보존, invalidate.
- 태그 SSOT·identity: `matchDestructiveGateTag` — 3태그 prefix 정확 매칭, 별칭/부분어("Canon Amendment" 무괄호)/중간 출현 불인정. `sameCraftIdentity` — 참조가 다른 spread 사본은 true, 필드 상이는 false (F-12).
- 생명주기 실효(직접 헬퍼): setActiveCraft/clearActiveCraft/markCraftAborted/loadActiveCraft 각각 후 consume 거부.
- 생명주기 실효(실배선 — CS6 (d)(e)(f)): **fake `pi.on` capture로 `registerCraftStateResets`(state.ts:151-155)가 등록한 `session_switch`/`session_branch`/`session_shutdown` callback을 각각 실행한 후 consume 거부**; **`performCraftAbort`(abort.ts:25-29) 경유 후 consume 거부**; **unclosed openRelease persisted 파일을 `loadActiveCraft`해도 `getActiveCraft()`가 undefined**(record는 반환).
- 발급 트랜잭션(캡처된 lsc_confirm execute — CS6 (a)(b)(c)): **(a) yes 발급 후 same-tag no/free answer/cancel 각각 슬롯 empty(3암)**; **(b) deferred confirm(resolve 지연 제어 fake ui) 대기 중 `clearActiveCraft`/`setActiveCraft` 후 응답이 yes여도 무발급(2암)**; **(c) `.craft-state.json` write 실패 유도 시 durable 증거·슬롯 모두 미설치(1암)**.
- 증거: recordReleaseApproval/recordOpenRelease persist 라운드트립(파일 재독 필드 단언) + persist 실패 시 in-memory 미반영(CS3), consumedAt 스탬프, fingerprint 존재/부재(undefined) 양쪽, **releaseApproval 단일 슬롯 덮어쓰기 — 연속 발급 2회 후 마지막 증거만 잔존(F-14)**.
- pure reducer: hasOpenRelease, closeOpenRelease 진리표 4행(**기폐쇄→동일 closed 승계** 포함 — CS4), openReleaseGuidance의 `lsc_craft_init` 포함.
- craft-release.test.ts 개정: 기존 3 tests에 발급 선행(setActiveCraft **후** install, identity 일치), 거부 4암(무발급/기소비/태그 불일치/identity 불일치).

**W2 — integration** (`assets/test/craft-release-flow.test.ts` 신규 — **actual registered tool execution (CS7)**: mock `pi`(선례 test/ask-schema.test.ts:1-42)로 `registerAskTools`(ask.ts:541)/`registerHashManifestTools`(hash-manifest.ts:385-388)/`registerRunTestsTool`(run-tests.ts:186)의 definitions를 capture하고 **등록된 `execute`를 직접 호출**한다; release 소비는 `performCraftRelease` 직접 호출로 충분 — 등록 execute 본문이 그 1행이다(release.ts:70-72). 실제 tmpdir 프로젝트 루트; helper 조립 시뮬레이션은 production wiring 검증으로 불인정. **AC4 E2E arm의 '재량' 여부와 무관하게 이 integration은 필수다**):
1. lsc_confirm execute(fixture channel, `[Canon Amendment] … Proceed?`, confirmation yes) → durable 발급 증거 commit(파일 재독) → performCraftRelease 성공 — **confirm yes→durable commit→release** 체인.
2. open 상태에서 **actual `lsc_verify_hash`·`lsc_run_tests` execute 거부** + "lsc_craft_init" 안내 (AC4의 필수 방어선).
3. **actual `lsc_craft_init` execute**가 old manifest를 선독해 **rebaselineDiff에 실제 변경 파일을 기록하고 close** (AC5 — 수동 closeOpenRelease 호출이 아니라 production init 경로).
4. close 후 **actual `lsc_verify_hash` execute 복귀**(성공).
5. **두 번째 actual init** 후에도 `releaseApproval`(consumedAt 포함)·closed `openRelease` 증거 보존 (CS4 retention).
6. craft-state **persist 실패 유도 시 actual init execute 실패 + active 미공개**(getActiveCraft()는 기존 값) + persisted open 잔존으로 verify 계속 거부 (CS5 fail-closed).
7. free-answer fixture로 재주행 시 미발급·release 거부 (C6의 fixture 동일 경로 검증 겸용).

**W3 — full-e2e** (`enforcement-rules.test.ts` 시나리오5 개정판 asset — LSC_E2E 게이트 유지):
§3 Step 4d 명세 그대로 — [Canon Amendment] 정규화, 무승인 거부 선행 암("예상된 오류 후에도 다음 단계를 계속하라" 프롬프트 문구 포함), **`executions.filter`로 release 정확히 2건·첫 error/둘째 success·confirm이 두 호출 사이 순서 단언(CS9)**, (재량) open-window verify/run_tests 거부 암, 기존 단언(:403-435) 전부 보존. 프롬프트 확장으로 비결정성이 확인되면 무승인 암을 별도 `it`로 분리할 재량 보유. e2e-full-cycle/e2e-preset-default는 `lsc_craft_release` 무호출(grep 확정) — 무변경.

**W4 — regression** (`craft-state.test.ts` 확장판 + run_test.sh):
- AC6: 신규 필드 없는 구버전 `.craft-state.json`을 손으로 써서 loadActiveCraft/findPersistedCraftState/readPersistedCraftState 관용 파싱, hasOpenRelease false, run_tests 가드 메시지가 기존 문자열("no active craft … Call lsc_craft_init first.")과 동일.
- 신규 필드 roundtrip(persist→재독), clearActiveCraft 후 파일 잔존(:138 주석 계약), loadActiveCraft(closed/무 openRelease만 싱글턴 대입 — unclosed는 미승격) vs findPersistedCraftState/readPersistedCraftState(무접촉) 구분 단언.
- 기존 스위트 **33파일**(F-11 — 실측 33개) 무수정 통과가 곧 AC7 — run_test.sh의 전수 `npm test` 단계가 기계 검증.

### AC 매핑표 ((g))

| AC | unit | integration | e2e (LSC_E2E) | observability |
|---|---|---|---|---|
| 1 무승인 거부 | W1: 무발급 consume·performCraftRelease 거부 암 | W2-1 변형: confirm 없이 release 거부 | W3: confirm 이전 release 선행 암 isError | 거부 메시지 anchor substring |
| 2 승인 직후 성공 | W1: 설치→release 성공(기존 text/details exact 단언 유지) | W2-1: actual confirm(yes)→durable commit→release 체인 | W3: 시나리오5 본류(:403-406 유지) | success text 불변 계약 |
| 3 일회용 | W1: 기소비 재-consume 거부 + 슬롯 클리어 단언 | W2: 성공 후 재호출 거부 | — (단위가 소유 — spec AC 서두 "vitest 순수 계층" 허용) | ConsumeApprovalResult.reason 구분 |
| 4 open-release 봉쇄 | W1: hasOpenRelease·guidance("lsc_craft_init" 포함) | **W2-2 (필수, CS7): open 상태 actual verify/run_tests execute 거부+안내** | W3(재량 암) | 안내 문구 substring 계약 |
| 5 재베이스라인 복귀 | W1: closeOpenRelease 진리표 | W2-3~5: actual init execute 후 closedAt+rebaselineDiff+판정 해제·**2차 init 증거 보존(CS4)** | W3: 재-init 후 "hash verification passed"(기존 단언) | rebaselineDiff 내용 = 실제 변경 파일 |
| 6 구버전 관용 | W4: 구 shape 로드 전 경로 | — | — | 기존 가드 메시지 문자열 동일성 |
| 7 무회귀 | W4/run_test.sh: 전수 `npm test` + `npm run build` 타입 게이트 | — | 번들 e2e (land 전 1회) | drift 배너·기존 **33** 테스트 파일 무수정 |

관측(observability) 계약 요약: (i) durable 원장 필드(`releaseApproval`/`openRelease` 전 필드)가 post-craft 감사의 직접 입력 — 파일 직독으로 태그·응답 원문·reason·지문·diff 확인 가능해야 함. (ii) 거부 메시지 3종(release 무승인/verify open/run_tests open)은 스냅샷이 아닌 안정 substring으로 테스트에 앵커. (iii) fingerprint·diff는 감사 서사용이며 권위가 아님을 필드 주석에 명시.

---

## 5. Pre-mortem (7 시나리오)

1. **P1 — 재베이스라인 후에도 verify가 계속 거부** (close가 디스크 미반영): setActiveCraft가 persist하지 않는다고 오인하면 closedAt이 메모리에만 남고, 재시작 후 verify가 stale open을 읽어 세션 진행을 막는다(Constraint 7 위반). → **해소 완료**: state.ts:73-76 실측으로 persist 확인 + CS3 통일로 persist 성공이 publish의 선행 조건(§3 Step 1/5b). 방어: W2-3/4의 actual init→verify 복귀 단언이 회귀를 잡는다.
2. **P2 — 발급 조건 과소/과대**: free answer(`confirmed===null`)나 envelope 텍스트를 yes로 오인하면 게이트 우회, 태그 부분 매칭 실패나 isError 발급이면 정상 플로우 차단. → 방어: `details.confirmed === true` 정확 비교(문자열 비교 금지) + W1 발급 트랜잭션 매트릭스.
3. **P3 — init 선독 순서 위반**: previousManifest를 saveManifest(:265) **후**에 읽으면 old=new가 되어 diff가 항상 빈 배열 — AC5의 diff 기록이 무의미해진다. → 방어: §3 Step 5b가 트랜잭션 순서 ①~⑥을 명문화, W2-3이 **actual init execute 경로**에서 "diff에 실제 변경 파일 등장"을 내용 단언(CS7 — 수동 재연이면 이 회귀를 못 잡는다).
4. **P4 — 시나리오5 프롬프트 확장 비결정성**: 단계 수 증가로 실제 LLM이 스크립트를 이탈해 e2e flake. → 방어: earlyExit 앵커 유지 + 단계별 명령형 문장 유지 + "예상된 오류 후 계속" 명시(CS9) + W3에 별도 `it` 분리 fallback 재량을 계약으로 부여.
5. **P5 — land 운영 오류** (CS10로 교체): 잘못된 checkout(merge 전 main, 또는 feature worktree)에서 build하거나, build 성공 확인 없이 다음 craft를 시작하는 운영 오류. (build는 실행 중 세션의 이미 로드된 모듈을 바꾸지 않는다 — dist hot-reload 경로 없음, drift 체크는 session_start 전용 main.ts:77-96.) → 방어: §3.8 terminal gate(merge 성공→main build exit 0→새 세션→다음 craft)와 복구표 4항 + post-craft 핸드오프 체크리스트.
6. **P7 — persist 실패 경로의 fail-open** (F-13): durable write 실패 후 (i) 발급 훅이 capability를 이미 설치했거나 (ii) init이 durable close 없이 active를 공개하면 게이트가 조용히 무력화된다. → 방어: Step 3 (e) persist-before-install + Step 1/2의 CS3 persist-before-publish + Step 5b 실패 의미론; W1 발급 트랜잭션 (c) 암과 W2-6이 회귀를 잡는다.
7. **P8 — stale yes** (F-13): 발급 후 소비 전에 same-tag 질문에서 no/free answer/cancel이 나와도 이전 yes capability가 남으면 "방금 승인" 계약이 깨진다 — 이 경로는 전이 4지점을 하나도 지나지 않아 lifecycle 실효만으로는 못 막는다. → 방어: Step 3 (b) tagged prompt 진입 시 무조건 선철회; W1 발급 트랜잭션 (a) 3암 + CS11 연속 시나리오(mismatch 후 same-tag no 철회)가 회귀를 잡는다.

(+P6 소소: state⇄destructive-approval 순환 import — 방어: destructive-approval은 repo-internal runtime 무의존 규칙(§3 Step 1), 증거 타입은 state 소유, closeOpenRelease는 hash-manifest 소유로 방향 고정.)

---

## 6. Risks & Mitigations

| # | 위험 | 완화 / 수용 근거 |
|---|---|---|
| R1 | **V2 잔존**: 모델이 enforcement fail-open 갭으로 `.craft-state.json`을 위조·삭제하면 open-release 증거가 사라져 verify가 기존 폴백으로 복귀 | 수용된 트레이드오프(spec C2·C5, trace §5): 소비 **권위**는 메모리라 release 게이트 자체는 불변. 증거는 판별·감사용이며, post-craft가 원장 이력을 검토. enforcement 확장은 명시 비목표 |
| R2 | fixture catch-all default({confirm:true}, fixtures/sample-ts-cli/answers.json:47-50)가 게이트 질문을 자동 yes | 위협 아님(trace V6): LSC_FIXTURE는 운영자 seam, 발급은 **정상 경로**로 일어난다. `_warning`(:3)이 실리포 사용을 이미 금지. 무변경 |
| R3 | scenario5 확장으로 e2e 비용·flake 증가 | 단일 runOmpPrint 유지, earlyExit 불변, "예상된 오류 후 계속" 문구(CS9), 분리 fallback(W3 재량). e2e는 land 전 1회만(§7) |
| R4 | 발급 훅의 durable 증거 persist가 디스크 오류 시 confirm 결과를 도구 오류로 승격 | **persist-before-install**(Step 3 (e))이라 실패 시 capability·증거 모두 미설치 — fail-closed가 기본값(CS2). 예외 전파 정책은 기존 markCraftAborted(:132-136)·recordTestResult(:113-129)와 일관. 발생 확률·영향 미미 |
| R5 | worktree/cwd 이중 후보에서 stale 상태 파일 오독 | init은 exact-root 리더(readPersistedCraftState)로 후보 추측 자체를 제거(CS4), inactive lookup은 **open 우선** 규칙으로 stale closed가 open을 은폐 불가(CS4) + W1/W4 단위 단언 |

(구 R6 — Step 4~6 known-red e2e 구간의 회귀 오인 — 은 CS9의 Step 4 co-evolution으로 구간 자체가 제거되어 삭제.)

---

## 7. Verification Steps

**계획 단계(본 문서)에서는 어떤 테스트도 실행하지 않는다** (오케스트레이터 제약). 이하는 executor/크래프트 루프의 검증 절차다.

1. **단계별** (§3 각 Step): 해당 좁은 vitest 파일만 — `npx vitest run test/craft-release.test.ts` 등. 프로젝트 전체 스위트·린트는 단계에서 실행하지 않는다.
2. **루프 게이트** (매 iteration): `lsc_verify_hash` → `lsc_run_tests` (= Stage 4 run_test.sh: assets sync → build 타입 게이트 → 전수 `npm test` → LSC_E2E 조건부 e2e → 집계). AC 1-7 전부 여기서 기계 판정.
3. **최종** (land 전 1회): `npm run e2e` (LSC_E2E=1, 실 토큰) — 시나리오5 개정판 + 기존 번들 green 확인.
4. **관측 수동 확인 1회**: release→re-init 실주행 후 `.lsc/crafts/{feature}/test/.craft-state.json`을 직독해 `openRelease.closedAt`·`rebaselineDiff`·`releaseApproval.consumedAt`이 post-craft 감사가 읽을 수 있는 형태인지 확인 — 증거가 재-init을 넘어 승계되므로(CS4) 이 확인은 2차 init 후에도 유효하다.
5. **land terminal gate 검증 (CS10)**: §3.8-3의 terminal gate — `merge 성공 → main root npm run build exit 0 → 새 세션 시작 → 다음 craft 허용` — 를 main orchestrator의 체크리스트로 확인. merge 성공만으로 완료 보고 금지, build 실패/누락 시 복구표(§3.8-4) 적용.

---

## 8. ADR

**Decision**: 신규 `src/craft/destructive-approval.ts`가 파괴적 게이트 태그 SSOT(`[Canon Amendment]`/`[Land]`/`[Hash Violation]`)와 in-process 단일 pending-approval 슬롯(권위)을 **generic**하게 소유한다 — 소비자 허용 집합 `RELEASE_CONSUMABLE_TAGS = ["[Canon Amendment]"]`는 소비자 모듈 release.ts가 소유(CS1). capability는 tag뿐 아니라 **craft identity(feature/projectRoot/worktreeRoot — 필드 동등 비교, 참조 비교 금지, F-12)**에 bind된다. state.ts가 optional 증거 원장(`releaseApproval?`/`openRelease?` — 각각 단일 슬롯, 새 증거가 덮어씀 F-14)과 싱글턴-무접촉 리더 2종(exact-root/open-우선 — CS4)을, hash-manifest.ts가 close+diff+지문을 소유한다. **발급은 lsc_confirm execute 래퍼의 트랜잭션(CS2)**: tagged prompt 진입 시 기존 pending 선철회 → confirm await → `!isError && confirmed===true` && identity 동등 → durable 증거 persist 성공 → install. **소비**는 performCraftRelease의 single-use 검증(무발급·기소비·tag/identity 불일치 isError). **state mutation은 invalidate→persist(next)→publish로 통일(CS3)**하고 active craft와 unclosed open-release의 비공존 불변식을 setActiveCraft(거부)/loadActiveCraft(미승격)에 강제한다. open-release는 verify 신설 게이트+run_tests 메시지 업그레이드로 봉쇄하고, init은 `exact-root 선독→old manifest 선독→compute→manifest save→snapshots→closed 증거 포함 persist→active publish` 트랜잭션(CS5)으로 close하며, **closed 증거와 releaseApproval은 다음 release가 교체할 때까지 승계**한다(CS4). 이 feature의 land는 개조 이전 dist로 수행하고 `merge 성공→main build exit 0→새 세션` terminal gate로 마감한다(§3.8, CS10).

**Drivers**: §2 Decision Drivers 3항 (보안 MEDIUM fail-closed + 정상 플로우 0 손상 / pure reducer 검증 + SDK-independent import 가능성 / 부트스트랩 무차단).

**Alternatives considered**:
- state.ts 단일 확장(Option B) — lifecycle 원자성 장점은 실재하나, 휘발성 권위가 durable CraftState와 한 모듈에 공존해 우발 직렬화 위험. **당초의 "회귀 반경 축소" 논거는 철회**(양 안 모두 state.ts 전이 4함수를 수정 — CS1); 원자성 이득은 CS3 commit point 통일+실배선 테스트로 흡수하고, **"휘발성 권위의 우발적 직렬화 방지" 경계를 위해 별도 generic 모듈을 채택**.
- release.ts 게이트 내장(Option C) — 발급/소비 대칭 파괴·의존 역전으로 무효화.
- 파일-권위안(trace H2) — EXCLUDED+fail-open 매체에 권위 저장은 자기모순, spec 단계에서 기각(재확인만).
- verify+run_tests 동격 신설 게이트(trace H3) — run_tests 기존 가드가 이미 fail-closed, spec C8이 메시지 업그레이드로 확정(재확인만).
- 별도 gate-tags.ts SSOT 모듈 — 비-게이트 소비자 부재로 YAGNI; `DESTRUCTIVE_GATE_TAGS`는 destructive-approval.ts 상수, 소비자 허용 집합은 release.ts 소유로 시작(CS1).
- **tag/identity-mismatch 시 슬롯 즉시 소각 — 조건부 비소각 채택 (CS11)**: mismatch는 isError+pendingTag만 반환하고 슬롯을 보존한다 — 잘못된 소비자 호출 1건이 미래 [Land]/[Hash Violation] 소비자의 정당 승인을 파괴하는 승인-DoS 방지(태그는 공개 상수라 mismatch가 secret-probing oracle도 아님). **단, 다음 이벤트는 반드시 invalidate한다**: (i) 새 destructive prompt 시작(결과 무관 선철회 — Step 3 (b)), (ii) craft identity 변화, (iii) abort/세션 전이/재-init(전이 4지점), (iv) 증거 persist 실패. 이 조건 집합 아래에서만 비소각이 "승인 직후" 계약과 양립한다(architect 합의 조건 4항 — availability 이득 > security 비용). W1의 "mismatch 후 same-tag no가 슬롯 철회" 연속 시나리오가 이 계약을 고정.
- details에 nonce/tag 노출 — durable 원장과 중복 + 기존 exact 단언 파손 대비 이득 없음, 기각.

**Why chosen**: 세 원칙(권위 비직렬화 경계의 물리화 · pure reducer 검증+SDK-independent import 가능성 · 최소 표면)을 동시에 만족하면서 import 그래프가 단방향으로 남는 유일 구조. 모든 결정은 pure reducer로 검증하며 effectful adapter도 SDK runtime value 없이 import 가능해(CS8) AC의 "실 LLM 불요" 요구와 기존 6파일 관례에 정합.

**Consequences**: ask.ts가 처음으로 craft 계층을 알게 된다(단방향, execute 래퍼 1곳) · state.ts 전이가 persist-before-publish로 바뀌어 write 실패가 in-memory 공개를 남기지 않는다(CS3) · active+unclosed-open 비공존 불변식이 setActiveCraft/loadActiveCraft에 강제된다 · release는 hash-manifest에 신규 의존(지문) · 다음 feature부터 무승인 release가 전면 거부된다(스킬 계약 위반 조기 검출) · 모든 커밋 시점에 `npm test`·e2e 계약이 일관된다(CS9 — known-red 구간 없음) · `.craft-state.json`이 감사 원장 역할을 겸하고 증거가 재-init을 넘어 승계되어(CS4) post-craft 입력이 풍부해진다.

**Follow-ups**: (i) Phase 5 — [Land] 소비자 배선(merge 차단, 발급 인프라는 본 작업으로 완비) (ii) lsc_restore_tests의 [Hash Violation] 소비 게이트 후보 (iii) CraftState 스키마 버전 필드(E-3 승계) (iv) enforcement fail-open 갭 실증 프로브(trace §9 probe 2 — 비목표이나 V2 정량화 가치) (v) land terminal gate(§3.8-3) 완료 확인 및 예외 조항 폐기 기록.
