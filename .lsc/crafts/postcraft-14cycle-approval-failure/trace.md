# Trace — postcraft-14cycle-approval-failure

> 조사 대상: `<대상 프로젝트>` `feat/<대상 기능>` (worktree `<대상 프로젝트>/.lsc/worktrees/<대상 기능>`) — lets-craft craft→post-craft 루프가 audit cycle 0~14 전부 REJECT로 종결, 승인 미달성.
> 방법: 5-lane 병렬 trace (lsc-tracer) + 외부 리서치 3-wave (8+4+2 워커) + 판별 프로브 4종. 정본 claim 원장: `research/claims.json` (18/18 accepted). 분류: **Brownfield** (lets-craft 저장소에 소스·git 이력 실재, 파이프라인 동작의 진단·수정을 참조).

## 1. Observed Result

- 2026-08-13 17:40 ~ 08-19 01:36 KST (5.33일) 동안 감사 15회(cycle 0~14) 전부 `**AUDIT VERDICT: REJECT**` (C-01). `.craft-state.json` = `{auditCycle: 14, verdict: REJECT}`.
- craft 커밋 174개, audit findings 약 209건(파일 카운트 기준; 계보 기준 216), check 19회 중 13회 FAIL.
- audit 문서 비대화: audit-0 30.8KB → audit-14 116.7KB (KB/finding 2.4→8.1, 3.4배).
- craft의 finding 소비율은 ~100% (cycle-11 8/8, cycle-12 10/10 명시 참조; 미이행이 REJECT 사유로 기록된 사이클 0건) (C-03).

## 2. Ranked Hypotheses

| 순위 | 가설 | 판정 |
|---|---|---|
| 1 | **H-B 요구 축**: 검증 불가능한 헤드라인 AC(live 85%)가 결정적 대리 게이트(freeze oracle/wire identity)를 강제했고, 그 증명의무가 재생산되는 구조였다 | 성립 (C-07, C-15, C-08) — 후기 CRITICAL의 주 발생원 |
| 2 | **H-A 계약 축**: post-craft 계약에 수렴 장치가 전무 (no cycle cap, §2.6 full 재감사 강제, §4.2 any-CRITICAL veto, AWC 경로 도달 불가, §5 단수-lens fix-verification) | 성립 (C-02, C-12) — 재생산을 15사이클 지속시킨 부재 조건 |
| 3 | **H-C 동역학 축**: fix-introduced 트레드밀 — fix가 새 감사 표면을 만들고 감사가 그 위에서 새 결함을 발견 | 성립 (C-04, C-14: fix-introduced 비율 62.5→85.7% 상승) |
| 4 | **H-D 측정 축**: 검증 장치의 자기 오염 — Layer-1 red의 ~83%가 예방 가능한 기존 테스트 파손, 감사 자신이 만든 FAIL/테스트 결함/기준 이동/오인용 | 성립 (C-06, C-13, C-17) — 사이클 낭비의 주범 |
| 5 | **H-E 종단 축**: worktree base drift (dev 152→562커밋) + Flyway V82/V83 이중 점유 — 루프가 자력으로 닫을 수 없는 인간 통합 결정 항목이 최종 상태를 봉쇄 | 성립 (C-05) — cycle 15+에도 REJECT 지속 보장 |
| — | H-불복종: craft가 지시를 이행하지 않았다 | **기각** (C-03) |
| — | H-조작: auditor가 finding을 제조했다 | **기각** (반-조작 규약 작동, 폐기율 2/204; cause-disappearance.md) |
| — | H-골대이동(수치): 85%·eligible 정의가 움직였다 | **기각** (수치 축 15사이클 동결; 이동은 범위 예외·절차 축만) |

## 3. Evidence Summary by Hypothesis

**H-B (요구 축)** — spec AC 11개 중 AC-08/09는 live 전용(루프 내 실행 불가; live probe 15사이클간 0회, U_ideal≥0.90 전제 미계산). F1-4(cycle 1)가 이미 "craft 환경이 dev DB·billable 호출 도달 불가"를 확정, PENDING 제도화·OBSERVE_ONLY 예외가 뒤따름 — 원문 AC 실현 불가의 자인. 대리 게이트 증명의무 수지(W2ProbeOracleObligations): 처방마다 닫힌 의무가 있어도 신규 노출이 C12 4→C13 5→C14 3+ finding으로 지속, 요구 축이 정규화 함수→marker 좌표 v2/v3→durable coordinate→production-effective strata→model/type/policy/schema semantic closure로 **상위 경계로 이동** — 단조 감소 아님, 유한 종결점 증거 없음. 외부 근거: 85% 적중률은 4사 provider 전부 best-effort (OpenAI 원문: "Repeated prompt content alone does not guarantee a cache hit") — 원판정 자체가 비결정적이므로 결정적 대리물이 강제됐고, 그 대리물의 충실성 증명이 개방형(open-ended)이었다.

**H-A (계약 축)** — `skills/post-craft/SKILL.md:266-268` "No cycle cap" (초기 커밋 6c340d7부터). 유일한 사이클 인지 장치 = `src/craft/verdict.ts:277-282`의 정보성 WARN("판정 무영향"). §2.6(SKILL.md:77-79): REJECT→다음 사이클 full 재감사, 축소 경로는 AWC 진입시에만 — 15개 audit 전부 "Mode: full" 명기. §4.2: any-lane REJECT 또는 Layer-3 생존 CRITICAL→REJECT — cycles 9~14 생존 CRITICAL 4/3/2/4/3/4 클러스터로 AWC 경로 0회 진입. §5 fix-verification은 단수 lens 승계 규정(다중-lens AWC 미정의 — 계약 공백). pre-craft(cap 10+[Consensus Escalation])·craft(re-entry cap 1)와 비대칭. E2E fixture는 audit-0 1회만 검증. lets-craft 자체 dogfooding은 2-3 cycle 수렴 — 결정적 AC를 가진 작은 feature였다는 점이 대상 프로젝트 케이스와의 차이.

**H-C (동역학 축)** — 완전 해소율 천장 ~52% (범위 36~69%, 100% 사이클 0회). fix→신규 CRITICAL 연쇄 4사이클 연속 (F12-3→F13-2→F14-3/4; audit-12:246, 13:263, 14:433 독립 자인). 장수 결함 가계: HIL epoch F-5(c0)→F14-4 (≥10 cycle), freeze 재현성 F11-9→F14-6/7/8, Flyway F1-3(c1)→F14-1 (13 cycle 간격 재발). 신규 finding의 ≥70%는 기존 가계의 후속 (순수 신규 가계 c12~14 각 2~3건). **판별 프로브 확정**: finding이 지목한 코드가 직전 사이클 fix로 마지막 수정된 비율 = 62.5→80→64.3→81.25→85.7% (보수 71.2%/causality-aware 72.7%) — 하락 없음 → 유한 재고 소진이 아니라 감사-표면 상호작용.

**H-D (측정 축)** — ① check-15 FAIL = 감사 lens ④의 Gradle 동시 실행 artifact (무변경 재실행 PASS). ② check-17/18 = §3.0 자신이 저작한 테스트 결함 (@AfterEach Int 반환→JUnit 초기화 거부: 그 사이클의 핵심 판별 테스트가 아무것도 안 재고 있었음). ③ F14-10 = spec 소급 변경(기준 이동) — cycle-14 craft 커밋 6b680b9f28이 spec.md를 변경하고 cycle 13으로 소급 표기. ④ auditor-12-spec:127 = spec에 존재하지 않는 요구를 인용한 CRITICAL (폐기됨). ⑤ **판별 프로브 확정** (method-level blame): Layer-1 red 테스트케이스 (a)당-사이클 신규 §3.0 red 8 : (b)기존 테스트 파손 40 : (c)하니스 2 — **~83%가 craft의 audit 전 check 1회로 예방 가능했던 파손** (cycle-14의 14건은 08-05부터 존재한 base dev 계약 테스트를 [lane-2] 리팩터가 파손). ⑥ anchoring 코딩 (55건): E9:D0:M46 — 순수 diff-anchored 오판 0이나 83.6%가 코드 증거 선행형, 인용 표본 10건 중 전면 3+부분 4 오인용 — commit-first 구조 부재. ⑦ run_check.sh 5회 개정 (--continue는 cycle 10에야), 하드게이트 green 상태의 REJECT 6회 (0,4,10,11,12,13) — 후기 REJECT는 적대적 감사 독해 근거.

**H-E (종단 축)** — F14-1: merge-base 58d708486 vs dev tip 152커밋 drift (조사 시점 562커밋으로 증가). Flyway V82/V83 이중 점유를 git ls-tree로 양측 실증. audit-14:432 "처방 이전에 사람의 통합 순서 결정이 필요한 항목", :469 "이 게이트가 원리적으로 잡을 수 없다", :486 "감사 기준선이 고정되어 있지 않았다". 14사이클간 worktree base 재동기화 0회.

## 4. Evidence Against / Missing Evidence

- 감사는 엉성하지 않았다: 폐기율 극히 낮음(204건 중 2건), Layer 3 file:line 재검증 전수, flaky 능동 판별(--rerun-tasks 2회), 자기 오염 투명 공개 — findings 대다수는 실재 결함이다. "REJECT 전부가 artifact"라는 강한 가설은 기각.
- 계약이 APPROVE를 불가능하게 만들지는 않았다: lane-level APPROVE/AWC 다수 발생, cycle 4에 APPROVE lane 존재, 하드게이트 5연속 green 구간 존재, 이행률 단조 개선(36%→69%).
- 골대의 수치 축은 동결됐다 — 이동은 범위 예외·절차 축에서만.
- Missing: ① U_ideal≥0.90·85%의 물리적 달성 가능성 — live probe 0회로 끝까지 미검증. ② "이상적 계약이었다면 몇 사이클에 APPROVE였나"의 반사실 — 관측 불가. ③ 휴먼 게이트 대기 ~24h 귀속은 Tier 5 정황뿐.

## 5. Rebuttal Round

- **H-A(계약)에 대한 최강 반론** (H-C 진영): "계약은 브레이크가 없었을 뿐 결함 제조기가 아니다 — 루프는 설계대로 작동했고(이행률 상승, freshness 자가 교정), 비수렴의 동력은 검증 난이도다." **응답**: 수용하되 역할 재정의 — H-A는 결함의 '발생원'이 아니라 '지속 허용 조건'이다. dogfooding 2-3 cycle 수렴 사례와의 차이는 계약이 아니라 AC의 결정성이었다. 따라서 H-A 단독으로는 14-REJECT를 설명 못 하고, H-B/C/D가 만든 finding 흐름을 멈출 장치가 없었다는 형태로 성립. 순위 유지(2위) — 단 lets-craft를 고치는 입장에서는 **유일하게 우리 소관인 축**이다.
- **H-B(요구)에 대한 반론** (Lane4 자체 반증): "audit 4~14가 live PENDING을 명문으로 비차단 처리했으니 AC 검증불가는 REJECT 사유가 아니다." **응답**: 직접 사유가 아니라 구조적 조건이다 — live 판정을 기계 판정으로 대체하라는 Constraint 7이 대리 게이트를 만들었고, W2ProbeOracleObligations가 그 증명의무의 재생산을 실증했다. 가설 원문은 기각, 수정 가설로 성립 (원장 C-07 문언 그대로).
- **H-C vs H-B 병합 검토**: 같은 메커니즘인가? 아니다 — H-B는 oracle 축의 의무 재생산(요구 설계 속성), H-C는 전 축의 fix-introduced 동역학(감사-표면 상호작용 속성). oracle 축 밖에서도 트레드밀이 관측되므로(HIL epoch 가계 등) 분리 유지. 단 둘은 같은 "트레드밀 가족"으로 상호 증폭.
- **H-D에 대한 반론**: "오염 사례는 소수이고 감사가 스스로 보정했다." **응답**: 부분 수용 — 그러나 최종 REJECT의 CRITICAL 4건 중 순수 구현 결함은 2건뿐이고, Layer-1 red의 83%가 예방 가능 파손이었다는 프로브 결과는 '사이클의 상당수가 측정 낭비'였음을 정량 확정한다. 순위 유지.
- **재순위 결과**: 변동 없음. H-B/H-A/H-C/H-D/H-E 전부 성립 — 단일 원인이 아니라 합성.

## 6. Convergence / Separation Notes

- H-B와 H-C는 독립 증거 흐름(문서 계보 vs git blame 정량)이 서로 다른 메커니즘을 가리키므로 **분리 유지**.
- H-A는 모든 축과 수렴하지만 인과 역할이 다름(허용 조건) — 병합하지 않음.
- 외부 문헌(C-09/16/18)과 내부 관측(C-04/14/15)은 **독립 증거 스트림이 같은 설명으로 수렴**: 적대적 반복 루프의 비수렴은 이 사례의 특이 사건이 아니라 문헌이 예측하는 정상 패턴이다 (1~3회 후 정체, 적대 지시→위양성, 심판 승인=Goodhart, 경성 게이트=수용 소멸).

## 7. Most Likely Explanation

**14-cycle 미승인은 4중 합성이다: (1) 검증 불가능한 헤드라인 AC(live 85%)가 결정적 대리 게이트를 강제했고 그 증명의무가 상위 경계로 재생산됐으며(H-B), (2) post-craft 계약에 이를 멈출 장치가 전무했고(no cycle cap·full 재감사·any-CRITICAL veto·AWC 도달 불가 — H-A), (3) fix가 새 감사 표면을 만들고 감사가 그 위에서 새 결함을 찾는 트레드밀이 돌았으며(fix-introduced 비율 62.5→85.7% — H-C), (4) 검증 장치 자신의 오염(예방 가능한 red 83%, §3.0 자기 결함, 기준 소급 이동, 오인용)이 사이클을 낭비시켰다(H-D). 종단 상태는 base drift로 인한 인간 통합 결정 항목(F14-1)이 봉쇄해, cycle 15+를 돌려도 구조적으로 REJECT가 지속될 상태였다(H-E).**

lets-craft 파이프라인 관점의 함의: H-B/H-E는 대상 프로젝트(대상 프로젝트) 측 속성이지만, H-A(수렴 장치 부재)·H-C/H-D를 증폭시킨 감사 구조(스코프 동결 부재, commit-first 부재, craft의 pre-audit check 의무 부재, base 재동기화 부재, 검증 불가 AC의 사전 차단 부재)는 **lets-craft가 소유한 수정 가능 표면**이다.

## 8. Critical Unknown

1. **[설계 결정 필요 — 인터뷰로]** lets-craft 수정의 범위: 어떤 수렴 장치 조합(사이클 상한+에스컬레이션 / IEEE 1028식 재검사 스코프 동결 / craft pre-audit check 의무화 / auditor commit-first / base drift 게이트 / 검증 불가 AC의 pre-craft 차단)을 채택할 것인가 — 문헌상 cap 단독은 효과가 없고(caps rarely bind), 병렬 멀티패스+집계만이 실증된 커버리지 레버.
2. **[Lane1 잔존]** counterfactual: §5가 다중-lens AWC를 지원했다면 cycles 9~14의 CRITICAL이 유계 Required Fix로 처방 가능했는가 — 관측 불가이나 계약 공백 자체는 실재.
3. **[Lane4 잔존, 대상 프로젝트 소관]** 85%·U_ideal≥0.90의 물리적 달성 가능성 — live probe 0회로 미검증. 어떤 APPROVE도 '85%의 결정적 시뮬레이션'을 인증할 뿐이었다.
4. **[문헌 공백]** commit-first를 개방형 감사 산출물에 적용하는 방법 (exact-match 불가 — future work).

## 9. Recommended Discriminating Probe

원인 규명 자체는 종결(4중 합성 확정). 남은 프로브는 수정 설계 검증용:
- **lets-craft 측**: 수렴 장치 도입 후 fixture E2E에 '다중 사이클 REJECT→에스컬레이션' 시나리오를 추가해 반복 사이클 경로를 최초로 시험 (현행 E2E는 audit-0 1회만 검증 — R1).
- **대상 프로젝트 측 (이 pre-craft 범위 밖, 권고만)**: 인간 통합 결정(F14-1 Flyway renumber + base rebase) 후 vLLM `sha256_cbor` 결정론 환경을 통제군으로 한 paired live probe 1회 — 85%의 물리적 달성 가능성을 처음으로 실측.

## 10. Additional Trace Lanes

불필요 — 잔존 불확실성은 관측 불가능한 반사실(2)과 대상 프로젝트 소관(3)뿐이며, 레인 추가로 좁혀지지 않는다.

---

## Lane Sub-Reports (전문은 각 워커 산출물, 요지)

### Lane 1 — PipelineContract (Confidence: High)
가설: 계약이 구조적으로 수렴을 막는다. Evidence For: §2.6 full 재감사 강제(15/15 "Mode: full"), §4.2 any-CRITICAL veto, cycle 상한 부재(정보성 WARN뿐), §5 단수-lens 공백. Against: 반-조작 규약 작동, REJECT 조항은 "reference points, not rules"였으나 생존 CRITICAL이 사실상 강제, 수렴 메커니즘(AWC·Layer 3 폐기권) 자체는 존재. Critical Unknown: 다중-lens AWC counterfactual. Probe: audit-13 CRITICAL 클러스터의 dry-run 합성.

### Lane 2 — OrchestrationState (Confidence: High)
가설 분해: H2a 미소비=반증, H2b lane 충돌=반증, H2c check/freshness 운영=부분 성립(자가 교정 이력), H2d base drift=성립(종단 원인), H2e 게이트 소유권 위반(F14-10)=성립, H2f 인스턴스 스코프 수렴 역학=성립. 완전 해소율 천장 ~52%. cycle-14 red는 기존 계약 테스트 파손 — 예방 가능(audit-14:453 자인).

### Lane 3 — MeasurementPremise (Confidence: Medium-High)
PREMISE AUDIT: "15/15 REJECT" 사실이나 "전부 정당"은 부분 성립. M1~M11 방법론 결함 인벤토리 (check 하니스 비결정성, orchestration artifact, §3.0 자기 결함, 기준 이동, 검증 불가 요구, 기준선 비고정, 허위 CRITICAL, lens 상충, 트레드밀, 85% 루프 외부성, streak 불일치). 최종 REJECT CRITICAL 4건 중 순수 구현 결함 2건.

### Lane 4 — SpecAchievability (Confidence: Medium-High)
가설 원문(AC 검증불가→직접 REJECT) 기각, 수정 가설 성립: AC-09 live 판정 요구 + 실행 불가 환경 → 대리 게이트 강제 → 증명 부담이 14-REJECT의 구조적 조건. AC 분류: 결정적 6 / 하이브리드 3 / live 전용 2. 사후 명문화 8건 전부 '기존 문언과 계약 모순' 해소형.

### Lane 5 — FindingDynamics (Confidence: High)
후반 신규 finding(13/16/14) > 완전 해소(2.5/4/5)의 2배. 순수 신규 가계는 c12~14 각 2~3건 — 발산이 아니라 **고착 가계 미폐쇄** 구동. c14 CRITICAL 4건 중 3건이 c0~c1 설립 가계의 자손. 이행률은 단조 개선 — 순수 악화 아님.

## External Research Summary

전문·인용 사슬은 `research/SYNTHESIS.md` (정본: `research/claims.json`, 18/18 accepted). 요지 4개:
1. **85% 캐시 적중률은 결정론적 검증 불가** — 4사 provider 전부 best-effort 명시, countersearch에서 강화. 자체호스팅 vLLM만 조건부(무 eviction·sha256_cbor·동일 salt) 결정론 (C-08, C-18).
2. **반복 비평 루프의 비수렴은 문헌의 예측 패턴** — 1~3회 후 정체/악화, 적대 지시→위양성 상승, 심판 승인=Goodhart, 경성 게이트=수용 소멸(accepted 0/72). 순차 무상한 루프의 수렴 실측은 부재; 실증된 커버리지 레버는 병렬 멀티패스+집계(n=5-10 plateau) (C-09, C-16, C-18).
3. **수렴 장치의 선례**: 인간 공정 — 사전 고정 exit criteria, 변경 범위+부작용 스코프 재검사(IEEE 1028), 재검사 진입 전 anomaly 전량 해결, capture-recapture; OSS — 다층 상한+명시 정책, OpenHands stuck detector; 문헌 최강 개입 — commit-before-judge (FP 0.719→0.012, 단 개방형 산출물 적용은 future work) (C-10, C-11, C-16).
4. **wire-identity 정규화 접근 자체는 업계 정합** (ProjectDiscovery 7%→84% 등) — 대상 프로젝트의 기술 방향이 틀린 게 아니라, 그것의 '결정적 증명'을 감사 게이트로 삼은 검증 계약 설계가 병목 (R4, C-15).
