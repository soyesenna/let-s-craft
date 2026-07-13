# Plan — model-preset-session-default

| Field | Value |
|---|---|
| Feature | model preset 세션 default 모델 설정 지원 |
| Input | [spec.md](./spec.md) (확정, ambiguity 0.0465) · [trace.md](./trace.md) · [research/SYNTHESIS.md](./research/SYNTHESIS.md) |
| Worktree | `.lsc/worktrees/model-preset-session-default/` (branch `feat/model-preset-session-default`) — 모든 구현·검증 커맨드는 이 워크트리에서 실행 |
| Scope | src 6개 파일(1개 신규) + test 4개 파일(2개 신규) + docs 2개 + package.json + e2e-helpers |
| Estimated complexity | **MEDIUM** |
| Review status | Architect: **라운드1 반영 완료 · 라운드2 완료(편집 지적 반영 확인)** · Critic: **라운드1 REVISE(블로킹 M1 1건 + 비차단 5건) → 본 리비전에 전량 반영, 재심 대기** |

이 플랜의 모든 `file:line`은 **현재 소스에서 직접 재확인**한 값이다(트레이스 인용 재검증 포함). 핀 고정 호스트 계약(§Contract)은 trace/research에서 다중 검증 완료 — 재논증하지 않고 그대로 사용한다.

**리비전 이력 (라운드1 아키텍트 반영):** ① B1(블로킹) — `isFreshMainSession`에 스탬프 타입별 개수 상한(≤1) 추가로 사이클-무턴-resume 클로버 반례 폐쇄(Step 0·3, AC4 매트릭스 ⑥⑦, R2 잔여 공지, DR-B2 과대 주장 정정); ② DR-C 기본안을 C2(agents-only + validate 가드)로 전환, C1은 사용자 선택 대안 존치; ③ Step 3에 컴파일 타임 시임 충족 증명(spike.ts `Assert` 관례) 추가; ④ 게이트 거부 debug 히스토그램(관측성, 신규 R10); ⑤ trivia — R2 ACP 미검증 공지, e2e default 모델 env 오버라이드+R6 주석, README `/new` 문구 교정, Step 6.4 분리 필드 어서션.

**리비전 이력 (라운드1 크리틱 반영):** ① M1(블로킹) — command.ts reinject의 default 단계를 명시 요청 플래그 `applyDefaultFor`로 제한: **runSwitch 항상 + runCreate는 생성 프리셋이 자동 활성화된 경우만; runEdit/runDelete는 에이전트 오버라이드 재주입만(default 재단언 없음)** — 스펙 제약 2가 즉시성을 switch/create에만 부여하고 수동 `/model`은 항상 우선·재적용 없음이기 때문(Step 4, Work Objectives, Guardrails, §2 AC3·AC5, DR-A, ADR, Verification 5 정합); ② 프로브 시나리오 4 교정 — `ctx.models.resolve`는 auth-필터라 미인증 모델은 resolve 경유로 `setModel→false`에 도달 불가, 프로브에서 `Model` 객체 직접 구성으로 명시; ③ Step 2 예약 키 가드를 `agents` 키로 확장(agents-as-string 오기가 평면 분기로 흘러 경고 없는 팬텀 `lsc-agents`가 되는 엣지 차단 — AC7·R4·DR-C 정합); ④ 스코프 src 파일 수 5→6 정정; ⑤ README에 `LSC_DEBUG` 게이트 진단 문서화 추가(Step 5); ⑥ AC3 'e2e 관찰'의 대리(proxy) 충족(AC1 e2e + 수동 스모크) 명시.

---

## 0. Context 및 신규 소스 발견 사항 (리뷰어 필독)

스펙·트레이스가 확정한 통합 시임은 `models-file.ts → validate.ts → inject.ts → command.ts → main.ts`이며 그대로 따른다. 다만 플랜 단계의 소스 재탐사에서 **스펙 문면과 충돌하는 호스트 사실 2건**을 확인했고, 이 플랜은 이를 반영해 설계했다 (→ DR Decision B, 리스크 R2, open-questions.md #1):

**(F1) 신규 세션도 `session_start` 시점에 entries가 0이 아니다.**
핀 16.4.0 `sdk.ts`의 `createAgentSession`은 **새 세션 분기에서** 세션 생성 직후 `sessionManager.appendModelChange(...)`(model 해석 성공 시, `node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts:2796-2803`)와 `appendThinkingLevelChange(...)`(auto가 아닐 때, `sdk.ts:2804-2808`), `appendServiceTierChange(...)`(`sdk.ts:2809-2811`)를 기록한다. 이 append들은 실제 `getEntries()`에 노출되는 엔트리다(`session/session-manager.ts:1474-1505`의 `#recordEntry`). `session_start`는 그 뒤에 발화한다(4개 사이트: `modes/runtime-init.ts:141`, `modes/controllers/extension-ui-controller.ts:255-257`, `modes/acp/acp-agent.ts:2284`, `task/executor.ts:2404`). 따라서 **스펙 문면의 `getEntries().length === 0` 게이트는 인증된 모델이 있는 정상 부팅에서 절대 참이 되지 않는다** — 문면 그대로 구현하면 자동 적용 절반이 사장(dead)된다. 이 플랜은 스펙의 *의도*(신규 세션에서만 자동 적용, resume·서브에이전트 무간섭)를 "부트 스탬프 allowlist" 술어로 구현한다(Step 3, DR Decision B). W3 연구가 "exact semantics per emit site = implementation-time probe"로 명시적으로 유보했던 바로 그 지점이다.

**(F2) task-executor 서브에이전트 세션은 `session_start` 발화 전에 `session_init` 엔트리를 갖는다.**
핀 16.4.0 `task/executor.ts`는 서브에이전트 스폰 시 `session.sessionManager.appendSessionInit({...})`(`task/executor.ts:2327`)를 먼저 기록한 뒤 서브에이전트 전용 ExtensionRunner를 **`setModel: model => runExtensionSetModel(session, model)`이 서브에이전트 세션에 바인딩된 풀 액션 세트로** 초기화하고(`task/executor.ts:2382`) `session_start`를 emit한다(`task/executor.ts:2404`). 즉 (a) 우리 핸들러는 서브에이전트 세션에서도 실행되고, (b) 거기서 `pi.setModel`을 부르면 **스폰 모델(agentModelOverrides/부모 상속)을 프리셋 default로 덮어써 AC2를 파괴**하며, (c) `session_init` 엔트리의 존재가 서브에이전트 세션을 기계적으로 배제하는 판별자다 — 호스트 전체에서 `appendSessionInit` 호출 사이트는 이 1곳뿐이므로(정의 `session-manager.ts:1508-1519`) `session_init`은 서브에이전트 **배타** 판별자다(라운드1 검증). F1의 스탬프 allowlist 술어는 `session_init`을 허용하지 않으므로 **하나의 술어가 resume 배제와 서브에이전트 배제를 동시에 해결**한다.

추가 확인: 확장 `pi.setModel` 경로는 `AgentSession.setModel(model, role = "default")`로 들어가 `model_change role="default"` 엔트리를 남기고(`session/agent-session.ts:8927-8947`), 대화형 `/model` 다이얼로그 픽도 `role="default"`로 스탬프된다(`modes/controllers/selector-controller.ts:631-636`). 반면 부트 스탬프(`sdk.ts:2802`)와 사용자 모델 **사이클** 계열(`#cycleScopedModel`/`#cycleAvailableModel`, `agent-session.ts:9144-9145, 9175-9176`)은 role 미지정이라 **`{type, role}` 형상이 서로 동일**하다 — 타입·role 검사만으로는 구분할 수 없다. 제3의 판별자는 **다중성(multiplicity)**: 신선 부팅은 각 스탬프 타입을 최대 1회만 기록하므로(`sdk.ts:2801-2811`이 루프 없는 직선 `if` 3개), 동일 타입의 반복 출현은 부팅 후 활동의 증거다. 게이트는 이를 스탬프 타입별 개수 상한(≤1)으로 반영한다(라운드1 B1 반영; Step 3, DR Decision B, R2). `AssistantMessage`는 `provider`/`model` 필드를 가진다(`node_modules/@oh-my-pi/pi-ai/dist/types/types.d.ts:542-549`) — AC1 e2e 어서션 표면.

> 참고(오염 방지): 리포 루트의 `pi/` 트리는 **업스트림** `@earendil-works/pi-coding-agent@0.80.6`이다(내장 task 툴·agentModelOverrides 없음). 호스트 계약 검증은 반드시 `node_modules/@oh-my-pi/pi-coding-agent/src/`(핀 16.4.0)에 대해 하라. 이 플랜의 호스트 인용은 전부 후자다.

## Work Objectives

활성 프리셋의 선택적 `default` 모델이 (1) 명시적 `/lsc-preset` switch 시 항상, create 시 생성 프리셋이 자동 활성화된 경우 즉시(**edit/delete는 default를 재적용하지 않음** — 스펙 제약 2, M1), (2) **신규** 메인 세션의 `session_start`에서 자동으로, omp 세션 메인 모델을 `resolve → setModel → splitEffort → setThinkingLevel` 경로로 전환한다. 미지정 lsc 에이전트는 부모-live 상속으로 자동 추종한다.

### Guardrails — Must Have (스펙 제약 전문 준수)
- 스키마: `presets.<name> = { default?: "provider/model[:effort]", agents: {...} }` 구조 변경 + **레거시 평면 맵 관용 파싱**(agents-only).
- 신규 세션 게이트(의도 보존: resume/서브에이전트 절대 무간섭), **명시 즉시 적용은 switch/create(자동 활성화 시)에 한정 — edit/delete는 default 무재적용(수동 `/model` 항상 우선·재적용 없음, 제약 2 — M1)**, 복원 없음(R6), 소프트 실패(R7: 명시적=notify 경고+부분 활성화, 자동=조용한 경고+skip, `setModel→false` 동일), create/edit에서 default 질문 최우선(skip 가능), 호스트 설계 법칙(N6: persisted modelRoles 불가침, 영속화는 models.yaml뿐), 머지(agents 에이전트 단위 / default 프로젝트 우선), C13(경고+drop+폴백).

### Guardrails — Must NOT Have
- config.yml/modelRoles 쓰기, 스냅샷/복원, dirty-state 라벨/폴링, 파일 잠금, 보조 모델 슬롯, 호스트 업스트리밍 (전부 스펙 Non-Goals).
- `applyActivePreset`의 비동기화로 기존 순수 시임을 오염시키는 것 (DR Decision A).
- 포매터/린터/프로젝트 전체 테스트 실행.

---

## 1. Implementation Steps

의존성: Step 1→2→4, Step 3은 1·2와 독립(병행 가능), Step 4는 1–3 이후, Step 5는 4 이후, Step 6은 전체 이후. **Step 0(프로브)은 executor 반복 1 이전에 실행.**

### Step 0 — 판별 프로브 (trace §9.2 확장; 코드 머지 전 실행)

**대상:** 신규 일회용 스크립트(예: `scripts/spike-session-default-probe.sh` + 15줄 프로브 확장 `.mjs`) — 격리 `--profile`, `scripts/spike-e2e-verify.sh`의 세션 파일 해석 절차 재사용(`scripts/spike-e2e-verify.sh:109-117`).

**내용:** `session_start`에서 `JSON.stringify(ctx.sessionManager.getEntries().map(e => ({type: e.type, role: e.role})))`를 notify/stderr로 찍고, `ctx.models.resolve(spec)` → `pi.setModel(model)` → `pi.setThinkingLevel(effort)`를 수행하는 프로브 확장으로 다음 5개 시나리오를 1회씩 관찰:
1. 신규 헤드리스 세션(`omp -p --mode=json`): 첫 assistant 턴 모델 = 전환 모델인가 (H1 mechanics), entries 스탬프 구성 확인.
2. `--continue` resume: entries에 message 엔트리 존재 확인(게이트 침묵 확인).
3. task 서브에이전트 스폰: 서브에이전트 세션 `session_start`의 entries에 `session_init` 포함 확인.
4. `setModel→false` 소프트 경로 + `:effort` 말단 동작. **주의(라운드1 크리틱):** 어댑터의 `ctx.models.resolve`는 auth-필터라 미인증 모델은 resolve 자체가 undefined를 반환 — resolve 경유로는 이 경로에 도달할 수 없다. 프로브 확장에서 미인증 provider의 `Model` 객체를 **직접 리터럴로 구성**해 `pi.setModel(model)`에 전달하고 `false` 반환을 관찰한다(별도로 유효 모델에 `:effort` 접미사를 붙여 resolve의 effort 폐기·`setThinkingLevel` 말단 동작 확인).
5. **사이클-무턴-resume(라운드1 B1 반례):** 신규 대화형 세션에서 모델 사이클 단축키로 전환 → 메시지 0건으로 종료 → `omp --continue`. resume된 세션의 entries가 `[model_change(무role), (thinking_level_change), model_change(무role)]` 형상(동일 타입 2회 출현)인지 관찰 — 강화 게이트(개수 상한)가 **false**를 반환해야 하는 시나리오.

**수용 기준:** 5개 관찰이 Step 3 게이트 술어(allowlist + role + 타입별 개수 상한)와 일치. 불일치 시 **여기서 멈추고** allowlist/상한을 관찰값으로 조정한 뒤 plan 리비전(리스크 R2 완화 절차). 이 프로브 산출 로그는 craft 검증 증거로 보존.

### Step 1 — 스키마: `PresetEntry` + 관용 파싱 + 머지 (`src/preset/models-file.ts`)

**심볼 단위 변경:**
- `PresetModels`(`models-file.ts:18`)는 **agents 맵 타입으로 존치**. 신규:
  ```ts
  export interface PresetEntry {
    /** Optional session-default model `provider/model-id[:effort]` — switches the omp session main model. */
    default?: string;
    /** Per-agent overrides (agent short name -> model pattern). */
    agents: PresetModels;
  }
  ```
- `ModelsFile.presets`(`models-file.ts:24`): `Record<string, PresetModels>` → `Record<string, PresetEntry>`.
- `isPresetModels`(`models-file.ts:52-55`) 존치(평면 맵 판별) + 신규 `isPresetEntryShape(value)`: object이고 키가 `{default, agents}` 부분집합이며 `default`는 string|null|undefined, `agents`는 평면 문자열 맵(생략 시 `{}`)일 때 true.
- `parseModelsFile`(`models-file.ts:58-82`) 프리셋 루프(`:73-79`) 재작성 — 값 판별 순서:
  1. **구조형** (`isPresetEntryShape`) → `{ ...(default 있으면 { default }), agents: { ...agents } }`로 정규화(`default: null`은 부재 취급).
  2. **레거시 평면 맵** (`isPresetModels`) → `{ agents: { ...value } }` — 문면 그대로 **agents-only**(DR Decision C = **C2**). 평면 맵 안의 `default` 키도 파스에서는 변형 없이 agents로 보존되며, 팬텀 `lsc-default` 오라우팅 차단은 Step 2의 validate 단계 예약 키 가드(경고+drop)가 담당한다(open-questions #2 — 사용자가 DWIM을 명시 선호하면 이 지점의 파스 승격(C1)으로 1블록 치환).
  3. 그 외 → 기존 관례대로 throw. 에러 메시지를 두 수용 형태를 안내하도록 갱신(예: `preset "${name}" must be an agent->model map or { default?, agents }`).
- `mergeModelsFiles`(`models-file.ts:95-101`): 프리셋별 머지를
  ```ts
  const mergedDefault = override.presets[name]?.default ?? base.presets[name]?.default;
  presets[name] = {
    ...(mergedDefault !== undefined ? { default: mergedDefault } : {}),
    agents: { ...base.presets[name]?.agents, ...override.presets[name]?.agents },
  };
  ```
  로 변경 — `default`는 `active`(`:100`)와 동일한 `?? ` 우선 규칙(프로젝트 값 오버라이드, 프로젝트 부재 시 전역 상속; **삭제(erase)는 이번 버전 미지원** — docs에 명기). agents는 기존 에이전트 단위 머지(스펙 제약 7).
- `saveModelsFileAt`(`models-file.ts:109-112`) 코드 불변 — 산출 YAML이 항상 구조형이 됨(default 없으면 `agents:`만). 구버전 파손은 스펙이 감수(v0.1.0); README에 명기(Step 5).
- `loadModelsFileAt`/`loadEffectiveModelsFile`(`models-file.ts:85-88, 104-106`) 불변.

**컴파일 파급(전수 조사 완료):** `validate.ts:6,49`(Step 2), `inject.ts:32-37`(Step 4), `command.ts` 전 플로우(Step 5), `test/preset-models.test.ts:27,31,35,43,49-66,84-93`(구조형 기대값으로 갱신 — trace lane 1의 4개 `toEqual` 리터럴 + merge/round-trip), `test/e2e-helpers.ts:33`(LSC_AGENT_NAMES만 import — 무영향).

**수용 기준:** (a) `writeCheapModelPreset`이 쓰는 평면 YAML(`test/e2e-helpers.ts:301-309`)이 agents-only로 파싱; (b) 구조형 round-trip `parse(stringify(x)) == x`; (c) 머지 규칙 유닛 통과; (d) 평면 맵 내 `default` 키가 파스 단계에서 변형 없이 agents로 보존됨(C2 — 차단은 Step 2 가드의 소관이며 거기서 유닛 고정).

### Step 2 — 검증: `default` 필드 C13 + 예약 키 가드 (`src/preset/validate.ts`)

**심볼 단위 변경:**
- `validatePreset`(`validate.ts:49-65`): 시그니처 `preset: PresetModels` → `preset: PresetEntry`. 본문 루프는 `Object.entries(preset.agents)`로.
- `PresetValidation`(`validate.ts:21-26`)에 `defaultSpec: string | null` 추가 — 검증 통과한 default 원문 spec(effort 접미사 포함), 부재/드롭 시 null.
- **예약 키 가드(C2, DR Decision C — 라운드1 전환; 라운드1 크리틱으로 `agents` 키 확장):** 에이전트 루프 **진입 전에** `preset.agents`의 예약 키 `"default"`·`"agents"`를 검사 — 존재 시 각각 `warnings` push + 해당 키를 루프에서 제외(에이전트 오버라이드 미적용):
  - `` `"default" is not an agent — to set a session default model, use the structured form ({ default: "...", agents: { ... } }); entry dropped` `` (문구는 구현 재량, 구조형 안내 필수; `agents` 키용 문구도 동형 — 예: `` `"agents" is not an agent — expected a map; use { default?, agents: { ... } }; entry dropped` ``)
  - 근거: 현행 `validatePreset`은 키 이름을 LSC_AGENT_NAMES와 대조하지 않으므로(`validate.ts:53-64` — 모델만 resolve되면 `toTaskAgentName(agent)`로 무조건 통과), 가드 없이는 평면 유래 `default` 키가 **팬텀 `lsc-default` 오버라이드로 실제 적용**된다(Tier-1 재현, R4). 이 가드가 유일한 차단 지점이다.
  - `agents` 키 케이스(라운드1 크리틱 nit): 구조형을 의도한 파일이 `agents`를 맵이 아닌 **바닥 문자열**로 잘못 적으면(`{ default: "...", agents: "provider/model" }`) `isPresetEntryShape`에서 탈락하되 값이 전부 문자열이라 `isPresetModels`는 통과 — 평면 분기로 흘러 `default`·`agents` 두 키가 agents 맵에 들어온다. `default`만 가드하면 `agents` 키가 **경고 없는 팬텀 `lsc-agents` 오버라이드**로 적용되므로 두 키를 함께 가드한다.
- default 검증 블록(agents 루프와 동일 정책, C13): `preset.default` 존재 시 `splitEffort`(`validate.ts:37-42`) → effort 있으면 `isEffort`(`validate.ts:28-30`) 검사 → `isModelAvailable(base)` 검사. 실패 시 `warnings`에 push + drop(`defaultSpec: null`):
  - `` `default: invalid effort ":${effort}" (expected ${EFFORT_LEVELS.join("|")}) — keeping current session model` ``
  - `` `default: model "${base}" not found or not authenticated — keeping current session model` ``
- 기존 에이전트 경고 문구(`validate.ts:55,59` "using session model")는 **불변** — H1 상속 의미에서 여전히 참(미지정/드롭 에이전트는 세션 모델로 폴백하고, 그 세션 모델을 default가 정할 뿐). trace lane 3이 지목한 파손 표면이지만 문구 자체는 유효.
- `EFFORT_LEVELS`(`validate.ts:9`)/`splitEffort` 불변.

**수용 기준:** AC7 유닛(형식/effort/resolve 위반 3종 → 경고+drop, 유효 시 `defaultSpec` 전달; **agents 맵의 예약 키 `default`/`agents` → 각각 경고+drop, `valid`에 미포함**) + 기존 `test/preset-validate.test.ts:23-60` 전 케이스가 `{agents: {...}}` 래핑만으로 통과.

> **테스트-계약 각주(라운드1 테스트 아키텍트 N3):** default 검증의 "형식" 위반에는 provider 슬래시 부재(`no-slash-model` 류)가 포함된다 — Step 2 본문의 "에이전트 엔트리와 동일 정책" 서술이 명시하지 않지만 AC7·스펙 제약 8(`provider/model[:effort]` 형식)이 요구하며, `test/preset-validate.test.ts`의 malformed-default 케이스가 이 계약의 권위 있는 고정이다. 구현은 테스트를 신뢰할 것.

### Step 3 — 신규 순수 모듈: 게이트 + 적용 프리미티브 (`src/preset/session-default.ts` 신규)

vitest-on-Node 제약(스파이크 finding 3: SDK **값** import 불가, 타입-only는 허용 — `spike.ts`의 `AgentModelStore` 시임 관례, `src/preset/spike.ts:80-92`)을 따라 구조적 시임으로 작성.

**내용:**
```ts
/** Entry types omp stamps on a brand-new session BEFORE session_start fires (sdk.ts:2796-2811). */
export const SESSION_BOOT_STAMP_TYPES: ReadonlySet<string> =
  new Set(["model_change", "thinking_level_change", "service_tier_change"]);

/** Structural view of a session entry — mirrors the AgentModelStore seam precedent. */
export interface SessionEntryLike { type: string; role?: string | null }

/**
 * Fresh-MAIN-session gate. True iff (1) every entry type is a boot-stamp type, (2) no
 * model_change carries role "default" (an in-session active choice — extension setModel or
 * user dialog pick — already stamped; agent-session.ts:8927-8947, selector-controller.ts:631-636),
 * AND (3) no stamp type appears more than once: a fresh boot records each type AT MOST ONCE
 * (straight-line ifs, sdk.ts:2801-2811), so any repeat proves post-boot activity — a user
 * model-CYCLE pick stamps a roleless model_change (agent-session.ts:9144-9145, 9175-9176)
 * shape-identical to the boot stamp, caught only by this count bound (round-1 B1).
 * Excludes: resumed sessions (message/compaction entries), task-executor subagent sessions
 * (session_init precedes the emit — executor.ts:2327→2404), already-applied / user-picked
 * sessions (role:"default"), and cycle-then-zero-turn-resumed sessions (count bound).
 */
export function isFreshMainSession(entries: readonly SessionEntryLike[]): boolean;

/** R10 observability: entry type -> count map for the gate-reject debug line (pure). */
export function entryTypeHistogram(entries: readonly SessionEntryLike[]): Record<string, number>;

export interface SessionModelApi<M> {
  resolve(spec: string): M | undefined;                 // ctx.models.resolve — auth 필터, effort 폐기
  setModel(model: M): Promise<boolean>;                 // pi.setModel — false = no key
  setThinkingLevel(level: EffortLevel): void;           // pi.setThinkingLevel
}

// Compile-time proof the real host surfaces satisfy the seam (spike.ts 관례:
// `type Assert<T extends true>` + SettingsSatisfiesStore, src/preset/spike.ts:80-92).
// 타입-only import만 사용 — SDK 값 import 0건 유지.
type Assert<T extends true> = T;
export type SessionApiSatisfiesHost = Assert<
  {
    resolve: ExtensionModelQuery["resolve"];            // = ctx.models.resolve 표면
    setModel: ExtensionAPI["setModel"];                 // = pi.setModel 표면
    setThinkingLevel: (level: EffortLevel) => void;     // = 어댑터 캐스트 후의 pi.setThinkingLevel 표면
  } extends SessionModelApi<Model> ? true : false
>;

export type SessionDefaultResult =
  | { status: "applied"; base: string; effort: EffortLevel | null }
  | { status: "unresolved"; base: string }   // resolve → undefined
  | { status: "no-key"; base: string }       // setModel → false
  | { status: "none" };                      // spec 부재

export async function applySessionDefaultModel<M>(
  spec: string | null, api: SessionModelApi<M>,
): Promise<SessionDefaultResult>;
```
- `applySessionDefaultModel` 구현 순서: `spec` null → `none`; `splitEffort(spec)`(re-export 아님, `validate.ts:37`에서 import) → `api.resolve(base)` undefined → `unresolved`; `await api.setModel(model)` false → `no-key`(**setThinkingLevel 호출 금지**); effort 존재 시에만 `api.setThinkingLevel(effort)`(무접미사 → 현 thinking level 유지, #5290 계열 클로버 방지는 "지정 시 반드시 페어링"으로 충족) → `applied`.
- 호출측 어댑터에서만 호스트 타입 캐스트: `level => pi.setThinkingLevel(level as Parameters<ExtensionAPI["setThinkingLevel"]>[0])` — `EffortLevel` 5값은 호스트 `ThinkingLevel` 값집합의 부분집합(`node_modules/@oh-my-pi/pi-agent-core/dist/types/thinking.d.ts:7-17`; 호스트는 `inherit|off|max` 추가 보유), 리터럴→enum이라 캐스트 필요. `SessionApiSatisfiesHost` 증명은 이 캐스트 이후의 어댑터 표면을 시임에 바인딩한다(동등 대안: main.ts/command.ts 공용 어댑터 팩토리의 반환 타입을 `SessionModelApi<Model>`로 명시 선언 — 시그니처 자체가 증명; 어느 쪽이든 SDK 값 import 0건).

**수용 기준:** SDK 값 import 0건; 컴파일 타임 시임 증명(`SessionApiSatisfiesHost` 또는 동등한 타입 명시 어댑터)이 존재해 `tsc`/`npm run build`가 시임-호스트 정합을 검증; 신규 `test/preset-session-default.test.ts`의 게이트 매트릭스(①–⑦)·적용 상태 기계 유닛 전체 통과(§2 테스트 플랜).

### Step 4 — 배선: `inject.ts` 반환 확장 + `main.ts` 게이트 적용 + `command.ts` reinject (`src/preset/inject.ts`, `src/main.ts`, `src/preset/command.ts`)

**inject.ts (`applyActivePreset`, `inject.ts:24-42`):** 동기 유지(DR Decision A).
- `InjectResult`(`inject.ts:10-17`)에 `defaultSpec: string | null` 추가.
- 본문: `validatePreset(preset, ...)` 결과에서 `defaultSpec` 전달; 두 조기 반환(`:30`, `:33-35`)에 `defaultSpec: null` 추가. **setModel은 여기서 호출하지 않는다.**

**main.ts (`session_start` 핸들러, `main.ts:27-39`):**
```ts
pi.on("session_start", async (_event, ctx) => {
  try {
    const result = applyActivePreset({ settings: pi.pi.settings, models: ctx.models, cwd: ctx.cwd });
    // (기존) 에이전트 오버라이드 재적용 — 무조건, 모든 emit에서 (변경 없음)
    ...기존 notify/warnings 루프 (main.ts:30-35)...
    const entries = ctx.sessionManager.getEntries();
    if (result.defaultSpec !== null && isFreshMainSession(entries)) {
      const outcome = await applySessionDefaultModel(result.defaultSpec, adapter(pi, ctx));
      if (outcome.status === "applied")
        ctx.ui.notify(`lets-craft: session model -> ${outcome.base}${outcome.effort ? `:${outcome.effort}` : ""} (preset "${result.preset}").`, "info");
      else if (outcome.status !== "none")
        ctx.ui.notify(`lets-craft preset: session default "${...base}" skipped (${outcome.status === "no-key" ? "no API key" : "not resolvable"}).`, "warning"); // 자동 경로 = 조용한 경고 (스펙 R7)
    } else if (result.defaultSpec !== null) {
      // 게이트 거부 관측성(R10) — 합성 계약 ③ 참조. notify 금지, LSC_DEBUG 시에만 stderr 1줄.
    }
  } catch { ...기존 catch 불변 (main.ts:36-39)... }
});
```
- **합성 계약(명시):** ① 게이트는 **setModel 단계에만** 적용된다 — `task.agentModelOverrides` 재적용(`main.ts:29`의 `applyActivePreset` 내 `applySessionAgentModelOverrides`, `inject.ts:40`)은 지금처럼 **모든** `session_start` 발화(서브에이전트 init 포함)에서 무조건 실행(멱등 in-memory `settings.override`, 프로세스 전역 싱글턴이므로 동일값 재기록 = 무해, 자가치유 유지). ② 서브에이전트 emit에서의 setModel 배제는 `isFreshMainSession`의 `session_init` 비허용으로 성립(F2) — 프로세스 래치나 별도 상태 불요. ③ **게이트 거부 관측성(라운드1 N5, R10):** `defaultSpec !== null`인데 게이트가 false면, `LSC_DEBUG` 환경변수 설정 시에만 stderr로 entry 타입 히스토그램 1줄을 남긴다(예: `lets-craft: session default gated off — ${JSON.stringify(entryTypeHistogram(entries))}`). notify 채널은 쓰지 않는다(자동 경로 = 조용함, 스펙 R7; 호스트 notify에 debug 레벨 부재 — `extensibility/extensions/types.ts:199`는 info|warning|error뿐). 용도: 타 확장의 선행 엔트리 기록이나 호스트의 신규 스탬프 타입으로 게이트가 fail-closed 침묵할 때 "왜 default가 안 먹었나" 포렌식.
- 어댑터: `{ resolve: s => ctx.models.resolve(s), setModel: m => pi.setModel(m), setThinkingLevel: l => pi.setThinkingLevel(l as ...) }`. `pi` 핸들은 기존 클로저로 이미 도달(추가 배관 불요; DR Decision A).

**command.ts (`reinject`, `command.ts:85-92`):** 명시적 경로 — default 단계는 **명시 요청 시에만 실행**(M1, 라운드1 크리틱). 에이전트 오버라이드 재주입·active notify·warnings는 기존대로 **모든 뮤테이션에서 무조건**(변경 없음).
- 시그니처 확장: `reinject(pi, ctx, applyDefaultFor: string | null = null)` — **`applyDefaultFor !== null && result.preset === applyDefaultFor`이고 `result.defaultSpec !== null`일 때만** `await applySessionDefaultModel(...)` 실행. 이름 일치 조건은 크로스-스코프 섀도잉(예: 전역 파일에서 switch/create했지만 프로젝트 active가 유효 프리셋을 가리는 경우)에서 사용자가 지목하지 않은 **다른** 프리셋의 default가 재단언되는 것까지 차단한다. `unresolved`/`no-key` → `ctx.ui.notify(..., "warning")`(프리셋은 이미 활성 + 에이전트 오버라이드 적용됨 = 스펙 R7 부분 활성화); `applied` → 기존 active notify(`command.ts:89`)에 `, session model -> ...` 병기 또는 별도 info.
- 호출부 배선: `runSwitch`(`command.ts:94-114`) → `reinject(pi, ctx, target)` — **항상 요청**; `runCreate`(`:116-133`) → `:129`의 `if (!file.active) file.active = presetName` 직전에 `const autoActivated = !file.active` 캡처 후 `reinject(pi, ctx, autoActivated ? presetName : null)` — **생성 프리셋이 자동 활성화된 경우에만**; `runEdit`(`:135-155`, reinject `:154`)·`runDelete`(`:157-174`, reinject `:173`) → `reinject(pi, ctx)` — **에이전트 오버라이드 재주입만, default 재단언 없음**.
- **근거(스펙 제약 2 — M1):** 즉시성은 "명시적 `/lsc-preset` switch/create → 즉시 적용"으로 **switch/create에만 부여**되고, 세션 중 수동 `/model`은 **항상 우선 — 재적용·되돌리기 없음**이다. edit/delete가 default를 재단언하면 미드세션 수동 선택을 클로버하는 스펙 문면 위반(Principle 3의 조용한 재정의 금지에 해당).
- default 없는 프리셋 switch → `defaultSpec: null` → 모델 단계 no-op = **현재 모델 유지**; `runEdit`·`runDelete`(active 해제 `:170` 포함)는 default 단계 자체가 배선되지 않아 구조적으로 현재 모델 유지(스펙 R6, 복원 없음). 미드세션 명시적 switch의 캐시 비용은 informed consent(스펙 가정, #4520) — 경고 없음.

**수용 기준:** 게이트(자동 경로)/`applyDefaultFor` 명시 요청(switch 항상 · create 자동 활성화 시 · edit/delete 미배선) 분기·합성 계약이 유닛(inject 수준 + 게이트 매트릭스)과 코드 리뷰로 확인 가능; 게이트 거부 debug 라인은 `LSC_DEBUG` 미설정 시 완전 무음(기본 경로 무변화, 히스토그램 조립은 순수 `entryTypeHistogram` 유닛으로 고정); `main.ts` 핸들러가 어떤 실패에도 세션 시작을 막지 않음(기존 try/catch 보존).

### Step 5 — 커맨드 UX + 문서 (AC8·AC9) (`src/preset/command.ts`, `README.md`, `_docs/spec.md`)

**command.ts:**
- `SKIP_LABEL`(`command.ts:21`) 문구 갱신(AC9): `"(skip — inherit session model)"` → **`"(skip — inherit session model / preset default)"`** (제안 문구; open-questions #3).
- 신규 `DEFAULT_SKIP_LABEL = "(skip — no session default)"`.
- `pickModelForAgent`(`command.ts:46-56`)에서 선택 로직을 `pickModelSpec(ctx, title, modelLabels, skipLabel)`로 일반화(에이전트용 래퍼는 기존 타이틀 `Model for ${agent} (${toTaskAgentName(agent)})` 유지).
- `buildPreset`(`command.ts:59-77`): 시그니처 `base: PresetEntry`, 반환 `Promise<PresetEntry | null>`. **첫 질문**(스펙 R8): `pickModelSpec(ctx, `Session default model${base.default ? ` [current: ${base.default}]` : ""}`, modelLabels, DEFAULT_SKIP_LABEL)` — skip 시 default 부재. 이후 기존 7개 에이전트 순회(`base.agents[agent]` 힌트).
- `summarize`(`command.ts:31-43`): 프리셋 이름 줄 다음, default 존재 시 `    default -> ${spec}` 줄 출력 후 `Object.entries(file.presets[name].agents)` 순회(AC8).
- `runCreate` 저장 메시지(`command.ts:131`): 에이전트 수 + default 유무 병기(예: `... with N agent override(s)${preset.default ? " + session default" : ""}.`).
- 각 run* 함수의 `file.presets[target]` 접근을 `PresetEntry` 형으로 정합(컴파일 강제; 로직 불변).

**README.md** (`## model preset 사용법`, `README.md:101-139`):
- 스키마 블록(`:103-115`): 구조형 예시(`default:` + `agents:`)로 교체 + 레거시 평면 형식 관용 파싱·저장 시 구조형 업그레이드(구버전 리더 파손) 명기 + `default` 필드 설명(`:113-115`).
- 머지 문단(`:122`): "default는 프로젝트 값이 전역 값을 오버라이드(프로젝트 미지정 시 전역 상속; 삭제는 미지원)" 추가.
- 폴백 문장(`:130`): "프리셋에 값이 없는 에이전트는 세션(메인) 모델로 폴백합니다 — 활성 프리셋에 `default`가 있으면 세션 메인 모델 자체가 그 값으로 전환되므로 결과적으로 default를 따릅니다."로 갱신.
- 신규 하위 절 "세션 default 모델": 적용 시점 — 명시적 switch 즉시(create는 생성 프리셋이 자동 활성화된 경우; **edit/delete는 default를 재적용하지 않음** — 수동 `/model` 항상 우선, 스펙 제약 2·M1) / **프로세스 부팅으로 생성되는 신규 세션**의 `session_start`에서 자동. **`/new`·세션 전환·세션 브랜치는 `session_start`를 재발화하지 않으므로**(전용 `session_switch`/`session_branch` 이벤트; research/SYNTHESIS.md §1) 자동 적용이 일어나지 않고, 다음 명시적 switch 또는 새 프로세스 부팅에서 적용됨을 명기("신규 세션 자동"이라는 과대 표현 금지 — 라운드1 N6). 그 외: resume·수동 `/model`·모델 사이클 선택 무간섭, default 없는 프리셋 전환·해제 시 현재 모델 유지(복원 없음), 실패 소프트 처리(경고+skip), effort 접미사 동작, **자동 적용이 조용히 skip된 원인 진단용 `LSC_DEBUG` 환경변수 문서화**(설정 시 stderr에 entry 타입 히스토그램 1줄 — R10; 라운드1 크리틱 nit).
- 커맨드 절(`:74-79`): create/edit 설명에 "세션 default 질문 먼저(skip 가능)" 반영; 동작 확인 절(`:41-43`)에 session model 전환 알림 문구 추가.

**_docs/spec.md** (`:49`): "preset 에 모델이 지정되지 않은 Agent 는 main session(default) 모델로 fallback 한다." → "preset 에 모델이 지정되지 않은 Agent 는 main session 모델로 fallback 한다. preset 에 세션 default 모델(`default` 필드)이 지정되어 있으면 세션 메인 모델 자체가 그 값으로 전환되므로, 미지정 Agent 는 결과적으로 preset default 를 따른다." (AC9 폴백 서술 갱신)

**수용 기준:** AC8(요약 표시 유닛 + 흐름 코드 리뷰), AC9(3개 문서 지점 diff 존재). `summarize`는 유닛 표면화를 위해 `export`로 전환(현 module-private, `command.ts:31`).

### Step 6 — E2E + 하네스 (`test/e2e-helpers.ts`, `test/e2e-preset-default.test.ts` 신규, `package.json`)

- **e2e-helpers.ts:** 신규 `writePresetWithSessionDefault(projectDir, args: { name?: string; default: string; agents?: Record<string, string> })` — 구조형 YAML(`stringify({ active, presets: { [name]: { default, agents } } })`)을 `.lsc/models.yaml`에 기록. 신규 상수 `export const E2E_DEFAULT_MODEL = process.env.LSC_E2E_DEFAULT_MODEL ?? "zai/glm-4.5-flash:low";` — 기존 `LSC_E2E_MAIN_MODEL ?? …` 패턴 답습(`test/e2e-helpers.ts:64-65`). `writeCheapModelPreset`(`:301-309`)은 **불변**(평면 형식 유지 = 기존 3개 e2e가 AC6 관용 파싱의 live 회귀 감시를 겸함).
- **test/e2e-preset-default.test.ts (신규, 1 케이스):** 관례 준수 — `const RUN_E2E = process.env.LSC_E2E === "1"` + `describe.skipIf(!RUN_E2E)`(`test/e2e-full-cycle.test.ts:30,85` 패턴), `setupFixtureProject`/`runOmpPrint`/`debugSummary` 재사용.
  1. `setupFixtureProject()` 후 `.lsc/models.yaml`을 `writePresetWithSessionDefault`로 **덮어쓰기**: `default: E2E_DEFAULT_MODEL`(기본 `zai/glm-4.5-flash:low` — 메인 `--model`인 `E2E_MAIN_MODEL`=`zai/glm-5.2:low`와 **base가 달라야 AC1 판별이 성립**하는 인증 동일-provider 모델; env 오버라이드 시에도 이 불변식 유지), `agents: { explore: E2E_SUBAGENT_MODEL }`(tracer는 의도적 미지정).
  2. `runOmpPrint` 프롬프트: lsc-tracer 스폰(태스크 텍스트 마커 `TRACER-PING`) → lsc-explore 스폰(`EXPLORE-PING`) → `FINISHED` 출력; `earlyExit`로 `FINISHED` 감지.
  3. **AC1:** 부모 `--mode=json` 이벤트에서 첫 `message_end`(message.role==="assistant")의 `message.provider`와 `message.model`이 `E2E_DEFAULT_MODEL`에서 도출한 provider(`"zai"`)·**bare 모델 id**(`"glm-4.5-flash"`)와 **각각** 일치 — 두 값은 분리 필드다(`AssistantMessage.provider`/`model` — pi-ai types.d.ts:542-549); 결합 `"zai/glm-4.5-flash"` 문자열 비교 금지.
  4. **AC2:** 세션 파일 해석(스파이크 finding 7 절차, `scripts/spike-e2e-verify.sh:109-117`): `sessionDir` 직하 부모 `*.jsonl` → 디렉터리 `${file%.jsonl}` → 내부 에이전트별 `*.jsonl`을 `session_init`의 task 텍스트 마커로 매핑 — tracer 파일은 default의 provider·bare id를 **별도 필드로** 어서션(`"provider":"zai"` + `"model":"glm-4.5-flash"` — `scripts/spike-e2e-verify.sh:122-126`이 provider/effort를 벗겨 bare id로 어서션하는 관례; 라운드1 N6), explore 파일은 `E2E_SUBAGENT_MODEL`의 bare id(명시 엔트리가 default에 우선 = agentModelOverrides 배타 우선 보존).
  5. 타임아웃/킬은 기존 하네스 상수 관례 준수.
- **package.json (`:16`):** `e2e` 스크립트 파일 목록에 `test/e2e-preset-default.test.ts` 추가(현재 3개 파일 열거식이므로 추가하지 않으면 영원히 실행되지 않음).

**수용 기준:** `LSC_E2E=1` 단독 실행으로 AC1+AC2 어서션 통과; 게이트 미설정 시 skip.

---

## 2. Test Plan — AC1–AC9 1:1 매핑

| AC | 검증물 | 파일 / 케이스 |
|---|---|---|
| AC1 신규 세션 turn-1 = default | **e2e(게이트)** | `test/e2e-preset-default.test.ts` — 첫 assistant `message_end`의 provider·bare model id 분리 필드 어서션 (Step 6.3) |
| AC2 미지정 에이전트 상속 | **e2e(게이트)** | 동일 파일 — tracer(미지정)=default / explore(명시)=오버라이드, per-agent `<id>.jsonl`의 provider·bare id 분리 필드 검사 (Step 6.4) |
| AC3 switch 즉시 전환 | **유닛(주입 경로) + e2e 관찰(대리 충족)** | `test/preset-session-default.test.ts` — `applySessionDefaultModel` 성공 경로(setModel→setThinkingLevel 순서·인자) = reinject default 단계가 쓰는 동일 프리미티브(**`applyDefaultFor` 명시 요청: runSwitch 항상 / runCreate 자동 활성화 시만; runEdit/runDelete 미배선** — Step 4 M1). 스펙의 'e2e 관찰'은 **대리(proxy)로 충족함을 명시**: AC1 e2e(동일 프리미티브의 session_start 경유 라이브 실행) + 수동 스모크(Verification 5의 create/switch 즉시 전환 관찰) — switch 전용 e2e는 별도 작성하지 않는다. reinject 배선 자체는 코드 리뷰 |
| AC4 resume 무간섭·수동 /model 우선 | **유닛(게이트)** | 동일 파일 — `isFreshMainSession` 매트릭스: ① message 엔트리 포함(resumed) → false(스펙 "entries>0 → no-op"의 행동적 의도); ② `model_change role:"default"` 포함 → false(적용 이력/능동 선택 보호); ③ 부트 스탬프만(각 타입 1회) → true; ④ 빈 배열 → true; ⑤ `session_init` 포함(서브에이전트) → false; ⑥ **무role `model_change` 2개(부트 스탬프+사이클 픽 = 무턴 사이클-resume 형상) → false(개수 상한 — 라운드1 B1 반례)**; ⑦ **`thinking_level_change` 2개 → false(개수 상한의 타입 일반성)**. 미드세션 무간섭은 비-기능(재적용 코드가 session_start 게이트 뒤에만 존재; 감시/폴링 부재) — 코드 리뷰로 확인 |
| AC5 소프트 실패 | **유닛** | 동일 파일 — `resolve→undefined`: `unresolved` + `setModel` 미호출; `setModel→false`: `no-key` + `setThinkingLevel` 미호출; 유효 default 드롭 시에도 에이전트 오버라이드는 적용됨(inject 수준: `validatePreset` drop + `valid` 유지 → `applied` 맵 비어있지 않음). notify 레벨 분기(명시=경고 notify/자동=조용한 경고)는 command/main 배선 리뷰 — 명시 경로의 default 실패 경고는 default 단계가 배선된 **switch(항상)·create(자동 활성화 시)에서만 발생**하고, edit/delete는 default 단계 부재로 해당 없음(M1) |
| AC6 레거시 평면 파싱 | **유닛** | `test/preset-models.test.ts` — `writeCheapModelPreset` 산출과 동일 형태의 평면 YAML → `{agents}` 파싱; 구조형 round-trip; 평면 내 `default` 키가 파스에서 agents로 **그대로 보존**(C2 — 차단은 AC7의 validate 가드 소관; C1 채택 시 승격 유닛으로 치환); 기존 3개 e2e 파일이 평면 프리셋으로 라이브 회귀 감시 겸임 |
| AC7 default C13 검증 | **유닛** | `test/preset-validate.test.ts` — default 3종 위반(형식/effort/미해석) → 경고+drop+`defaultSpec:null`; 유효 시 `defaultSpec` 전파; **agents 맵의 예약 키 `default`/`agents`(평면 유래·agents-as-string 오기) → 각각 경고+drop, 오버라이드 미적용(팬텀 `lsc-default`/`lsc-agents` 차단 — C2 가드)**; 기존 에이전트 케이스 회귀 없음 |
| AC8 표시/질문 순서 | **유닛 가능 범위 + 리뷰** | `summarize`(export 후) default 줄 유닛; create/edit default-최우선·skip 흐름은 코드 리뷰(스펙 허용 범위) |
| AC9 문서 갱신 | **리뷰** | README `:101-139`·`:74-79`·`:130`, `_docs/spec.md:49`, `command.ts:21` SKIP_LABEL — Step 5 diff 체크리스트 |

**신규/확장 시임 (요청된 제안):**
- 기존 `FakeStore`(`test/preset-injection-spike.test.ts:36-58`, `AgentModelStore` 구현)는 오버라이드 측에 그대로 사용.
- **신규 `FakeSessionApi`** — models 파사드 페이크에 요구된 `resolve+setModel+setThinkingLevel` 표면:
  ```ts
  class FakeSessionApi implements SessionModelApi<{ spec: string }> {
    constructor(public resolvable: Set<string>, public setModelResult = true) {}
    calls: Array<{ fn: "setModel" | "setThinkingLevel"; arg: string }> = [];
    resolve(spec: string) { const { base } = splitEffort(spec); return this.resolvable.has(base) ? { spec: base } : undefined; }
    async setModel(m: { spec: string }) { this.calls.push({ fn: "setModel", arg: m.spec }); return this.setModelResult; }
    setThinkingLevel(l: string) { this.calls.push({ fn: "setThinkingLevel", arg: l }); }
  }
  ```
  `calls` 순서 어서션으로 페어링·단락(short-circuit) 계약을 고정. `isFreshMainSession`은 평범한 `{type, role?}` 리터럴 배열로 구동(SDK 타입 불요).
- inject 수준 테스트는 `FakeStore` + resolve 클로저(기존 관례) + `defaultSpec` 반환 어서션으로 구성 — `applyActivePreset`은 여전히 동기이므로 기존 스타일 그대로.

---

## 3. DR (Deliberation Record)

### Principles (5)
1. **호스트 설계 법칙 준수** — 세션-스코프 오버레이만; persisted `modelRoles` 불가침; 명시적 실패는 알리고 자동 실패는 조용히; resume 경로 침묵 (research N6, #2515/#4705).
2. **순수 시임 우선** — SDK 값 import 불가 제약 하에 구조적 시임(`AgentModelStore` 전례)으로 전 로직을 Node-vitest 검증 가능하게.
3. **스펙 의도 > 스펙 문면, 단 조용한 재정의 금지** — 소스가 문면을 반증하면(F1) 의도를 구현하되 편차를 open-questions·리스크로 명시 escalate.
4. **최소 표면 확장** — 스냅샷/복원/폴링/이벤트 없음; 기존 lifecycle(재주입 지점 2곳)에만 접합.
5. **증거 게이트 신뢰** — 실행 미관찰 호스트 동작(setModel-at-session_start, emit별 entries 형상)은 프로브(Step 0)로 관찰한 뒤에만 의존 확정.

### Decision Drivers (top 3)
1. **게이트 정확성**: resume 플래그 부재 + 부트 스탬프(F1) + 서브에이전트 emit(F2) + 무role 사이클 스탬프(B1) 아래에서 "신규 메인 세션에서만"을 오차 없이 판별 — 본 기능의 유일한 고위험 설계점.
2. **스키마 진화 안전성**: 레거시 읽기 무파손(관용 파싱) + 쓰기 업그레이드 감수 명시 + 팬텀 `lsc-default` 차단.
3. **C13/소프트 실패 일관성**: 어떤 실패도 세션 시작·프리셋 활성화를 막지 않음; 모델 소멸(호스트 PATCH) 내성.

### Decision A — 적용 경로 배치 (pi 핸들이 어떻게 setModel에 도달하나)
- **A1 (채택): `applyActivePreset`은 동기 유지 + `defaultSpec` 반환; 신규 순수 프리미티브 `applySessionDefaultModel`을 두 오케스트레이션 지점(main.ts 핸들러=`isFreshMainSession` 게이트, command.ts reinject=`applyDefaultFor` 명시 요청 — switch 항상/create 자동 활성화 시만, M1)에서 호출.** pi 핸들은 두 지점 모두 이미 보유(클로저/파라미터) — inject.ts로의 핸들 배관 불요.
  - Pros: inject의 순수성·기존 테스트 유지; 게이트(자동)/명시 요청(`applyDefaultFor`) 분기가 호출부 정책으로 자연 표현; 프리미티브 단독 유닛 가능; 실패 통지 채널(자동 vs 명시)이 호출부에 남음.
  - Cons: 호출부 2곳에 유사 어댑터 5줄 중복(허용 — 통지 정책이 실제로 다름).
- **A2: `applyActivePreset`을 async화하고 내부에서 setModel까지 수행(옵션 인자로 게이트 플래그·pi 파사드 주입).**
  - Pros: 진입점 단일화. Cons: 유일한 동기 시임이 비동기 오염; InjectResult 의미 혼탁; 게이트·통지 정책이 데이터 인자로 역류; 기존 유닛 전면 개편 — 이득 없이 파급만 큼.
- **A3: main.ts/command.ts에 로직 인라인 중복.**
  - Pros: 파일 수 최소. Cons: resolve/split/단락 규칙 2벌 사본, 유닛 불가(핸들러에 봉인) — 기존 테스트 관례(순수 프리미티브 + 페이크) 위반. 기각.

### Decision B — fresh-session 게이트 위치·형태 (effort 적용 방식 포함)
- **B1: 스펙 문면 `getEntries().length === 0`.** **무효화(invalidated)** — 인증 모델이 있는 모든 신규 부팅이 `model_change`(+`thinking_level_change`) 스탬프를 session_start 이전에 기록함을 핀 소스로 확인(`sdk.ts:2796-2808` → append 구현 `session-manager.ts:1474-1505`). 조건이 영구 거짓 → 자동 적용 사장. 유일 생존 옵션이 아니므로 아래 2안 비교.
- **B2 (채택 — 라운드1 강화형): 부트 스탬프 allowlist + 개수 상한 술어 `isFreshMainSession`** — (i) 전 엔트리 타입이 `{model_change, thinking_level_change, service_tier_change}` 소속 AND (ii) `model_change(role:"default")` 부재 AND (iii) **각 스탬프 타입 출현 ≤ 1회**(신선 부팅은 각 타입을 최대 1회만 기록 — `sdk.ts:2801-2811`이 루프 없는 직선 `if` 3개; 동일 타입 반복 = 부팅 후 활동의 증거).
  - Pros: 상태 없음(순수 함수, 매트릭스 유닛 ①–⑦); resume(메시지/컴팩션 엔트리)·서브에이전트(`session_init`)·기적용/능동 선택 세션(role:"default")·**무턴 사이클-resume(개수 상한)**을 한 술어로 배제.
  - **정정(라운드1 B1 — 초안의 과대 주장):** 초안 B2는 "무턴 resume 재적용의 클로버 엣지까지 role 검사로 차단"이라고 적었으나 **거짓이었다** — role 검사가 막는 것은 다이얼로그(`selector-controller.ts:631-636`)·확장(`agent-session.ts:8927-8947`) 픽뿐이고, **사이클 픽은 role 미지정 `model_change`**(`agent-session.ts:9144-9145, 9175-9176`)로 부트 스탬프와 `{type, role}` 동형이라 통과했다. 시나리오(전 단계 소스 근거): 인증 부팅(무role 부트 스탬프) → 사이클 전환(무role 스탬프) → 무턴 종료(빈 세션 GC는 `/move` 한정 — `session-manager.ts:2106-2124`) → `omp --continue` 시 게이트 참 → **복원된 사용자 선택을 프리셋 default가 클로버** = 스펙 제약 2("resume 절대 무간섭"·"수동 우선") 이중 위반. (iii) 개수 상한이 이 반례를 폐쇄한다(해당 entries에는 `model_change`가 2개).
  - Cons: allowlist·상한이 호스트 내부 기록 경로를 추적(완화: Step 0 프로브가 현 형상 고정 — 시나리오 5 포함 + 리스크 R2 감시; 16.4.1–16.4.8 무드리프트 확인 완료). **잔여 위양성(degenerate, 감수·공지 — R2):** 모델 미해석 부팅(부트 `model_change` 부재) + **단일 비-default-role `model_change`(사이클/temporary 계열 — `agent-session.ts:9144-9145, 9175-9176`, `:8985-8988`; retry-fallback 계열은 mid-turn 한정이라 무턴 시나리오에서 비성립)** + 무턴 종료 + resume → entries가 신선 부팅과 구분 불가. default role이 해석되지 않은 부팅에서만 성립하는 퇴화 경로 클래스로 감수하고 R2·open-questions #1에 공지.
  - effort 적용: 게이트 통과 후 프리미티브 내부에서 `setModel` 성공 시에만, 접미사 존재 시에만 `setThinkingLevel` — 페어링 보장(#5290 교훈), 무접미사 시 현 레벨 보존(스펙 문면 그대로).
- **B3: 프로세스 전역 1회 래치(첫 session_start만) + resume 판별 병행.**
  - Pros: 서브에이전트 배제가 emit 순서(메인 부팅이 항상 선행)로 공짜. Cons: 래치 단독으론 `--continue` resume 부팅을 구분 못해 결국 엔트리 검사 필요(중복 메커니즘); 모듈 전역 가변 상태 도입; 테스트 간 오염 관리 비용. B2가 존재하는 한 추가 이득 없음 — 미채택(단, 프로브가 B2 반례를 발견할 경우의 예비안으로 기록).

### Decision C — 레거시 평면 맵 안의 `default:` 키
- **C2 (채택 — 라운드1 전환): 문면 그대로 agents-only 파싱 + validate 단계 예약 키 가드(경고+drop).** 평면 맵의 모든 키는 파스에서 agents로 보존되고, `validatePreset`이 `default` 키를 에이전트 루프 전에 경고+drop(구조형 안내 문구 포함; Step 2). 가드는 예약 키 `agents`도 함께 검사한다 — 구조형 의도 파일이 `agents`를 문자열로 잘못 적으면 평면 분기로 흘러 경고 없는 팬텀 `lsc-agents`가 되는 엣지(라운드1 크리틱 nit; Step 2 상세).
  - Pros: 스펙 문면("레거시는 agents-only") 완전 일치; 생태계 규범 정합 — 본 프로젝트 연구 canon이 "default는 명시적 sibling 필드, 역할 맵 내부의 예약 이름 금지"를 명시(research/SYNTHESIS.md §3); 팬텀 `lsc-default` 오라우팅은 가드가 동등 차단(현행 validate는 키 이름을 검사하지 않아 가드 없이는 실제 적용됨 — `validate.ts:53-64`, Step 2 근거); 수용 문법이 1개로 유지.
  - Cons: 평면 파일에 `default`를 적는 사용자 실수가 경고 1줄+미적용으로 귀결 — DWIM 관점의 1줄 UX 손실(경고 문구가 구조형을 안내해 완화).
- **C1: 파스 단계 승격(lift) — 미채택(사용자 선택 대안으로 존치, open-questions #2).** 평면 맵의 문자열 `default` 값을 `PresetEntry.default`로.
  - Pros: DWIM — 평면 파일의 `default`가 그대로 동작·round-trip; 구식 파일에 우아한 업그레이드 경로.
  - Cons: 역할 맵 내부 예약 키의 **제도화** — 위 연구 canon이 명명한 안티패턴 그 자체; 스펙 문면 편차; 두 번째 수용 문법을 영구 유지. 결정적으로 DWIM의 수혜자(평면 파일에 `default`를 적어 둔 기존 사용자)는 실존하지 않음(기존 파일·e2e 헬퍼는 7개 에이전트 키만 — 본 플랜 감사).
- 사용자가 DWIM을 명시 선호하면 Step 2의 가드 1블록을 Step 1의 승격 1블록으로 치환하는 국소 변경(파급: 유닛 2건 문구).

---

## 4. ADR

- **Decision:** 프리셋 스키마를 `PresetEntry { default?, agents }` 구조형으로 확장(레거시 평면 맵은 문면 그대로 **agents-only 관용 파싱**, 평면 유래 `default`·`agents` 예약 키는 **validate 가드가 각각 경고+drop** — C2)하고, 세션 default 적용을 **동기 `applyActivePreset`의 `defaultSpec` 반환 + 신규 순수 프리미티브 `applySessionDefaultModel`(resolve→setModel→splitEffort→setThinkingLevel)** 로 구현한다. 명시적 경로(command.ts reinject)는 **`applyDefaultFor` 명시 요청 시에만 default 단계를 실행**하고(runSwitch 항상, runCreate는 생성 프리셋이 자동 활성화된 경우만; runEdit/runDelete는 에이전트 오버라이드 재주입만 — 스펙 제약 2의 즉시성 부여 범위가 switch/create뿐이고 수동 `/model`은 항상 우선·재적용 없음이기 때문, M1), 자동 경로(main.ts session_start)는 **부트 스탬프 allowlist + role 검사 + 타입별 개수 상한(≤1) 게이트 `isFreshMainSession`**(스펙 문면 `entries===0`의 의도 보존 구현; resume·서브에이전트·기적용·무턴 사이클-resume 세션 배제)를 통과할 때만 적용하며, 게이트 거부는 `LSC_DEBUG` 시 entry 타입 히스토그램 stderr 1줄로 관측 가능하다(R10). 시임-호스트 정합은 컴파일 타임 증명(`SessionApiSatisfiesHost`, spike.ts `Assert` 관례)으로 고정한다. 에이전트 오버라이드 재적용은 기존대로 전 emit 무조건. 실패는 전 경로 소프트(C13/R7).
- **Drivers:** DR의 top 3 — 게이트 정확성(F1/F2/B1), 스키마 진화 안전성, 소프트 실패 일관성.
- **Alternatives considered:** A2(async 통합 진입점)/A3(인라인 중복); B1(스펙 문면 게이트 — 소스로 무효화)/**비강화 B2**(allowlist+role만 — 사이클 무턴-resume 반례가 소스 증명되어 라운드1에서 개수 상한으로 강화)/B3(프로세스 래치); C1(파스 승격 — 예약 키 제도화로 미채택, 사용자 선택 대안 존치); **전-뮤테이션 무조건 default 재단언(라운드1 크리틱 M1로 기각 — edit/delete가 수동 `/model`을 클로버하는 스펙 제약 2 문면 위반)**. 각 기각 사유는 DR 본문.
- **Why chosen:** 유일한 고위험 축(게이트)을 상태 없는 순수 술어 하나로 수렴시키면서 기존 시임·테스트 관례(FakeStore/구조적 시임/동기 inject)를 무손상 유지하는 최소 조합이기 때문. 개수 상한은 유일하게 소스 증명된 반례(사이클 무턴-resume 클로버)를 술어 내부에서 순수하게 폐쇄한다. 호스트 설계 법칙(오버레이·resume 침묵·auto-soft)과 업계 수렴(preset.ts/#2515/pi-amplike, sibling-필드 규범)에 정확히 겹친다.
- **Consequences:** (+) 프리셋 전환 한 번으로 메인+에이전트 세트 번들 전환; 미지정 에이전트 자동 추종; resume/수동 선택(다이얼로그·사이클 포함) 불가침 — edit/delete는 default를 재단언하지 않으므로 미드세션 수동 선택이 프리셋 편집·삭제로도 클로버되지 않음(M1). (−) 새 버전이 저장한 models.yaml은 구버전 리더에서 throw(감수·문서화); allowlist·개수 상한은 호스트 마이너 업그레이드 시 재점검 대상; `default` 삭제(erase) 의미론 미지원; 게이트에 degenerate 잔여 위양성 1건(모델 미해석 부팅+사이클 1회+무턴 resume — R2에 감수·공지); edit로 default를 바꾼 사용자는 다음 switch 또는 신규 세션에서 반영됨(즉시 반영 아님 — 스펙 제약 2 준수의 대가, README에 명기).
- **Follow-ups:** ① 호스트 버전 범프 시 Step 0 프로브 재실행(체크리스트화). ② `model_select` 계열 이벤트가 상류에서 도입되면 dirty-state 라벨 재검토(현 Non-Goal). ③ 전역 models.yaml 동시 쓰기 잠금은 별도 기능(연구 완료, wave-2). ④ 보조 모델 슬롯은 구조형 스키마 위에 필드 추가로 수용 가능.

---

## 5. Risk Register

| # | 리스크 | 노출 | 완화 |
|---|---|---|---|
| R1 | **setModel-at-session_start 실행 리스크** — 소스 확인·실행 미관찰(turn-1 반영, false 경로, effort 말단) | 자동 적용 전체 | **Step 0 프로브(trace §9.2)** 를 executor 반복 1 이전에 실행해 5개 시나리오 관찰; 실패해도 소프트 설계로 세션 무손상; 최종 증명은 AC1 e2e |
| R2 | **entries 게이트 취약성** — 4개 emit 사이트별 엔트리 형상 상이(F1); 스펙 문면과 편차; 호스트가 스탬프 종류 추가 시 회귀 | 자동 적용 정확성 | B2 강화 술어(allowlist + role + **타입별 개수 상한 ≤1** — 사이클 픽의 무role `model_change`가 부트 스탬프와 동형인 라운드1 B1 반례를 개수 상한으로 폐쇄) + Step 0 프로브(시나리오 5 포함)로 형상 고정(불일치 시 plan 리비전 절차 내장); 게이트 매트릭스 유닛 ①–⑦; 편차·강화 술어는 open-questions #1로 사용자 ACK(랜딩 전 하드 게이트); 16.4.1–16.4.8 드리프트 없음 기확인. **잔여 위양성(감수·공지):** 모델 미해석 부팅(부트 `model_change` 부재)+**단일 비-default-role `model_change`(사이클/temporary 계열)**+무턴 종료+resume은 신선 부팅과 구분 불가 — degenerate 경로 클래스로 수용(사이클 `agent-session.ts:9144-9176`; temporary/ephemeral `:8985-8988`; retry-fallback `:13573/:13660/:13710`은 mid-turn 한정이라 (i)/(iii)로 차단). **프로브 커버리지 한계(공지):** headless(시나리오 1·2·4·5)+executor(3)+대화형(수동 스모크 — Verification 5)이며 **ACP 사이트는 미검증** — 단 미지/추가 엔트리는 게이트 false→skip(fail-closed, 클로버 없음) 방향이라 감수 |
| R3 | **서브에이전트 세션에서 게이트 오발** — executor emit에서 setModel 시 스폰 모델 클로버(AC2 파괴) | per-agent 정확성 | `session_init` 선행 기록(F2: `executor.ts:2327→2404`; 호스트 유일 호출 사이트 = 배타 판별자)을 allowlist가 비허용 → 기계적 배제; Step 0 시나리오 3으로 관찰 확정; AC2 e2e가 회귀 감시(서브에이전트 모델 어서션) |
| R4 | **팬텀 `lsc-default`/`lsc-agents` 충돌** — 평면 맵 `default` 키(및 agents-as-string 오기로 평면 분기에 흘러든 `agents` 키)가 존재 에이전트로 오라우팅(Tier-1 재현; 현행 validate는 키 이름 무검사라 가드 없이는 실제 적용됨) | 레거시 파일 UX | C2 validate 예약 키 가드(`default`·`agents` 각각 경고+drop, 구조형 안내 — Step 2; 대안 C1 파스 승격) + AC6/AC7 유닛 고정 |
| R5 | **구버전 리더 파손** — 새 버전이 저장한 구조형 파일을 구버전이 throw | 공유 전역 파일 | 스펙이 명시 감수(v0.1.0); 관용 파싱으로 읽기 방향은 무파손 → 파손 표면 = 새 버전이 **저장**한 파일뿐(switch/create/edit/delete 시 업그레이드됨을 README에 명기); `--project` 스코프로 격리 가능 안내 |
| R6 | **e2e 비용/플레이크** — 실크레딧 1런 + 서브에이전트 2스폰; e2e default 기본값 `zai/glm-4.5-flash:low`는 하네스가 **지시 추종 실패 이력으로 메인/서브 역할에서 강등**한 모델(`test/e2e-helpers.ts:13-25`) | CI 비용 | 단일 게이트 파일(LSC_E2E=1 opt-in); 최저가 모델·trivial 태스크(스폰 2회+마커 — 긴 지시 추종 불요라 강등 사유 비적용)·`earlyExit`·태스크 텍스트 마커 매핑·jsonl 어서션(finding 7 — stdout 거짓 음성 함정 회피); `--no-file-parallelism` 기존 관례; default 모델은 `LSC_E2E_DEFAULT_MODEL`로 오버라이드 가능(`:64-65` 패턴 — 단 메인 모델과 base가 달라야 AC1 판별 성립) |
| R7 | **effort 페어링 회귀(#5290 계열)** — setModel 후 thinking 미적용/오적용 | UX 정확성 | 프리미티브가 접미사 존재 시 반드시 페어 호출(순서 유닛 고정); 무접미사 시 현 레벨 보존을 명세·문서화; `EffortLevel⊂ThinkingLevel` 캐스트는 어댑터 1곳에 격리 |
| R8 | **모델 ID 소멸(호스트 PATCH)** — 저장된 default가 어느 날 미해석 | 운영 | C13 검증 + 적용기 이중 방어(unresolved 소프트 경로) — 세션·프리셋 활성화 무손상, 경고만 |
| R9 | **`settings.override` 마스킹 상호작용** — override가 이후 set()을 가림(핀 계약) | 기존과 동일 | 신규 쓰기 없음(오버라이드 경로 불변); 인지 사항으로만 기록 |
| R10 | **게이트 fail-closed 침묵의 진단 불가** — 타 확장이 우리보다 먼저 `session_start` 전에 엔트리를 기록하거나(`appendCustomEntry`/`appendLabelChange` 바인딩 실존 — `runtime-init.ts:80-85`, `extension-ui-controller.ts:126-131`, `acp-agent.ts:2210-2215`) setModel을 호출하는 경우, 또는 호스트가 미래 마이너에서 부트 스탬프 타입을 추가하는 경우 → 게이트 false → **조용한** skip(방향은 정확 — 클로버 없음 — 하나 4가지 원인이 구분 불가한 침묵으로 수렴) | 지원/디버깅 비용 | Step 4 합성 계약 ③: `LSC_DEBUG` 설정 시 게이트 거부에 entry 타입 히스토그램 stderr 1줄(`entryTypeHistogram` 순수 헬퍼 — 유닛 고정) — "왜 default가 안 먹었나" 포렌식; notify 채널 불사용(자동 경로 조용함 유지, 스펙 R7; 호스트 notify에 debug 레벨 부재); README에 `LSC_DEBUG` 문서화(Step 5) |

---

## 6. Verification Steps (구현자·오디터용 — 워크트리에서 실행)

1. **Step 0 프로브(1회, 소액 크레딧):** `scripts/spike-session-default-probe.sh`(신규) — 격리 `--profile`, 5개 시나리오(사이클-무턴-resume 포함; 시나리오 4는 직접 구성한 `Model` 객체로 `setModel→false` 관찰) 관찰 로그를 `.lsc/crafts/model-preset-session-default/test/logs/`에 보존. 게이트 allowlist·개수 상한과 대조.
2. **스코프 유닛(프로젝트 전체 스위트 금지):**
   ```
   npx vitest run test/preset-models.test.ts test/preset-validate.test.ts \
     test/preset-session-default.test.ts test/preset-injection-spike.test.ts
   ```
3. **빌드(플러그인 dist 갱신 — e2e 선행 조건; `SessionApiSatisfiesHost` 컴파일 증명도 여기서 검증):** `npm run build`
4. **게이트 e2e(단일 파일):**
   ```
   LSC_E2E=1 npx vitest run test/e2e-preset-default.test.ts \
     --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000
   ```
5. **수동 스모크(선택, 대화형 — AC3 'e2e 관찰' 대리의 절반):** `/lsc-preset create`로 default 포함 프리셋 생성(첫 프리셋 = 자동 활성화 = default 적용 대상) → 즉시 모델 전환 notify 확인 → `/model`로 수동 변경 → `/lsc-preset edit`로 활성 프리셋 수정 후 **수동 선택 유지 확인(edit는 default 재단언 없음 — M1 배선 라이브 검증)** → default 포함 프리셋으로 `/lsc-preset switch` → 즉시 전환 확인 → default 없는 프리셋으로 switch 후 현재 모델 유지 확인(복원 없음) → `omp --continue`로 resume 시 무간섭 확인 → **모델 사이클 단축키로 전환 후 무턴 종료 → `omp --continue`에서 사이클 선택 유지 확인(개수 상한 — B1 반례 라이브 검증)**.
6. AC9 문서 diff 체크리스트(Step 5 목록) 및 SKIP_LABEL 문구 확인.

---

## 7. Open Questions

[open-questions.md](./open-questions.md)에 기록 — ① 스펙 문면 게이트(`entries===0`) 편차 — **강화(개수 상한) 술어의 최종 의미론(잔여 위양성 공지 포함)에 대한 단일 사용자 ACK, 랜딩 전 하드 게이트**, ② 레거시 `default` 키 — 기본안 C2(validate 가드), C1(파스 승격)은 사용자 선택 대안, ③ SKIP_LABEL 확정 문구. ②·③은 구현 착수를 막지 않고(기본안 명시, 국소 치환 가능), ①도 착수는 막지 않되 **머지 전 ACK가 필수**다(아키텍트 라운드1 B2 조건).
