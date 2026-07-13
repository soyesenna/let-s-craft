# Spec — model-preset-session-default

## Metadata

| Field | Value |
|---|---|
| Feature | model preset 세션 default 모델 설정 지원 |
| Slug | model-preset-session-default |
| Classification | Brownfield (Stage 1 trace verdict — reused verbatim) |
| Interview rounds | 9 (hard cap 20, soft cap 10 — gate cleared under soft cap) |
| Final ambiguity | **0.0465** (gate: < 0.05) — formula: 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| Challenge modes used | contrarian (R4), simplifier (R6); ontologist not fired (ambiguity ≤ 0.3 at R8) |
| Worktree | `.lsc/worktrees/model-preset-session-default/` on branch `feat/model-preset-session-default` |
| Trace | [trace.md](./trace.md) · Research: [research/SYNTHESIS.md](./research/SYNTHESIS.md) |

## Clarity Breakdown (final)

| Dimension | Score | Weight | Weighted | Gap |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | — (restatement confirmed R9) |
| Constraints | 0.95 | 0.25 | 0.238 | — (precedence/failure/UX/schema all settled) |
| Success Criteria | 0.95 | 0.25 | 0.238 | — (AC1–AC9 confirmed R9) |
| Context | 0.95 | 0.15 | 0.143 | — (integration seam fully mapped by trace) |
| **Ambiguity** | | | **0.0465** | **< 0.05 ✓** |

## Topology

Single component (the `src/preset/` subsystem). No sub-component rotation was needed; `topology.last_targeted_component_id = preset` throughout.

## Goal

각 model preset이 **선택적(opt-in) 세션 default 모델**을 가질 수 있게 한다. 활성 프리셋에 default가 있으면, lets-craft가 omp 세션의 **메인 모델 자체를** 그 default로 전환한다 — 명시적 프리셋 전환 시 즉시, 그리고 **신규** 세션 시작 시 자동으로. omp의 서브에이전트 해석 체인(부모 세션의 live 모델 상속)에 의해, 프리셋에 명시 엔트리가 없는 lsc 에이전트들은 자동으로 이 default를 따라간다. **단(감사 사이클 0 실측, omp 16.4.8): 사용자가 host 수준의 `modelRoles.task`를 명시 설정한 경우 task 스폰 에이전트에는 그 설정이 부모-live 상속보다 우선한다 — 호스트 설계 법칙("명시적 사용자 설정 > 프리셋")과 일관된 호스트 동작이며, 이 상속 계약은 host task-role 미설정 조건부다.**

**핵심 가치 (R4 contrarian에서 확정):** 번들링 — 프리셋 전환 한 번으로 메인+에이전트 모델 세트가 통째로 바뀐다. 작업 유형별 세트 전환(저비용 e2e 프리셋 ↔ 고성능 개발 프리셋)이 omp 전역 default(config.yml modelRoles.default, --model)로는 얻을 수 없는 고유 가치다.

## Constraints

1. **스키마 (R3):** `presets.<name> = { default?: "provider/model[:effort]", agents: Record<agentName, "provider/model[:effort]"> }` — 구조적 변경. 구버전 플러그인이 신형 전역 파일을 읽다 파손되는 것은 감수한다(v0.1.0). 단, **신규 파서는 레거시 평면 맵을 agents-only 프리셋으로 관용 파싱**해야 한다(기존 사용자 파일·리포 자체 e2e 헬퍼가 평면 형식).
2. **적용 시점과 우선순위 (R2):**
   - 명시적 `/lsc-preset` switch/create → 즉시 적용 (`ctx.models.resolve(spec)` → `pi.setModel(model)`; effort 접미사가 있으면 분리 후 `pi.setThinkingLevel(level)`).
   - `session_start` 자동 적용은 **신규 세션에서만** (`ctx.sessionManager.getEntries().length === 0` 게이트). resume된 세션은 절대 건드리지 않는다(transcript replay가 사용자의 마지막 선택을 복원하므로).
   - 세션 중 사용자의 수동 `/model` 전환이 **항상 우선** — 재적용·되돌리기 없음 (모델 전환 이벤트가 확장에 노출되지 않으므로 감시도 하지 않는다).
3. **복원 없음 (R6, simplifier):** default 없는 프리셋으로 전환하거나 active를 해제해도 메인 모델은 **현재 상태 유지**. 스냅샷/복원 메커니즘을 만들지 않는다(에이전트 오버라이드 교체는 기존대로).
4. **실패 처리 (R7):** 호스트 관례 —
   - 명시적 switch에서 default가 resolve 실패(키 없음/모델 제거/provider 비활성) → `ctx.ui.notify` 경고 + 프리셋은 활성화(모델 단계만 skip, 에이전트 오버라이드는 적용).
   - session_start 자동 적용 실패 → 조용한 경고 + skip.
   - `pi.setModel`이 `false` 반환(키 없음) 시에도 동일한 소프트 처리.
5. **create/edit 흐름 (R8):** default 질문을 **맨 먼저**(skip 가능 — skip 시 default 없는 프리셋), 이후 기존 7개 에이전트 순회.
6. **호스트 설계 법칙 준수 (research N6):** 호스트의 persisted `modelRoles`를 절대 쓰지 않는다. 영속화는 models.yaml의 프리셋 정의 + 기존 `active:` 포인터뿐. 라이브 효과는 `pi.setModel`(+`setThinkingLevel`)과 기존 `task.agentModelOverrides` 런타임 오버라이드로만.
7. **머지 의미 (R9):** 전역+프로젝트 동명 프리셋 머지 시 agents는 기존대로 에이전트 단위 머지, `default`는 프로젝트 값이 전역 값을 오버라이드.
8. **검증 정책:** default 값도 기존 C13 정책(경고 + drop + 폴백)을 따른다 — `provider/model[:effort]` 형식, effort는 `EFFORT_LEVELS` 검증, 모델은 resolve 가능성 검증.

## Non-Goals

- omp 세션 메인 모델의 **영속** 변경(config.yml / modelRoles.default 쓰기) — 하지 않는다.
- 미지정 에이전트를 프리셋 default에 **고정**(pinning)하는 H3 의미론 — 상속으로 충분(R1에서 (a) 선택).
- 스냅샷/복원, dirty-state("custom") 라벨링, 모델 전환 감시/폴링 — 만들지 않는다(R6).
- 전역 models.yaml 동시 쓰기 잠금(file locking) — 이번 범위 아님(연구는 완료, research/waves/wave-2 참조).
- 보조 모델 슬롯(small/fast model) — 미래 확장; 이번 스키마가 구조적이라 추가 여지는 확보됨.
- 호스트 업스트리밍(새 이벤트/API 제안) — 범위 밖.

## Acceptance Criteria (R9 확정)

| # | 기준 | 검증 방법 |
|---|---|---|
| AC1 | 활성 프리셋에 default가 있을 때, **신규** 세션의 turn-1 메인 모델 = default | LSC_E2E 게이트 e2e: `--mode=json` 부모 stdout의 첫 assistant 턴 모델 |
| AC2 | 프리셋에 명시 엔트리가 없는 lsc 에이전트의 스폰 모델 = default — **host `modelRoles.task` 미설정 조건부(사용자 host 설정이 있으면 그것이 우선; 감사 0 실측)** | 동일 e2e: `<session-dir>/<agentId>.jsonl` 검사 (spike finding 7 절차); **e2e는 hermetic overlay(`modelRoles.task: "default"` = session-inherited 센티널)로 환경 독립 검증** |
| AC3 | `/lsc-preset` switch 시 동일 세션에서 즉시 메인 모델 전환 | 유닛(주입 경로) + e2e 관찰 |
| AC4 | resume된 세션은 미변경; 수동 /model 후 그 선택이 세션 내내 유지 | 유닛(게이트 로직: entries>0 → no-op) |
| AC5 | resolve 실패 소프트 처리: 명시적=notify 경고+에이전트 오버라이드는 적용, 자동=조용히 skip | 유닛(resolve 실패/false 반환 스텁) |
| AC6 | 레거시 평면 프리셋 YAML이 agents-only로 무파손 파싱 | 유닛(파서 왕복) |
| AC7 | default 필드 검증: 형식/effort/resolve 검증, 위반 시 경고+drop (C13) | 유닛(validate) |
| AC8 | summarize/list에 default 표시; create/edit에서 default를 먼저 질문(skip 가능) | 유닛 가능 범위 + 코드 리뷰 |
| AC9 | 문서 갱신: README §model preset 사용법, _docs/spec.md 폴백 서술, SKIP_LABEL 문구 | 리뷰 |

검증 깊이(R5): **유닛 전체 + LSC_E2E 게이트 e2e 1건**(AC1+AC2 어서션 통합). e2e는 기존 `describe.skipIf(!RUN_E2E)` 관례·`setupFixtureProject`·`writeCheapModelPreset` 계열 헬퍼를 재사용한다.

## Assumptions Exposed & Resolved

| 가정 | 처리 |
|---|---|
| "세션 default"가 폴백 전용일 것(리포 문서 어휘) | R1에서 기각 — (a) 메인 모델 전환으로 확정. 문서 어휘는 AC9에서 갱신 |
| 프리셋 default가 호스트 default를 대체할 것 | R4 contrarian — 아니오: 번들링이 가치. 호스트 default는 프리셋 미활성/미지정 시 그대로 유효 |
| 복원(스냅샷)이 필요할 것 | R6 simplifier — 불필요. 현재 모델 유지 |
| default 값 형식 | 에이전트 엔트리와 동일한 `provider/model[:effort]`로 통일(일관성; splitEffort 재사용) — 인터뷰에서 이의 없음, R9 일괄 확정 |
| 신규 파서의 레거시 수용 | 관용 파싱 확정(R9) — K8s 라운드트립 규칙/warn-mode 정례(research N5) 근거 |
| 미드세션 명시적 switch의 프롬프트 캐시 비용 | 사용자 동의(informed consent)로 간주 — 명시적 행동이므로 경고 불요(호스트 #4520 정책 부합) |
| 하드캡 도달 여부 | 해당 없음 — 9라운드에 게이트 통과 |

## Technical Context

Stage 1 trace의 3-point injection에 따라, 본 인터뷰의 코드베이스 컨텍스트는 별도 재탐색 없이 아래로 대체되었다:

<trace-context>
trace.md 전체 종합 — 특히: 통합 시점(seam)은 `models-file.ts`(스키마: ModelsFile/PresetModels/parse/merge/save) → `validate.ts`(C13 검증) → `inject.ts applyActivePreset` → `command.ts`(/lsc-preset 5개 플로우 + SKIP_LABEL) → `main.ts session_start`. 호스트 계약(핀 16.4.0 검증): `pi.setModel(Model)→Promise<boolean>`(키 없으면 false; settings 미기록; transcript에 model_change role="default" 기록→resume replay), `ctx.models.resolve(spec)`(auth 필터, effort 파싱 후 폐기), `pi.setThinkingLevel(level)`, session_start는 4개 init 사이트 모두에서 액션 바인딩 후 마지막에 발화, resume 플래그 없음(entries-count 추정만), 모델 전환 이벤트 없음, `task.agentModelOverrides`는 스폰마다 fresh 재독(배타적 우선). Tier-1 재현: 구조 변경형은 구버전 파서 throw, 평면 맵 내 예약 키는 유령 lsc-default 오라우팅, merge는 {active,presets} 외 필드 유실. 테스트 관례: FakeStore(AgentModelStore) + resolve 클로저 시임, LSC_E2E 게이트, per-agent jsonl 검사.
</trace-context>

## Trace Findings

[trace.md](./trace.md) — H1 채택(인터뷰 R1에서 확정), 랭킹·반박 라운드·증거 전문은 trace.md §2–§7. 외부 연구 인용 전문: [research/SYNTHESIS.md](./research/SYNTHESIS.md), 클레임 상태: [research/claim-graph.md](./research/claim-graph.md).

## Ontology

최종 엔티티 (9):

| Entity | Type | Maps to |
|---|---|---|
| ModelPreset | 기존 | `presets.<name>` (models-file.ts) |
| PresetEntry | **변경** (구 PresetModels) | `{default?, agents}` 구조체 — 이번 기능의 스키마 변경 대상 |
| SessionDefaultModel | 신규 | `PresetEntry.default` 필드 + 적용 경로(resolve→setModel→setThinkingLevel) |
| PerAgentOverride | 기존 | `PresetEntry.agents` → `task.agentModelOverrides` 주입 |
| OmpSessionMainModel | 외부(호스트 소유) | AgentSession 인스턴스 상태; `pi.setModel`로만 전환 |
| LscAgent | 기존 | LSC_AGENT_NAMES 7종 |
| ModelsFile | 기존 | 전역+프로젝트 models.yaml |
| ActivePointer | 기존 | `active:` 키 |
| FreshSessionGate | 신규 | `getEntries().length === 0` 게이트 (R2 정책의 구현 표면) |
| UserModelChoice | 신규(개념) | 수동 /model 선택 — 항상 프리셋보다 우선 |

(UserModelChoice 포함 시 10; FreshSessionGate/UserModelChoice는 R2에서 등장)

## Ontology Convergence

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 7 | 0 | 0 | 7 | 0 | N/A |
| 2 | 9 | 7 | 0 | 2 | 0 | 0.78 |
| 3 | 9 | 8 | 1 (PresetModels→PresetEntry) | 0 | 0 | 1.00 |
| 4 | 9 | 9 | 0 | 0 | 0 | 1.00 |
| 5 | 9 | 9 | 0 | 0 | 0 | 1.00 |
| 6 | 9 | 9 | 0 | 0 | 0 | 1.00 |
| 7 | 9 | 9 | 0 | 0 | 0 | 1.00 |
| 8 | 9 | 9 | 0 | 0 | 0 | 1.00 |
| 9 | 9 | 9 | 0 | 0 | 0 | 1.00 |

라운드 3 이후 완전 수렴(1.00) 유지.

## Interview Transcript

**R1 [Goal]** (injected — lane 3 critical unknown; ambiguity 0.505)
Q: "세션 default 모델 설정"의 세 해석 (a)/(b)/(c) 중 무엇인가? (서브에이전트 체인의 부모-live 상속으로 (a)가 (b)의 효과를 포섭한다는 배경 제시)
A: **(a) 프리셋 활성화 시 omp 세션의 메인 모델 자체를 전환 — 미지정 에이전트는 자동 상속**

**R2 [Constraints]** (injected — lane 2 critical unknown; ambiguity 0.372)
Q: 프리셋 default vs 사용자 /model 우선순위·재적용 정책은? (resume 플래그 부재, transcript replay, 이벤트 부재 배경 제시)
A: **신규 세션 시작시에만 자동 적용; resume 무간섭; 수동 /model 항상 우선 (호스트 관례와 동일)**

**R3 [Context]** (injected — lane 1 critical unknown; ambiguity 0.312)
Q: 스키마 표현 — 예약 키 vs 구조적 변경 vs 계획 단계 위임? (Tier-1 재현 결과 제시)
A: **구조적 변경 presets.<name> = {default, agents:{...}} — 구버전 파손 감수 (v0.1.0)**

**R4 [Goal] — CONTRARIAN** (ambiguity 0.280)
Q: omp에 이미 세션 default 메커니즘이 있는데 프리셋 default의 고유 가치는? (기능 불필요 가능성 제시)
A: **번들링 — 프리셋 전환 한 번으로 메인+에이전트 세트 전환; 작업 유형별 세트가 핵심**

**R5 [Success Criteria]** (ambiguity 0.257)
Q: 검증 깊이 — 유닛+스파이크 / 유닛+e2e 1건 / 유닛만?
A: **유닛 전체 + LSC_E2E 게이트 e2e 1건 (turn-1 모델 + 에이전트 상속 어서션)**

**R6 [Constraints] — SIMPLIFIER** (ambiguity 0.169)
Q: default 없는 프리셋 전환/해제 시 최소 충분 동작 — 현재 모델 유지 vs 스냅샷/복원?
A: **현재 모델 유지 — 에이전트 오버라이드만 교체 (단순, 예측 가능)**

**R7 [Constraints]** (ambiguity 0.144)
Q: default resolve 실패 시 동작? (호스트 관례·모델 소멸 리스크·C13 제시)
A: **호스트 관례 — 명시적 switch: 경고 notify + 부분 활성화; session_start: 조용한 경고 + skip**

**R8 [Constraints]** (ambiguity 0.099)
Q: create/edit 흐름에서 default 질문 위치?
A: **default를 맨 먼저 (skip 가능) → 이후 7개 에이전트 순회**

**R9 [Success Criteria] — 종합 게이트** (ambiguity 0.099 → 0.0465)
Q: 목표 재진술 + 스키마/적용/실패 정책 + AC1–AC9 일괄 확정?
A: **yes**

— 게이트 통과 (0.0465 < 0.05), 인터뷰 종료.

## Amendment Log

### Amendment — audit cycle 0, 2026-07-13
- **Change**: Goal 서술에 host `modelRoles.task` 우선순위 단서 추가; AC2를 host task-role 미설정 조건부 계약으로 명시하고 e2e hermetic overlay 검증 방식을 기재.
- **Reason**: 감사 사이클 0의 계약된 e2e 실집행에서 tracer가 사용자 `config.yml`의 `modelRoles.task`(openai-codex)로 스폰됨 — AC2의 무조건 상속 전제가 환경 의존임을 실측 확인 (audit/audit-0.md §4, Required Fix §5).
- **Disposition**: Accepted via [Spec Change] lsc_select
