# Observation Manifest — raw findings, worker-attributed (wave 1)

## Lane 1 (PipelineContract, lsc-tracer)
- 15/15 audit 전부 "Mode: full (직전 audit verdict REJECT — §2.6 규칙에 따라 스코프 축소 없음)" 명기. §2.6: REJECT→다음 사이클 full audit, 축소 경로는 AWC 진입시에만 (skills/post-craft/SKILL.md:77-79).
- §4.2: any-lane REJECT 또는 Layer 3 생존 CRITICAL → audit REJECT. cycles 9–14 전부 생존 CRITICAL 존재(4/3/2/4/3/4 클러스터) — AWC 경로 도달 불가.
- cycle 상한 부재. 유일한 사이클 인지 장치 = lsc_audit_begin의 정보성 WARN (cycle≥3, "판정 무영향", src/craft/verdict.ts:277-282).
- §5 fix-verification은 단수 lens 승계 규정 — 다중-lens AWC 미정의 (계약 공백).
- 반-조작 규약 실재·작동 (lsc-auditor.md:51 "Do not manufacture findings", :151 clean read 허용). audit-13 폐기 0건 — finding 다수는 실재 결함.
- REJECT 조항은 "reference points, not rules" (SKILL.md:210) — 재량 있었으나 생존 CRITICAL이 사실상 강제.

## Lane 2 (OrchestrationState, lsc-tracer)
- 기간: 2026-08-13 17:40 ~ 08-19 01:36 KST (5.33일), 15회 감사, 커밋 174개, findings 총 209개(파일 카운트 기준; Lane3 집계는 ~204, Lane5는 216 — 카운트 방식 차이).
- craft finding 소비율: cycle-11 8/8, cycle-12 10/10 명시 참조 = 100%. 어떤 audit도 '미이행 finding'을 REJECT 사유로 보고하지 않음 → craft 불복종 반증.
- check 19회 중 13회 FAIL. run_check.sh 5회 개정 (--continue는 cycle 10에야 도입).
- cycle-14 red 14건 = 08-05부터 존재한 기존 계약 테스트를 [lane-2] 리팩터(-685줄)가 파손 — craft가 audit 전 체크 1회로 예방 가능했음 (audit-14.md:453 자인).
- F14-1: merge-base 58d708486 vs dev tip 152커밋 drift (현재 562커밋). Flyway V82/V83 이중 점유 git ls-tree로 실증. worktree base 재동기화 0회.
- F14-10: cycle-14 커밋 6b680b9f28이 spec.md를 사이클 중 변경 + cycle 13으로 소급 표기 — 게이트 소유권 위반.
- 완전 해소율 천장 ~52% (36–69%), fix→신규 CRITICAL 연쇄 4사이클 연속 (F12-3→F13-2→F14-3/4).
- 병렬 lane 파일 충돌 없음 (표본 --stat). 휴먼 게이트 대기 ~24h 공백 1건 (Tier 5).

## Lane 3 (MeasurementPremise, lsc-tracer)
- PREMISE: REJECT 15/15 사실 확인. 단 "전부 정당"은 부분 성립 — 최종 REJECT CRITICAL 4건 중 2건만 순수 구현 결함.
- M2: check-15 FAIL = 감사 lens ④의 Gradle 동시 실행이 만든 orchestration artifact (코드 무변경 재실행 PASS).
- M3: check-17/18 실패 = post-craft §3.0 자신이 저작한 테스트 결함 (@AfterEach Int 반환 → JUnit 초기화 거부 — 핵심 판별 테스트가 아무것도 안 재고 있었음).
- M4: F14-10 판정 기준 이동 (spec 소급 수정). M5: F14-1은 루프가 원리적으로 못 잡는 항목 (audit-14:469 자인). M6: 감사 기준선 비고정 (merge-base→dev tip 이동이 최대 CRITICAL 생성).
- M7: auditor-12-spec.md:127 CRITICAL이 spec에 존재하지 않는 요구를 인용 (폐기됨).
- M8: lens 간 상충 실재 (audit-6 ①③④R vs ②AWC; audit-10 explore APPROVE 권고 vs 최종 REJECT). 단조 상향 집계.
- cycle 11·12·13은 hard gate green 상태에서 REJECT — 후기 REJECT는 적대적 감사 독해 근거.
- 감사 자체는 엉성하지 않음: 폐기율 극히 낮음 (204건 중 2건), Layer 3 file:line 재검증, flaky 능동 판별 (--rerun-tasks 2회).

## Lane 4 (SpecAchievability, lsc-tracer)
- AC 11개 중: 결정적 6, 하이브리드 3, live 전용 2 (AC-08/09). AC-09(85% live 판정)는 5m TTL 타이밍 의존 = 원판정 비결정적.
- live probe P-1a~P-2b: 15사이클 내 0회 실행. U_ideal≥0.90 실현가능성 전제 미계산. 85%의 물리적 달성가능성은 끝까지 미검증.
- F1-4 (cycle 1): craft 환경이 dev DB·billable 호출 도달 불가 → PENDING 제도화. cycle 3: OBSERVE_ONLY 예외 제도화 (원문 AC-05 실현 불가 자인).
- 대리 게이트(paired freeze-oracle) 충실성 증명이 audit 11~14 CRITICAL 과반 생성 — "결함 제조기".
- 골대이동: 수치 축은 15사이클 불변 (85%·eligible 정의 동결). 이동은 범위 예외·절차 축에서만 (사후 명문화 8건 전부 '기존 문언과 계약 모순' 해소형).
- audit-4~14 전원 명문: live PENDING은 REJECT 사유 아님.

## Lane 5 (FindingDynamics, lsc-tracer)
- 후반부 매 cycle 신규 finding(13/16/14) > 완전 해소(2.5/4/5)의 2배 이상. 단 순수 신규(가계 신설)는 c12~14 각 2~3건뿐 — ≥70%는 기존 가계의 후속.
- 장수 결함 가계: HIL epoch F-5(c0)→F14-4 (≥10 cycle), freeze 재현성 F11-9→F14-6/7/8, Flyway F1-3(c1)→F14-1 (13 cycle 간격 재발), 관측 권위 계보 8사이클 (audit-7:23).
- audit 문서 비대화: KB/finding 2.4→8.1 (3.4배). 이행률은 단조 개선 (2/8→4/8→5/7) — 순수 악화 아님.
- c14의 4 CRITICAL 중 3개가 c0~c1 설립 가계의 자손 — 고착 가계 미폐쇄 구동.

## R1 (DesignHistory, lsc-explore)
- post-craft audit↔craft cycle 상한 없음 — "No cycle cap" 명시 (skills/post-craft/SKILL.md:266-268, 초기 커밋 6c340d7부터). 로컬 상한만 존재: check 재저작 cap=1, unheard-lane respawn 1회.
- pre-craft에는 cap 10 + [Consensus Escalation]. craft에는 [Craft Incomplete] re-entry cap 1. post-craft만 비대칭적으로 무상한.
- E2E fixture는 audit-0 1회만 검증 (test/e2e-full-cycle.test.ts:271-295) — 반복 사이클 미검증.
- lets-craft 자체 dogfooding은 2-3 cycle 수렴 (ask-tool: AWC→AWC-COMMENT; ask-readability: AWC→AWC→AWC-COMMENT).

## R2 (TargetSubject, lsc-explore)
- 대상 = Kotlin/Spring Boot ai-gateway. 85%는 config가 아닌 코드 상수 (<게이트 평가기>:25 TARGET_HIT_RATE=0.85; 판정은 read*20 >= denominator*17 BigInteger 사영).
- 측정 불성립은 FAIL이 아니라 NoVerdict (typed) — blocking reason 하나라도 있으면 NoVerdict 선행.
- branch diff: fork 08370eece1 이후 1,094 files, +140,696/−12,008 — feature 전용이 아닌 광범위 churn 포함.
- freeze oracle = production projection을 network-free로 재실행해 expected wire identity(v3)/좌표를 생성, 3방향 exact 비교.

## R3 (PromptCaching, lsc-librarian)
- 4개 provider 전부 캐시 히트는 best-effort — 결정론 보장 계약 부재. Anthropic: TTL "minimum 5m", 병렬 요청 miss, tool_choice/thinking 변경 무효화, 최소 토큰 미달 무에러 스킵. OpenAI: 머신 라우팅 의존 "best-effort", ~15RPM/prefix 상한.
- 판별 필드: cache_read_input_tokens 등 usage 3분해. CI '≥85%' 단언은 구조적으로 flaky.

## R4 (HitRateMeasure, lsc-librarian)
- hit rate 정의 2층위 (요청 기준 vs 토큰 기준) — 혼합이 공식 함정 #1. 분모 정의 미명시 시 검증 불가능.
- wire-format 안정화(정렬 직렬화·byte-identical prefix)는 업계 수렴 패턴 (ProjectDiscovery 7%→84%, Codex, tool 순서·공백 하나까지 identity) — 대상 프로젝트의 wire-identity 접근 자체는 타당.
- 단 wire가 완전 동일해도 100% 보장 없음 (라우팅·TTL·병렬). 검증은 usage 필드로.
- CI 게이트 선례: 2-pass (웜업→측정) + baseline 대비 drop 임계 — 절대치 85% 단언이 아니라 상대 회귀 검출.

## R5 (CritiqueLoops, lsc-librarian)
- 개선은 1~3회 반복에 집중, 이후 정체/하락 (Self-Refine 재분석: 2회 후 하락; ICLR2024: intrinsic self-correction은 성능 저하).
- 비평 프롬프트가 정교/적대적일수록 위양성 상승 (arXiv:2508.12358 — 정상 코드를 '미충족'으로 오판). CriticGPT: 비평기 노이즈 플로어 존재.
- 심판 승인 최적화 = Goodhart (2210.10760); self-play에서 pass율 0.72→0.94 동안 실제 정확도 0.20 불변 (2607.05904). commit-before-judge가 FP 0.719→0.012.
- 판정 비재현성: 동일 산출물·동일 설정에서도 intra-rater 신뢰도 낮음. temperature=0도 비결정.
- 정지 기준 연구 얇음 — '심판 승인'을 종료 조건으로 쓰는 루프는 Goodhart 함정 표본. EIR/ECR 임계 규칙 (2604.22273), 4단 캐스케이드 (2606.27009).

## R6 (Postmortems, lsc-librarian)
- 동형 사례 다수: Cursor review-step 무한 루프, OpenHands stuck detector 상품화, AutoGPT --continuous-limit.
- arXiv 2607.24604: typed contract ON → unsafe completion 0 그리고 accepted completion 0/72, 95.8% 예산 소진 = livelock. "게이트를 조이면 루프는 침묵으로 무한히 계속된다" — 14×REJECT의 직접 학술 대응물.
- stale evidence가 수정된 버그 부활 (+22.2pt 파괴). 강제 개정 시 현재 정확도 0.820→0.673 하락하며 ever-correct는 상승 — 루프가 마지막 상태를 망침.
- Greptile: 프롬프트만으로 nit 억제 불가 — 임베딩 클러스터 필터 필요. Google eng-practices: "확실히 개선하면 완벽하지 않아도 승인" (senior principle).
- 업계 상한 표: Claude SDK maxTurns 10, LangGraph 25, CrewAI 25, Cursor loop_limit 5, OpenHands 500+stuck detector.

## R7 (OssGates, lsc-librarian)
- 상한은 항상 다층 (재질의 3~5 < 라운드 15~500 < 전체 재시도 3 < 예산). 상한 도달 시 3갈래: 폐기 / 최선안 채택 (SWE-agent get_best, ACR select_patch) / 마지막 결과 유지.
- ACR: REJECT에 수정 지침 동반을 코드로 강제 (NO + 빈 advice = 무효 응답 → 재시도).
- OpenHands stuck detector가 동일-지적-반복 감지의 유일한 코드화 선례 (동일 action-observation 4회 등 5 시나리오).
- SWE-agent: 점수형 리뷰어 (n_sample=5 평균, fail-closed −100), max_accepts, best-of-N. 휴먼 에스컬레이션은 draft PR 강제로 구조화.

## R8 (HumanExitCriteria, lsc-librarian)
- Fagan: 결함 정의 자체가 exit criteria에 상대적 — 기준 변경 = 결함 정의 변경. 측정 가능한 exit criteria 사전 고정이 공정의 원점.
- IEEE 1028 §6.5.5.6: 재검사는 "변경된 영역 + 부작용"으로 스코프 강제 (전면 재리뷰 아님). §6.4.3(e): 재검사 진입 전 anomaly 전량 해결.
- Porter 1998: 검사자 정체가 공정 구조보다 분산을 지배 — 세션 수·수리 여부는 탐지에 무의미 (p=0.51/0.22), interval만 증가.
- Google: 변경의 80%+가 ≤1 라운드에 종결. capture–recapture로 잔여 결함 추정 → 재검사 판정의 통계적 근거.
- DoD creep 41%가 겪는 상위 문제 — 기준 무통제 증가가 승인을 품질 아닌 일정·권력의 함수로 만듦.
