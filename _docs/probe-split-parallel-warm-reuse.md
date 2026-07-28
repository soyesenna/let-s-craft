# P2/P3 피기백 프로브 스펙 — 분할병렬 · warm-reuse 품질 A/B (U9 / C4)

- 근거: `.omc/plans/ralplan-pre-craft-latency-round2.md` U9, `.omc/specs/deep-dive-pre-craft-latency-round2.md` C4/AC9
- 대상 AC: **AC9** — "피기백 프로브 스펙 문서(실행 절차 + 합격선 겹침률 ≥80%·CRITICAL 누락 0건) 존재"
- 관련: 이번 패키지는 (a) critic 조사단계 분할병렬, (b) architect/critic warm-reuse를 **비채택**으로 남긴다(`.omc/specs/deep-dive-pre-craft-latency-round2.md` §C2 "비채택(프로브 조건부)"). 이 문서는 그 두 구조 개편안을 **채택할지 여부를 결정하기 위한 실측 절차**를 확정한다 — 이 문서 자체는 계약을 바꾸지 않는다.
- **상태(2026-07-28)**: **P2는 SUPERSEDED** — 분할병렬은 P2 실행 없이 채택됐고 P2는 사후 품질 확인으로 격하됐다(근거 4항은 §2 상단). **P3는 원문 그대로 유효** — warm-reuse는 여전히 미채택이며 P3 합격이 채택 트리거다. 두 프로브의 상태가 달라졌으므로, §5의 합격·불합격 분기처럼 원래 "P2·P3 공통"으로 쓰인 절은 이제 프로브별로 갈라 읽어야 한다.
- 실행 시점: 다음 실전 pre-craft(이 U1~U8 패키지가 착지된 이후, fixture/E2E가 아닌 실제 유저 요청 기반 pre-craft) 1회. P2/P3 모두 **같은 실전 pre-craft에 피기백** 가능(별개 실행 불필요) — 단, 아래 iteration 조건이 겹치는 경우에 한함.

## 0. 공통 원칙

1. **관측용이며 결정에 개입하지 않는다.** 이 프로브들이 스폰하는 추가 에이전트(독립 critic, warm-reuse critic)의 판정(`**VERDICT:**`)은 그 iteration의 실제 진행 여부(REVISE/REJECT 시 재루프, ACCEPT 계열 시 통과)에 **어떤 영향도 주지 않는다**. 실제 합의 루프는 기존 계약대로 정규 critic(+architect)의 판정만으로 진행한다. 프로브 스폰의 산출물은 사후 비교 전용이며, plan.md/test/에 대한 실제 리비전 지시에 반영하지 않는다.
2. **비용 가드(계획 원문 준수).** 피기백은 실전 pre-craft **1개 iteration에 한정**, 추가 스폰은 P2·P3 각각 **1기 이내**(P2: 독립 critic 1기, P3: fresh 대조군 1기 — warm-reuse 쪽은 기존에 이미 존재하는 이전 iteration 리뷰어 인스턴스를 재사용하므로 신규 스폰이 아님). 같은 실전 런에서 P2와 P3을 함께 수행해도 총 추가 스폰은 2기를 넘지 않는다.
3. **격리.** 추가 스폰에는 대상 아티팩트(plan.md 또는 test/ 자산)의 **읽기 전용 스냅샷**만 준다 — 프로브 스폰이 실제 파일을 편집하거나, 오케스트레이터가 그 출력을 이후 정규 루프의 리비전 지시에 섞어 넣는 일이 없어야 한다(그러면 A/B의 "독립성"이 깨진다).
4. **기록은 즉시.** 두 critic(또는 리뷰어)의 원문 출력을 비교 시점까지 보존한다(세션 종료 후 사라지지 않도록 `_docs/probe-logs/`에 즉시 파일로 남김 — §4).

## 1. "발견 항목(finding)" 단위 정의 — 두 프로브 공통

겹침률(자카드)을 계산하려면 두 리뷰의 산출물을 **비교 가능한 원자 단위**로 쪼개야 한다. `agents/lsc-critic.md`의 출력 구조를 기준으로 다음을 1개의 "발견 항목"으로 취급한다:

- critic 리뷰 본문에서 개별로 식별되는 각 이슈/결함 — 통상 근거로 `file:line`(또는 plan.md의 섹션/문단 인용) + 결함 설명 + (있으면) 심각도 태그(CRITICAL/BLOCKING/실질 결함 vs NOTABLE/사소함)로 구성된 하나의 불릿 또는 하위 항목.
- **매칭 기준(두 리뷰 사이에 "같은 발견"으로 인정하는 조건)**: ① 동일하거나 겹치는 `file:line`(또는 plan.md 동일 섹션) **AND** ② 같은 근본 결함을 지목(표현이 달라도 됨 — "레이스 컨디션 가능" vs "동시 접근 시 상태 불일치"처럼 서술이 달라도 가리키는 결함이 같으면 매칭). 이 판단은 **오케스트레이터(사람 또는 이 프로브를 수행하는 에이전트)가 두 리뷰 원문을 나란히 놓고 직접 판정**한다 — 자동 텍스트 유사도 매칭은 쓰지 않는다(서로 다른 서술로 같은 결함을 가리키는 경우가 실측에서 이미 확인됨: `.omc/specs/deep-dive-trace-pre-craft-latency-round2.md` H2 — "iter1/2 전부 독립 재도출 CRITICAL/BLOCKING").
- 심각도 태그가 없는 리뷰 형식이면(예: `lsc-critic-recheck`처럼 다른 어휘를 쓰는 경우) 오케스트레이터가 "이 항목이 없으면 REVISE/REJECT급 재작업이 필요한가?"를 기준으로 CRITICAL 여부를 판정하고 그 판단 근거를 기록에 한 줄 남긴다.

## 2. P2 — 분할병렬 품질 A/B (critic이 architect 리포트 없이 조사)

> ### ⚠️ SUPERSEDED (2026-07-28) — P2는 더 이상 채택 게이트가 아니다
>
> **P2가 게이트하던 구조 개편은 P2 실행 없이 채택되었다.** `skills/pre-craft/SKILL.md`의 Stage 3/4 합의 루프는 이제 architect·critic을 단일 `task` 배치로 동시 스폰하는 `plan-only lane` 기본 + `sequential fallback` + `review join gate` 구조다. 이 절 이하의 절차·합격선은 **사후 품질 확인**으로 남으며, 실행되더라도 그 결과는 계약을 되돌리는 근거가 아니라 `sequential fallback` 범위를 조정하는 입력이다.
>
> 이 문서가 대신하는 결정 기록은 `.omc/specs/deep-dive-pre-craft-latency-round2.md` §C2다. `.omc/`는 gitignored이므로 그 원문을 여기에 verbatim 인용해 tracked 히스토리 안에서 결정 체인을 닫는다:
>
> > **비채택(프로브 조건부)**: (a) critic 조사단계 분할병렬, (b) architect/critic warm-reuse — P2/P3 합격 후 별도 라운드에서 채택. **이번 패키지에서는 계약 변경 금지.**
>
> **supersede 근거 4항** (전문: `.omc/specs/deep-dive-trace-architect-critic-parallel-lanes.md`):
>
> 1. **원래 근거가 이 호스트에 성립하지 않는다.** 순차 강제의 유일한 도입 근거는 Claude Code가 `ask_codex` 형제 호출을 429에서 취소하는 동작이었다(oh-my-claudecode `ac4373d6`, 커밋 본문과 diff 전체에 품질 언급 없음). lets-craft의 호스트인 omp `task` 배치는 형제를 격리한다 — async는 아이템별 독립 job(`oh-my-pi/packages/coding-agent/src/task/index.ts:1022-1050`), sync는 fail-fast가 아닌 `mapWithConcurrencyLimitAllSettled`(`parallel.ts:94-98`). fail-fast 프리미티브는 같은 모듈에 있으나 `task` 경로가 쓰지 않는다.
> 2. **품질 근거는 이식 시점 창작이다.** "critic's evaluation depends on architect's antithesis/tradeoff findings"는 이식 커밋 `7a1ac1a`가 인용한 소스(`.omc/state/deep-dive-lane-reports/lane2-omc-contracts-full.md` L688-792)에 **존재하지 않는다**. 그 소스에는 순서 지시만 있다.
> 3. **저장소가 이미 철회했다.** `c6799f2`가 계약을 "architect 리뷰를 입력으로 받되 **독립 VERDICT**"로 재작성했다. 그 커밋이 실제로 고친 문제는 순서가 아니라 *critic이 건너뛰어지는 것*이었다 — load-bearing 속성은 always-both이지 critic-second가 아니다.
> 4. **P2가 측정하려던 리스크는 구조로 보존된다.** critic의 architect-대면 검증 중 실측 수율이 확인된 것은 Change Spec 감사 하나뿐이고(`deferred-pool/plan/plan-2.md:10`의 C1·C2 보정, `plan-4.md:7`의 CF1 반박), 새 계약의 `sequential fallback`이 정확히 그 경로만 순차로 유지한다.
>
> **정직한 한계 병기**: 위 4항은 프로버넌스와 호스트 동작에 대한 증거이지, "plan-only critic이 같은 CRITICAL을 찾는다"에 대한 controlled reproduction이 아니다. 그 질문에는 여전히 T1급 증거가 없다. 이 문서의 절차를 사후에 1회 실행하면 그 공백이 닫힌다.

### 가설

`.lsc-critic.md` 계약상 critic은 정규 루프에서 항상 architect의 리뷰를 입력 컨텍스트로 받는다(`skills/pre-craft/SKILL.md` §Stage 3 "critic's task assignment must include architect's review in full as input context" — **인용 원문은 위 supersede 변경으로 제거됨(구 `:318`)**; 현행 계약에서 critic 레인은 기본이 `plan-only`이고 architect 리뷰를 받는 것은 `sequential fallback` 패스뿐이다). architect 리포트를 먼저 읽는 것이 critic의 판단에 **앵커링**(선행 리포트가 발견 방향을 좁힘)을 일으켜, architect가 놓친 것을 critic도 놓치게 만들 가능성이 trace 조사에서 제기됐다(`.omc/specs/deep-dive-trace-pre-craft-latency-round2.md` H2: "architect-critic 읽은 파일 목록 거의 비겹침 — 단 critic 첫 read가 architect 리포트"). 분할병렬(critic이 architect 리포트 없이 독립 조사)이 이 앵커링을 없애면서도 발견 품질을 유지하는지가 P2의 질문.

### 트리거 조건

다음 실전 pre-craft의 **Stage 3(또는 Stage 4) 임의의 한 iteration**, architect 리뷰가 완료되어 정규 critic을 스폰하는 시점.

### 절차

1. 정규 critic은 계약대로(architect 리뷰 전문을 입력에 포함해) 평소처럼 스폰한다 — **이것이 A(대조군, "정규")**.
2. **동시에**(정규 critic과 병행 — 순차가 아니라 병행이어야 "분할병렬"의 실제 실행 조건을 재현함) 추가로 `lsc-critic` 1기를 스폰한다. 이 스폰의 assignment는 정규 critic과 **동일한 대상 아티팩트(plan.md 스냅샷 + 관련 컨텍스트)** 를 주되, **architect의 리뷰 결과물은 절대 포함하지 않는다** — 이것이 **B(실험군, "독립")**.
   - B의 assignment 문구 예시: "아래 plan.md(스냅샷)를 architect 리뷰 없이 처음부터 검토하라. `agents/lsc-critic.md`의 표준 프로토콜(pre-commitment predictions, 전수 검증, multi-perspective, gap analysis, self-audit)을 그대로 적용하되, 이것은 A/B 비교를 위한 관측용 리뷰이며 그 판정은 실제 합의 루프에 반영되지 않는다는 점을 명시(에이전트가 이례적으로 짧게 처리하지 않도록 정규 리뷰와 동일한 진지도로 수행하라고 지시)."
3. 두 출력이 모두 도착하면 §1의 정의로 각각을 발견 항목 리스트로 분해한다.
4. §4의 기록 양식에 A/B 발견 리스트, 교집합, A만/B만, 신규 CRITICAL 여부를 채운다.
5. 실제 iteration은 A(정규 critic)의 `**VERDICT:**`로만 계속 진행한다(원칙 1).

### P2 판정에 필요한 산출

- 겹침률 = `|A ∩ B| / |A ∪ B|` (자카드).
- "정규에만 있는 것"(A - B), "독립에만 있는 것"(B - A) 목록.
- B(독립)에만 있고 CRITICAL/BLOCKING급인 항목의 존재 여부(이것이 "분할병렬 시 새로 놓치는 게 없다"의 반대 방향 — 오히려 독립 조사가 정규가 놓친 CRITICAL을 잡아낸다면 분할병렬의 가치를 보여주는 정보이나, 합격선 자체는 "정규 대비 독립이 CRITICAL을 누락하지 않는가"를 본다. 아래 §5 판정 규칙 참조).

## 3. P3 — warm-reuse 품질 A/B (동일 리뷰어 재사용 vs fresh 스폰)

### 가설

trace 조사에서 planner 동일 인스턴스 재사용 시 리비전이 2h10m→16.6m(8분의 1)로 단축된 표본 1건이 있었다(`.omc/specs/deep-dive-trace-pre-craft-latency-round2.md` H2/L4 — "hub 후속 메시지"로 이전 스폰을 이어 쓰는 방식). 이 절감이 critic/architect 같은 **리뷰어** 역할에도 발견 품질 저하 없이 외삽되는지가 미검증(L4/L8: "architect/critic 외삽은 미검증")이다. warm-reuse란 이전 iteration에서 이미 스폰된 리뷰어 에이전트 인스턴스에게 (fresh 재스폰 대신) **후속 메시지**(이 세션의 팀 메시징 채널이 제공하는, 이름/ID로 기존 에이전트를 이어서 호출하는 방식 — 새 대화가 아니라 같은 컨텍스트를 유지한 채 이어받는 호출)로 다음 iteration의 리뷰를 맡기는 것을 말한다.

### 트리거 조건

다음 실전 pre-craft에서 **iteration 2 이상**이 발생하는 시점(iteration 1엔 "이전 리뷰어 인스턴스"가 없으므로 P3은 반드시 2회차부터). 대상 리뷰어는 critic 또는 architect 중 그 iteration에서 실제로 재소집되는 쪽 아무 쪽이나 무방하되, 어느 쪽인지 기록에 명시한다.

### 절차

1. **A(대조군, "fresh")**: 계약대로 새 `lsc-critic`(또는 `lsc-architect`) 인스턴스를 fresh 스폰해 이번 iteration의 리비전본을 정규 리뷰한다 — 이것이 실제 합의 루프에 쓰이는 정규 리뷰.
2. **B(실험군, "warm-reuse")**: **같은 대상**(A와 동일한 리비전본)을, iteration 1(또는 직전 iteration)에서 이미 스폰했던 그 **동일 리뷰어 인스턴스**에게 후속 메시지로 재검토시킨다. 이 세션 실행 환경이 제공하는 "이전에 스폰한 에이전트를 이름/ID로 이어서 호출"하는 경로(팀 메시징 — 새 대화가 아니라 기존 컨텍스트를 유지한 채 재소집)를 사용한다. assignment는 "이번 iteration의 diff/리비전 내용을 검토하라, 이것은 A/B 비교를 위한 관측용 재검토이며 그 판정은 실제 합의 루프에 반영되지 않는다"를 명시.
3. 두 출력을 §1 정의로 발견 항목 리스트로 분해, §4 양식에 기록.
4. 실제 iteration은 A(fresh, 정규)의 `**VERDICT:**`로만 계속 진행한다(원칙 1).

### P3 판정에 필요한 산출

- 겹침률 = `|A ∩ B| / |A ∪ B|`.
- "fresh에만 있는 것"(A - B) — 이것이 가장 중요한 방향이다: warm-reuse가 이전 iteration의 판단에 **고착**(같은 관점만 반복, iteration 1에서 이미 넘어간 이슈는 다시 안 보는 습성)되어 이번 리비전에서 fresh가 잡아내는 새 결함을 놓치는지가 핵심 리스크.
- warm-reuse(B)가 놓친 CRITICAL/BLOCKING(즉 A에는 있고 B엔 없는 CRITICAL) 유무.

## 4. 기록 양식

두 프로브 모두 실행 시 아래 표를 채워 `_docs/probe-logs/{p2|p3}-YYYY-MM-DD-{feature}.md`로 남긴다(이 디렉터리는 이번 커밋엔 없음 — 실제 피기백 실행 시점에 생성).

```markdown
# {P2|P3} 실행 로그 — {feature} iteration {N} — {날짜}

## 대상
- pre-craft feature: `.lsc/crafts/{feature}/`
- 대상 아티팩트: plan.md (또는 test/ 자산) — iteration {N}
- A(정규/fresh) 스폰: {agent 종류, 스폰 시각}
- B(독립/warm-reuse) 스폰: {agent 종류·재사용 인스턴스 ID, 스폰 시각}

## 발견 항목 리스트

| # | 항목 요약 | file:line/섹션 | A(정규/fresh) | B(독립/warm-reuse) | 심각도 |
|---|---|---|---|---|---|
| 1 | ... | ... | ✅ | ✅ | CRITICAL |
| 2 | ... | ... | ✅ | ❌ | NOTABLE |
| 3 | ... | ... | ❌ | ✅ | CRITICAL |

## 집계
- |A| = {n}, |B| = {n}, |A∩B| = {n}, |A∪B| = {n}
- 겹침률(자카드) = |A∩B| / |A∪B| = {x.xx}%
- A에만 있고 CRITICAL: {목록 또는 "없음"}
- B에만 있고 CRITICAL: {목록 또는 "없음"}

## 판정
- 합격선(겹침률 ≥80% AND 신규 CRITICAL 누락 0건) 충족 여부: {합격/불합격}
- 판정 근거 한 줄: ...
```

## 5. 합격선 (P2·P3 공통, 계획 원문)

**겹침률 ≥80% AND 신규 CRITICAL 누락 0건** — 두 조건 모두 충족해야 합격.

- "신규 CRITICAL 누락"의 정확한 정의:
  - **P2**: 독립(B)이 정규(A)가 찾은 CRITICAL 중 하나라도 놓치면 누락(A의 CRITICAL ⊄ B). (반대로 B가 A에 없는 CRITICAL을 추가로 찾는 것은 누락이 아니며, 오히려 분할병렬의 장점 사례로 별도 기록한다.)
  - **P3**: fresh(A)가 찾은 CRITICAL 중 warm-reuse(B)가 하나라도 놓치면 누락(A의 CRITICAL ⊄ B). 이 방향이 핵심이다 — warm-reuse가 이전 판단에 고착돼 새 리비전의 새 결함을 놓치는 것이 정확히 우려되는 실패 모드이기 때문.
- 겹침률 계산은 CRITICAL/NOTABLE 구분 없이 **전체 발견 항목** 기준(자카드), CRITICAL 누락은 **CRITICAL 등급만** 별도로 본다 — 즉 두 지표는 독립적으로 평가하고 AND로 결합한다.

### 합격 시

- **P2 — 해당 없음(SUPERSEDED).** 분할병렬은 P2 실행 전에 이미 채택됐다(§2 상단). P2 합격은 더 이상 채택 트리거가 아니라 채택된 구조에 대한 사후 확인일 뿐이다.
- **P3 — 원문 유지.** P3 합격 → architect·critic warm-reuse를 **채택하는 별도 라운드**를 개시한다 — 이 문서가 계약을 바꾸는 것이 아니라, 합격이라는 결과 자체가 다음 ralplan/craft 사이클의 트리거가 된다.

### 불합격 시

- **P2 — 현행(병렬) 유지, 되돌리지 않는다.** 불합격은 계약을 순차로 되돌리는 근거가 **아니다** — 병렬 채택의 근거는 §2 상단 supersede 4항(프로버넌스 + 호스트 동작)이지 P2 결과가 아니기 때문이다. 대신 누락된 결함 유형을 §4 기록에 남기고, 그 유형이 `sequential fallback`의 범위를 넓혀 덮을 수 있는 것인지(예: Change Spec 감사 외에 또 어떤 architect-대면 검증이 필요한지) 판단하는 입력으로 쓴다.
- **P3 — 원문 유지.** **현행 유지**(리뷰어는 계속 fresh 스폰) — 불합격 원인(어떤 결함이 왜 누락됐는지)은 §4 기록에 남겨, 이후 재시도(예: 프롬프트를 보강한 재도전) 여부 판단의 근거로 삼는다 — 단, 재시도 자체도 이 문서가 정의한 동일 절차·합격선을 다시 통과해야 한다.

## 6. 실행 비용 가드 재확인

- 피기백은 실전 pre-craft **1 iteration**에 한정(P2/P3 각각, 같은 iteration에 동시에 걸쳐도 무방).
- 추가 스폰 **각 1기 이내**(P2: 독립 critic 1기 / P3: fresh 대조군 1기 — warm-reuse 쪽은 기존 인스턴스 재사용이라 순증 스폰 아님).
- 두 프로브를 위해 정규 합의 루프의 iteration cap, 모델/effort, 2인 리뷰 구조를 변경하지 않는다(스펙 Constraints "품질 불가침 유지" 그대로 적용).
- 프로브가 실전 pre-craft의 전체 소요시간에 미치는 영향은 "정규 진행과 병행되는 추가 스폰 1~2기의 벽시계"로 국한(정규 critic/fresh 스폰의 완료를 프로브 때문에 지연시키지 않는다 — 병행 스폰이지 직렬 대기가 아님).
