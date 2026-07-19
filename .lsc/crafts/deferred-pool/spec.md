# Spec — deferred-pool

## Metadata

| 항목 | 값 |
|---|---|
| Feature | deferred-pool — 이연 풀 핵심 6종 도구화 + D-3 계약 예외 (T-1+A-5 lsc_land, E-1 lsc_scaffold, F-3 /lsc-doctor(+R0 흡수), E-3 CraftState 한정, T-2 root 통일, D-2 리서치 원장, D-3 뮤테이션 프루프 절) |
| 분류 | Brownfield (trace 확정 — 전 항목이 기존 모듈 개조·확장) |
| 공식 | ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| 최종 ambiguity | **0.0495** (게이트 0.05 통과, 7라운드) |
| Challenge modes | contrarian@R4 (탈출구 의미론), simplifier@R6 (소형 3종 구성) · ontologist 미발동 (R7 종료, ambiguity < 0.3) |
| 환경 고정 | repo HEAD 92e5d12 기반 feat/deferred-pool, worktree `.lsc/worktrees/deferred-pool`, SDK @oh-my-pi/pi-coding-agent 16.4.0 |
| 정본 | `_docs/deferred-pool.md`(대상 목록·검증자 좁힘), `_docs/reference-insights.md`(원천 인사이트·검증자 노트), trace.md·research/SYNTHESIS.md(리서치 잠금) |
| 작성일 | 2026-07-19 |

## Clarity Breakdown (최종)

| Dimension | Score | Weight | Weighted | 근거 |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | 범위 분리선(R1)·구성(R6) 확정, 컴포넌트별 목표 1문장화 가능 |
| Constraints | 0.95 | 0.25 | 0.238 | land 의미론(R2)·탈출구(R4)·doctor read-only·D-3 예외 형태 확정 |
| Criteria | 0.95 | 0.25 | 0.238 | AC 12항 + 검증 계층(R5) + doctor 판정 정책(R3) 확정 |
| Context | 0.93 | 0.15 | 0.140 | trace 5-lane + 리서치 3-wave의 seam 좌표·관례 잠금 |

## Topology (sub-components)

| ID | 컴포넌트 | 소유 파일(예상) | 최종 G/C/Cr |
|---|---|---|---|
| A | lsc_land + validateWorktreeRemovalTarget (T-1+A-5) | src/craft/land.ts(신규), src/artifacts/worktree.ts(검증 함수+list), src/main.ts, skills/post-craft/SKILL.md | 0.97/0.96/0.96 |
| B | lsc_scaffold (E-1) | src/artifacts/scaffold.ts(신규), paths.ts·worktree.ts·gitignore.ts 재사용, skills/pre-craft/SKILL.md | 0.95/0.95/0.94 |
| C | /lsc-doctor (F-3 + R0 흡수) | src/doctor.ts(신규, 순수 코어), src/main.ts registrar, gitignore.ts read-only 체커 분리 | 0.96/0.95/0.96 |
| D | CraftState stateVersion (E-3 좁힘) | src/craft/state.ts | 0.95/0.95/0.95 |
| E | root-해석 헬퍼 통일 (T-2) | src/craft/state.ts·verdict.ts(공용 헬퍼 추출) | 0.94/0.94/0.93 |
| F | 리서치 claim 원장 (D-2) | src/research/ledger.ts(신규 순수 모듈), skills/pre-craft/SKILL.md 리서치 절 | 0.95/0.94/0.94 |
| G | 뮤테이션 프루프 계약 예외 (D-3) | skills/pre-craft/SKILL.md Stage 4, test/skill-contract.test.ts | 0.95/0.95/0.95 |

라운드별 타깃: 전역(R1)→A(R2)→C(R3)→A 전역 제약(R4 contrarian)→전역 Criteria(R5)→C·D·E 구성(R6 simplifier). `topology.last_targeted_component_id = 전역(R6)`.

## Goal

`_docs/deferred-pool.md`의 이연 항목 중 즉시 코드화 가능한 핵심 6종을 리서치 잠금 형태로 구현하고, D-3의 계약 예외 조항을 스킬 산문에 새긴다. 한 문장: **post-craft의 손수 bash land를 fail-closed 도구(lsc_land)로 승격하고, pre-craft의 paths.ts 산문 재현을 도구(lsc_scaffold)로 봉쇄하며, 운영 표면 진단(/lsc-doctor)·CraftState 버전 각인·root 해석 통일·리서치 클레임 원장·테스트 변별력 프로브 계약을 함께 착지시킨다.**

컴포넌트별 목표:
- **A (lsc_land)**: auditValidated(현재 audit 사이클·APPROVE 계열)와 `[Land]` nonce 소비를 전제로만 실행되는 merge+worktree 정리 도구. `git merge --no-ff` → `validateWorktreeRemovalTarget` 통과 시 `removeWorktree`+`pruneWorktrees`. dirty worktree는 isError 거부, `[Land]` confirm 재승인 후 force 재호출 경로. §7.1 프로즈 계약("검증된 판정 없으면 merge 금지")의 코드 격상이자 ralplan Phase 5의 완결.
- **A (validateWorktreeRemovalTarget)**: 순수 함수 — 거부: 빈/공백·NUL·`.`/`..`/`~`·경로 구분자 주입·심링크·expectedRoots(containment) 밖·파일시스템 루트/홈·메인 리포(.git 디렉터리 판별은 git 원생과 중복임을 주석 명시). **dirty/locked/submodule은 검사하지 않는다**(git --force 의미론에 일임).
- **B (lsc_scaffold)**: pre-craft Stage 0의 worktree/branch/crafts 디렉터리/gitignore 배선을 기존 TS 함수(addWorktree/ensureWorktreesGitignored/paths.ts) 재사용으로 수행하는 결정적 도구. 재실행 no-op(resume 정합), 쓰기 경계(worktree 내부 한정·심링크 거부). 스킬 산문의 bash 재현(SKILL.md:84-96)을 도구 호출로 대체(co-evolution).
- **C (/lsc-doctor)**: read-only 진단 커맨드. 검사: dist↔src 드리프트(src-hash 재사용)·plugin link(symlink/lock/manifest/dist, 실행 중 로드는 UNKNOWN)·agents frontmatter(물리 9종 SSOT)·models.yaml(validatePreset 재사용)·고아 worktree(list --porcelain의 prunable reason 세분)·stale craft-state(worktree 부재/파싱 불가/미폐쇄 openRelease)·gitignore 등록(read-only 체커)·**R0 흡수: SKILL.md 경로 리터럴 vs paths.ts 헬퍼 출력 대조**. 격리 실행(per-check try/catch+timeout), PASS/WARN/FAIL 표 + 증거 인용, FAIL=exit 1/WARN-only=exit 0.
- **D (stateVersion)**: CraftState에 stateVersion 필드 — 쓰기 시 현재 버전 각인, 로드 시 미지 신버전이면 명시적 에러(침묵 오독 금지), 필드 부재(구버전)는 관용 읽기 유지. HashManifest/ModelsFile은 비목표(리서치 반증·연기).
- **E (root 헬퍼)**: findPersistedCraftState(state.ts:345-351)와 resolveAuditRoot(verdict.ts:163-166)를 단일 root-해석 헬퍼로 통일. 정상 all-in-worktree 흐름의 기존 동작 보존이 1급 제약.
- **F (claim 원장)**: claims.json 스키마(claim별 dropCondition 필수) + 순수 평가기(반박 증거 있고 살아남은 지지 없으면 무조건 rejected — 환각 생존 경로 차단) + pre-craft SKILL.md 리서치 절에 정본-projection 계약(claims.json=정본, SYNTHESIS.md=파생 뷰, 역방향 편집 금지) 명문화. 프레이밍: "비적대·부주의 케이스의 결정론적 하한"(오라벨 우회 한계 병기).
- **G (D-3 계약 예외)**: pre-craft SKILL.md §0 불변식에 명시 예외 — "일회성 임시 변이 + 즉시 원자 복구"(구현 작성 허용이 아님). Stage 4에 프로브 절: 브라운필드 한정, 기존 구현 seam에 단일 변이, baseline-green 독립 서브셋의 failure delta로 kill 판정(full run RED로 판정 금지), oracle-mirroring 서브셋 회피, revert 후 git diff 청결 확인, 그린필드/분리 불가 브라운필드는 명시 `D-3: N/A`. 문구는 "테스트 스위트 변별력 검증"이 아니라 **"변이 seam 한정 tautology 스모크"**(리서치 N5 잠금).

## Constraints

1. **A-5 순증분 경계 (리서치 N1 잠금)**: 검증 함수는 경로 안전 4종(인자 sanity·containment·심링크·root/home)만. dirty/locked/submodule 재구현 금지 — git `--force` 의미론(1회=dirty, 2회=locked)을 존중. `.git` 디렉터리 판별 포함 시 git R1/R2와 중복임을 주석 명시. (R2)
2. **lsc_land 게이트**: auditValidated가 현재 audit 사이클·APPROVE 계열을 가리키고 `[Land]` nonce가 방금 소비된 경우에만 실행(fail-closed). destructive-approval.ts의 기존 발급 인프라·release.ts:54-88 소비 템플릿 재사용 — 새 승인 메커니즘 발명 금지. (R2)
3. **탈출구는 수동 bash 복귀** (R4 contrarian 생존): lsc_land에 override 플래그를 두지 않는다. 도구 결함 시 최후 수단은 인간의 직접 git merge이며, 스킬 산문이 이를 '도구 결함 시 예외'로만 명문화한다. '탈출구 없음'은 데드락 위험으로 기각, '도구 내 override'는 보안 표면 재개방으로 기각.
4. **doctor는 사용자 표면 read-only**: 진단 중 무변경 — 현행 ensureGitignored처럼 읽고-즉시-쓰는 헬퍼를 doctor가 호출하면 계약 위반이므로 read-only 체커를 분리한다. 수정은 제안(remediation 텍스트)만. (R3)
5. **doctor 판정 정책 (R3)**: 검사 대상 SSOT = 물리 agents 9종(name/description 필수, tools/spawns/thinkingLevel 선택), README 8종 서술은 WARN(stale 문서). plugin '실행 중 로드'는 UNKNOWN 표기·exit 미반영. stale craft-state = worktree 부재·파싱 불가·미폐쇄 openRelease. exit: FAIL=1, WARN-only=0.
6. **검증 계층 (R5)**: 산문 항목(G, F의 SKILL 절, B의 co-evolution)은 skill-contract.test.ts 문자열 검증. fixture E2E 실동작 검증은 비목표(E2E는 절 존재/행 수만 — 철학 9).
7. **E-3 좁힘 (리서치 N6 잠금)**: stateVersion은 CraftState만. 필드 부재=구버전 관용(기존 optional-관용 docstring 관례 유지), 미지 신버전=명시적 에러. Cargo 패턴(first-class error) 준거.
8. **T-2 통일은 동작 보존이 1급**: 두 호출점의 정상 all-in-worktree 흐름 회귀 green이 전제 — 혼합/레거시 엣지의 동작 변화는 명시적으로 문서화.
9. **순수 함수/thin wrapper 관례 유지**: vitest가 omp SDK를 import할 수 없으므로(기존 6파일 명시 근거) 게이트·검증·평가기 로직은 순수(또는 SDK-independent) 계층으로 분리하고 pi.registerTool/registerCommand 래퍼는 얇게. doctor 격리는 expo Promise.all+per-job try/catch 뼈대 + per-check timeout.
10. **CraftState 확장 필드 optional + 읽기 관용** (release-gate 선례, state.ts:38-48 docstring 관례). durable 쓰기는 writeFileAtomicSync.
11. **질문 태깅 규약·해시 보호·파이프라인 불변식 불변**: 이 feature는 기존 enforcement(cap·카운터는 플랫폼 소유)를 확장하지 않는다.
12. **D-3 프로브의 안전 경계 (G)**: 변이 대상은 hash 보호 범위(test/) 밖의 구현 소스만. 변이는 절대 커밋 금지, 복구 실패 시 즉시 중단+비승인 handoff. 프로브 실행 주체는 Stage 4 오케스트레이터(tester에게 소스 쓰기 권한 위임 금지).

## Non-Goals

- **D-1 (모호도 floor)** — 선행 조건(fixture E2E green 기준선) 부재가 5개 독립 정황으로 확인됨(trace H5). 기준선 확보 후 별도 feature.
- **D-4, A-4파트2** — 증분 미미(D-4: WHY 첨부 기존재)·과차단 위험(A-4p2: 테스트 선작성과 구분 모호). (R1)
- **E-2 확장(영수증·원장), B-2 확장(sha256 영수증), C-2 파트2(stop 분류기)** — dogfooding 관측 의존·플랫폼 cap 소유·SessionStopEvent 사유 필드 구조적 부재(SDK 재확인). (R1)
- **HashManifest·ModelsFile version 필드** — 리서치 반증(매 init 전체 재계산)·연기(content-shape 무모호). (R6)
- **lsc_land override 플래그 / 수동 merge 전면 금지** — R4에서 기각.
- **R0 독립 --check CLI** — doctor 검사로 흡수. (R6)
- **이연 풀 밖 잔여 산문-중복 지점 5+** (craft §4 금지 도구 표 등, trace H3) — 이번 범위 밖, 후속 후보로만 기록.
- **enforcement tool_call 블록 확장, 시간 기반 만료, 주입-예시 소독** — 선행 feature들의 기각 사유 승계.

## Acceptance Criteria

`run_test.sh`가 다음을 기계 검증한다 (산문 항목은 skill-contract 문자열 계층 — R5):

1. **[A] 무검증 land 거부**: auditValidated 부재/타 사이클/비-APPROVE 계열/`[Land]` nonce 미소비 → lsc_land가 isError로 fail-closed 거부.
2. **[A] 승인 경로 성공**: 현재 사이클 APPROVE + `[Land]` 소비 직후 → merge --no-ff + worktree remove + prune이 fixture repo에서 실행됨.
3. **[A] dirty 거부→force 재승인**: dirty worktree → isError(재승인 안내 포함); `[Land]` 재승인 후 force → 성공. force 없이 locked/main/미등록은 어떤 경로로도 삭제 불가.
4. **[A] 검증 함수 거부 매트릭스**: 빈/공백·NUL·`.`/`..`/`~`·심링크·containment 밖·root/home·메인 리포 전수 거부 + **dirty/locked를 검사하지 않음의 음성 확인** (vitest 순수 계층).
5. **[B] scaffold 결정성**: 재실행 no-op(기존 아티팩트 보존), 심링크 거부, worktree 밖 쓰기 거부, worktree/branch/gitignore 결과가 기존 TS 함수 경유임을 검증.
6. **[B+G] 스킬 co-evolution**: pre-craft SKILL.md가 bash 재현 대신 lsc_scaffold를 지시하고, Stage 4에 D-3 프로브 절(브라운필드 한정·differential·즉시 복구·그린필드 N/A·'tautology 스모크' 문구)이 존재 — skill-contract 문자열 검증.
7. **[C] doctor 표·exit 계약**: 검사별 PASS/WARN/FAIL + 증거 인용 출력, FAIL 존재=exit 1, WARN-only=exit 0, 진단 전후 파일 무변경(read-only), 격리(한 검사 실패가 전체를 중단시키지 않음).
8. **[C] doctor 검사 정확성**: 9종 frontmatter 파싱(필수/선택 스키마), plugin-loaded UNKNOWN, 고아 worktree(prunable reason), stale craft-state 3조건, R0 리터럴 대조 검사가 각각 조작된 fixture에서 올바른 판정을 냄.
9. **[D] stateVersion**: 신규 쓰기에 버전 각인, 미지 신버전 로드 시 명시적 에러, 필드 부재 구버전 파일 관용 읽기(기존 테스트 관례 유지).
10. **[E] root 헬퍼 통일**: 단일 헬퍼 도입 후 기존 두 호출점의 정상 흐름 회귀 green(기존 craft-state·verdict 테스트 무손상).
11. **[F] 평가기 기각 기본값**: dropCondition 누락 claim은 invalid, 반박 있고 지지 없으면 무조건 rejected, no-evidence는 uncertain — 순수 vitest. SKILL.md 리서치 절에 정본-projection 계약 문구 존재(skill-contract).
12. **[전역] 기존 단위 스위트 전수 green** (회귀).

## Assumptions Exposed & Resolved

| # | 노출된 가정 | 해소 (라운드/근거) |
|---|---|---|
| 1 | "전부 구현"은 15항목 동시 코드화를 뜻한다 | R1: 핵심 6+D-3 계약 예외로 분리, 조건부 6종은 사유 명시 비목표 |
| 2 | merge 차단은 절대 제약이다 | R4: 도구는 fail-closed지만 탈출구는 수동 bash 복귀(인간이 궁극 권위) |
| 3 | doctor는 이슈 발견 시 무조건 non-zero | R3+countersearch: FAIL=1/WARN-only=0으로 세분(업계 관례 잠금) |
| 4 | E-3는 세 durable 파일 전부의 버전 필드 | 리서치 wave 3: CraftState만 창 실재 — 한정 |
| 5 | D-3는 '스텁 오답 주입'이며 스위트 변별력을 검증한다 | 리서치: 브라운필드 seam 한정 + differential + 'tautology 스모크'로 격하 |
| 6 | R0는 lazycodex 이식이다 | 리서치: 원형 부재 — R6에서 doctor 검사로 흡수 |
| 7 | agents는 8종이다(문서) | 물리 9종 확인 — doctor SSOT는 물리 파일, 문서 stale은 WARN |

## Technical Context

- 재사용 seam(전부 file:line 검증됨): destructive-approval.ts:22·release.ts:24,54-88(A 게이트), state.ts:315-326·verdict.ts:36(A 판정), worktree.ts:9-27 private git seam(A·C), paths.ts 전체(B), src-hash.ts:55-88(C), validate.ts:39-51+inject.ts:34-50 패턴(C), models-file.ts yaml dep(C), state.ts:333-351·verdict.ts:163-166(E), atomic-write.ts(D), gajae ledger.ts:110-178(F의 원천 — 주석까지 보존 이식).
- 신규 표면: land 도구+registrar, scaffold 도구, doctor 코어+registrar+frontmatter 파서+listWorktrees+read-only gitignore 체커, ledger 순수 모듈.
- 함정(리서치 실측): BUILD_INFO.gitHash는 srcHash 일치와 별개로 stale 가능(doctor는 srcHash를 canonical로), lsc_land의 identity 조립은 persisted 3필드 재조립 신규 경로(false-reject 리스크 — AC 2가 fixture로 고정), FakeSessionApi류 oracle-mirroring(G의 서브셋 선정 규칙).

## Trace Findings

trace.md 참조 — 최유력 설명(핵심 6 즉시 구현 가능·조건부 7 분리 필요)이 본 spec의 R1 결정으로 확정됨. 반박 라운드가 release-gate 다중 도구 단일 feature 선례로 '단일 feature 가능' 조건을 정제했고, 본 spec은 그 조건(조건부 항목의 명시 분리)을 충족한다. 리서치 인용 트레일: research/SYNTHESIS.md [S1]-[S18], 클레임 잠금: research/claim-graph.md (K1-K10, N1-N7).

## Ontology + Ontology Convergence

엔티티(최종 8): lsc_land 도구 · validateWorktreeRemovalTarget 순수 함수 · lsc_scaffold 도구 · /lsc-doctor 커맨드(R0 검사 포함) · CraftState.stateVersion · root-해석 공용 헬퍼 · claims.json 원장+평가기 · D-3 프로브 계약(스킬 산문).

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 8 | — | — | 8 | 0 | N/A |
| 2 | 8 | 8 | 0 | 0 | 0 | 1.0 |
| 3 | 8 | 8 | 0 | 0 | 0 | 1.0 |
| 4 | 8 | 8 | 0 | 0 | 0 | 1.0 |
| 5 | 8 | 8 | 0 | 0 | 0 | 1.0 |
| 6 | 8 | 8 | 0 | 0 | 0 | 1.0 (R0가 독립 엔티티로 분화하지 않고 doctor 속성으로 확정) |
| 7 | 8 | 8 | 0 | 0 | 0 | 1.0 — 수렴 |

## Interview Transcript

- **R1 [Goal]** 범위 분리선 (lsc_select, 3택) → `핵심 6 + D-3 계약 예외`. (조건부 나머지 6종 비목표 확정)
- **R2 [Constraints]** lsc_land 게이트·정리 계약 (lsc_select, 3택) → `완전 fail-closed + force는 재승인`.
- **R3 [Success Criteria]** doctor 판정 정책 3건 (lsc_select, 3택) → `리서치 정합 묶음 (권장)`. (9종 SSOT·UNKNOWN·FAIL=1/WARN=0)
- **R4 [Constraints] (Contrarian)** 탈출구 의미론 (lsc_select, 3택) → `탈출구는 수동 bash 복귀`.
- **R5 [Success Criteria]** AC 초안 12항 + 산문 검증 계층 (lsc_select, 2택) → `skill-contract 문자열 검증 (현행 관례)`.
- **R6 [Constraints] (Simplifier)** 소형 3종 구성 (lsc_select, 3택) → `전부 유지 + R0은 doctor 검사로 흡수`.
- R7: 게이트 판정 — ambiguity 0.0495 < 0.05, 종료.

각 라운드에서 점수표(Dimension/Score/Weight/Weighted/Gap)·병목 1문장을 채팅에 표시했고, 전 질문이 §1.2 태깅 규약을 준수했다. 자유 답변 발생 0회.
