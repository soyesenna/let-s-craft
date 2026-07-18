# SYNTHESIS — deferred-pool 외부 리서치 종합

> 3 waves(saturation 9 + expansion 3 + closure 1), 수렴 선언: wave-3.md. 클레임 잠금: claim-graph.md.
> 인용: [S1]~[S13]은 하단 Sources. 워커 전문은 agent:// 아티팩트.

## 1. 전제 감사 — 문서는 정확하고, 이연 항목은 전부 진짜 미구현이다

`_docs/deferred-pool.md`와 `reference-insights.md`가 HEAD 92e5d12의 리포 상태에 대해 서술한 사실 클레임 10건은 전부 정확하다(REFUTED/PARTIAL 0건) [S1]. 역방향 검증(등록 도구 11개 + 커맨드 2개 전수 열거)에서도 이연 항목의 시그니처는 0건 — stale 항목 없음 [S1]. 레퍼런스 3리포(lazycodex/gajae-code/oh-my-claudecode)는 리포 루트에 로컬 체크아웃으로 존재하며, 인용된 원천 파일과 메커니즘 전부 실재한다(경로 교정 2건뿐) [S2][S3]. 원천 테스트 실행 프로브(scaffold 9/9, migration 54/54, directive mirror 7/7)로 메커니즘 동작까지 확인했다 [S2].

## 2. T-1 + A-5 — 발급 인프라는 완비, 소비자와 검증기만 남았다

release-gate feature가 `[Land]` 태그의 발급 인프라를 이미 완비했다: `DESTRUCTIVE_GATE_TAGS`에 `[Land]` 선언(destructive-approval.ts:22), 소비 3단 트랜잭션 템플릿(release.ts:54-88), `auditValidated {cycle,verdict,at}` 영속 마커(state.ts:315-326), `APPROVE_FAMILY_VERDICTS` 상수(verdict.ts:36) [S4]. T-1은 재설계가 아니라 ralplan Phase 5의 "검증된 판정 없으면 merge 차단" 항목의 자연 완결이다 [S5].

A-5의 순증분 경계는 git 소스 수준에서 확정됐다 [S6]: `git worktree remove`의 원생 거부는 R1(미등록)~R5(dirty)이며 R1/R2/R4는 `--force`로 불가침. **git이 절대 못 막는 것** = ① feature 인자 sanity(빈/NUL/`.`/`..`/`~`/구분자 주입) ② expectedRoots containment — candidate의 realpath가 우연히 *다른 등록된* worktree와 일치하면 git은 그걸 지워버린다(isInside가 유일 방어) ③ 심링크 거부 ④ root/home fail-fast. **넣지 말아야 할 것** = dirty/locked/submodule 재구현(git `--force` 의미론과 이중화 드리프트). OMC 원천(worktree-cleanup-safety.ts:1-118)은 이 순증분을 정확히 구현하며 teleport 커맨드에 삭제 직전 2회 배선된 실전 선례가 있다 [S3]. `rm -rf` 잔류 entry는 remove가 아닌 `prune`으로만 정리되며(R1이 막음), `list --porcelain`의 `prunable <reason>` 문자열은 버전 무관 안정 계약이라 F-3 진단에 직접 쓸 수 있다 [S6].

## 3. F-3 /lsc-doctor — 관례는 수렴, 재사용 표면은 실측 완료

4개 doctor(brew/flutter/npm/expo) 소스 판독 결과 [S7]: read-only + 격리 실행 + 제안만 출력이 공통 철학이나 **exit 계약은 갈린다** — brew/npm/expo는 이슈 시 non-zero, flutter만 항상 0(의도적 '게이트 비사용' 설계). countersearch(clippy 기본 0, swift-format, cfn-lint 옵션 역사)가 'warning까지 non-zero'를 반증하므로, 잠긴 계약은 **FAIL(error-severity)=non-zero, WARN-only=0** [S8] — OMC doctor-conflicts의 WARN↔hasConflicts 분리 선례와 정합한다 [S3]. 격리 뼈대는 expo의 Promise.all + per-job try/catch + flutter의 per-check timeout, 출력은 flutter 4단 시각 + brew 'this is not an error' 서문 + `--json` 이중 출력이 이식 권고다 [S7].

재사용 매트릭스(실측) [S9]: `src-hash.ts`(computeSrcHash/hashSrcDir/driftWarning — main.ts:94-97 session_start 선례)와 `validate.ts`(validatePreset + resolver 콜백, inject.ts:34-50 패턴)는 시그니처 그대로 재사용. worktree list 파서·state 전체 스캔·gitignore read-only 체커는 소폭 개조(현행 `ensure*`는 진단 중 파일을 수정해버려 no-change 계약 위반). plugin link 검사·frontmatter 파서·registerDoctorCommand는 신규. 함정 2건: BUILD_INFO.gitHash는 stale이어도 srcHash가 일치할 수 있어 hash만으로 빌드 신선도 판정 불가; agents 물리 파일 9개 vs README·LSC_AGENT_NAMES 8개 불일치(critic-recheck가 나중에 추가됨 — 문서 stale) [S9].

## 4. E-3 — 전제가 좁혀졌다: 대상은 CraftState뿐

스키마 버전 관례 조사 [S10]는 결정 규칙을 준다: 재생성 가능 파일 → 관용(npm), 단독 진리원 → 명시적 에러(Cargo/Terraform). countersearch("모든 config에 schemaVersion이 안전한 기본값", K8s apiVersion, SQLite user_version, 사후 추가 비용 문헌)가 '불필요' 클레임을 약화시켰고 [S8], wave 3 내부 검증이 최종 판정을 내렸다 [S11]: **CraftState는 '업그레이드-중-craft' 창이 실재한다** — clearActiveCraft는 파일을 삭제하지 않고(state.ts:248-251), post-craft가 active craft 없이 같은 파일을 재기록하며(state.ts:284-326), persisted reader가 4경로다. **HashManifest는 반증** — 매 init 전체 재계산·overwrite라 정상 resume에 stale-schema 계속-읽기 경로가 없다(잔여: init 전 verify/restore의 transient reader). ModelsFile은 content-shape 판별이 아직 무모호해 도입 연기. → E-3의 경량 코어는 "세 파일 일괄"이 아니라 **CraftState(특히 openRelease·release evidence·audit marker 등 safety-critical 필드) 우선**으로 좁힌다.

## 5. D-1 — 전제는 강력 실증, 설계 공백 1건은 자체 설계 필요

LLM 자기채점의 앵커링·과신은 정량 실증된 현상이다: 자기 답을 볼 때 confidence +0.22 부풀림·답변 변경 확률 71% 감소(6모델 일관), self-refine 반복이 편향을 증폭 [S12]. `max(reported, floor)` 클램프는 KnowU-Bench 'bounded base score'·DSPy Assert·Guardrails·LangGraph recursion_limit과 동형인 산업 표준 패턴의 특수화다 [S12]. 원천(gajae deep-interview-ambiguity.ts)의 가중치 0.10/0.05/0.05는 정확하되, disputed 처리는 답변 교체 시 **기계적**(LLM 불개입)이고 해소 조건은 `superseded_by`뿐이다 [S3]. **선례 부재로 자체 설계가 필요한 것**: floor가 게이트 위에 고착되는 시나리오의 코드 수준 상한 안전장치(어느 프레임워크에도 없음) [S12]. 캘리브레이션은 fixture E2E 기준선에 의존하는데 그 기준선(green 기록)이 현재 부재하다 [S13].

## 6. D-2 — 4축 정당화 + 정본-projection 계약이 드리프트 경고의 해법

dropCondition 사전 등록은 과학방법론 사전등록의 1차 목적("기각 조건 사전 명시")과 동형이고, accepted/rejected/uncertain은 FEVER 3-label의 표준 어휘이며, "반박 있고 지지 없으면 무조건 rejected"는 Popper 비대칭 + gajae ledger.ts:141-148의 실증 구현이 있다 [S3][S12']. 죽은 클레임 부활 차단은 CALM tombstone 단조성으로 정당화된다. 검증자 경고 (2)(claims.json 드리프트 +1)의 정석 해법은 **claims.json=정본, SYNTHESIS.md=projection(역방향 편집 금지)** — Event Sourcing projection + Google ClaimReview mismatch 규칙과 동형. 한계 병기 필수: 라벨링이 LLM 의존인 한 적대 오라벨은 우회 가능 — "비적대·부주의 케이스의 결정론적 하한"으로 프레이밍한다. 원천의 counterexampleQueries는 validation-only(평가기 미실행)임을 이식 시 인지할 것 [S3].

## 7. D-3 — 원안 재정의: 스텁이 아니라 브라운필드 seam, 스위트 검증이 아니라 tautology 스모크

pre-craft에는 스텁이 없다(§0 구현 금지). 유효한 변이 대상은 **브라운필드의 기존 구현 seam**(실사례: state.ts recordTestResult, validate.ts splitEffort)이고, 완전 그린필드는 명시적 `D-3: N/A`로 기록한다 [S14]. full run_test.sh는 feature RED가 정상이라 nonzero로 kill 판정이 불가하며 — **baseline-green 독립 서브셋의 failure delta**로만 판정한다(실증: release-gate craft-state.test.ts의 배너 위 green baseline/아래 RED 확장군 분리) [S14]. oracle-mirroring 함정도 실증됐다(FakeSessionApi가 production splitEffort 재사용 → SUT/오라클 동시 변이 통과) [S14]. 방법론 자체는 4축(뮤테이션 도구 어휘·Beck Broken Test/Fake It·Altmann 격리 권고·LLM 테스트 문헌)이 지지하고, 격리 worktree가 이미 안전 권고를 구조적으로 충족한다 [S15]. 단 countersearch가 원 프레이밍을 강하게 약화시켰다: **n=1은 스위트 변별력의 '유의미한 검증'이 아니다**(n=25-50에서도 50%p 분산) — 계약 문구는 '변이 seam 한정 tautology 스모크 감지'로 격하해야 한다 [S8]. 계약 예외의 올바른 형태: '구현 작성 허용'이 아니라 '소스 bytes의 일회성 임시 변이 + 즉시 원자 복구(git diff 청결 확인)' [S14].

## 8. E-1 + R0, D-4, 기타

E-1 원천(scaffold-plan.mjs)의 이식 코어는 결정적 헤더·sentinel no-op·--reset/--force 2단·심링크/realpath 이중 containment이며, loose sentinel과 비원자 2파일 쓰기는 이식 시 교정 여지다 [S2]. 검증자 핵심 뉘앙스대로 최대 가치는 markdown 헤더가 아니라 **스킬이 산문으로 재구현 중인 addWorktree/ensureWorktreesGitignored 배선의 도구 승격**이다(bash와 TS의 텍스트 발산 실측) [S16]. **R0는 lazycodex에 원형이 없다** — 실존은 full-string toBe 테스트와 sync 변환 마커뿐이므로, 도입한다면 마커 구간 추출기+바이트 비교기+non-zero CLI를 신규 설계해야 한다 [S2]. D-4 원천에는 reference-insights가 누락한 두 규칙(explicit interview override, ON THE FENCE 1질문)이 있다 [S2]. omp SDK 표면은 신규 도구/커맨드에 충분하다: registerTool(approval tier), registerCommand(슬래시 없는 이름), pi.exec, `session.compacting`(dot) 채널 비대칭 [S17].

## 9. 파이프라인 함의 (trace.md로 승격)

- 15항목은 즉시 코드화 6(T-1+A-5 통합, E-1, F-3, E-3-좁힘, T-2, D-2-리서치한정) + 조건부 7(D-1, D-3, D-4, A-4p2, E-2확장, C-2p2, B-2확장)로 분할된다 [S18].
- D-1의 선행 조건(fixture E2E green 기준선)은 현재 미충족 — green 기록의 부재가 5개 독립 정황으로 수렴 [S13].
- 다중 도구 단일 feature의 선례는 release-gate(A-1+A-2+A-3, 서브컴포넌트 토폴로지, 단일 test canon, AC 7항)가 실증한다.

## Sources
- [S1] agent://LanePremiseAudit — 전제 감사 10/10 (repo 직접 read)
- [S2] agent://ResLazycodex — lazycodex 원문 검증 + 테스트 실행 프로브
- [S3] agent://ResOmcGajae — OMC/gajae 원문 검증 (worktree-cleanup-safety.ts, ledger.ts, deep-interview-ambiguity.ts, mutation-guard.ts, doctor-conflicts.ts)
- [S4] agent://LaneCodeSeam — 코드 seam 좌표 전수
- [S5] agent://LaneSkillProse — 스킬 산문 계약 지도 + ralplan Phase 5 연결
- [S6] agent://ResGitWorktree — git-scm man pages + git/git builtin/worktree.c·worktree.c 소스 (git 2.43.1-2.55.0)
- [S7] agent://ResDoctorArt — Homebrew/flutter/npm/expo 소스 직접 판독 (URL 인용 포함)
- [S8] agent://W2Countersearch — C1/C2/C3 반증 패스 (clippy·swift-format·cfn-lint / offlinetools·SQLite pragma·quesma / QCRMut·TOSEM Offutt 1996·Learning-from-Mutants)
- [S9] agent://W2DoctorSeams — F-3 재사용 표면 실측 (BUILD_INFO 프로브 포함)
- [S10] agent://ResSchemaVer — npm lockfileVersion/Terraform state/Cargo.lock/ESLint (공식 문서·소스)
- [S11] agent://W3ClaimClosure — CraftState/HashManifest 수명·reader 토폴로지 (92/92 targeted tests)
- [S12] agent://ResLlmFloor — Kumaran 2026 Nature MI(arXiv:2507.03120), Xu 2024 ACL(2402.11436), Huang ICLR 2024(2310.01798), Tian EMNLP 2023(2305.14975), DSPy(2312.13382), KnowU-Bench(2604.08455) 외 / [S12'] agent://ResClaimLedger — Lakens·PNAS(1708274114)·FEVER(1803.05255)·CALM CACM·Event Sourcing AWS·ClaimReview
- [S13] agent://LaneTestInfra — E2E 기준선 부재 정황 5종
- [S14] agent://W2MutationTarget — D-3 실행 형태 확정 (release/model 실사례 + git 이력)
- [S15] agent://ResMutation — Stryker/PIT/mutmut·Beck·Altmann·FixReverter·CANDOR/TOGLL (URL 인용 포함)
- [S16] agent://LaneSkillProse — bash vs TS 텍스트 발산 실측 (pre-craft SKILL.md:84-96 vs worktree.ts:61-76/gitignore.ts:23-42)
- [S17] agent://ResOmpSdk — @oh-my-pi/pi-coding-agent 16.4.0 dist/types 직접 판독
- [S18] agent://LaneInteraction — 항목 간 상호작용·분할·순서
