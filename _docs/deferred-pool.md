# Deferred Pool — 레퍼런스 인사이트 후속 작업

> 출처: `_docs/reference-insights.md`(확정 22건)의 적용 로드맵 중 **이번 사이클(2026-07-16~18)에서 제외로 확정한 항목**과, 그 사이클의 코드리뷰가 남긴 추적 항목. deep-interview Round 0에서 사용자가 `deferred-pool`로 명시 연기한 묶음이다. 각 항목의 원천 인사이트·검증자 노트 전문은 `reference-insights.md`를 참조.
>
> **이번 사이클 착지분(참고, 여기서 다루지 않음)**: A-1/A-2/A-3(nonce·open-release·init검사) → release-gate + QW2, B-1(verdict·freshness), B-3(적대 클래스 매트릭스), C-1(no-progress), C-2 파트1(재주입 템플릿), C-3(컴팩션 훅), E-2 최소형(원자적 쓰기), E-4(버전 각인), F-1(statusbar), F-2(프리셋 출처).

---

## 0. 리뷰 추적 항목 (이번 사이클 직접 후속 — 최우선)

### T-1. merge-차단 코드 seam → **lsc_land 도구** (다음 dogfooding 대상)
- **상태**: B-1에서 프로즈 계약(post-craft SKILL.md §7.1) + `auditValidated: {cycle, verdict, at}` 영속 마커(state.ts:315 `recordAuditValidated`)까지 구축. **코드 강제는 미구현 — 차기 feature로 이연**(§7.1 scope note에 명문화).
- **근거**: 설계 계약(reference-insights.md B-1)이 "스킬 자발 호출은 약하므로 '검증된 판정 없으면 git merge 차단'으로 배선해야 실제 백스톱"이라 명시. 현재는 그 "약한" 프로즈 형태.
- **적용안**: `lsc_land` 도구 신설 — merge+worktree 정리를 도구화하면서 `auditValidated`가 현재 audit 사이클·APPROVE 계열을 가리킬 때만 실행(fail-closed). 아래 A-5와 한 feature로 통합 권장.
- **현재 land 위치**: post-craft SKILL.md §7.4가 `git merge --no-ff` + `removeWorktree()`/`pruneWorktrees()`(src/artifacts/worktree.ts)를 **bash로 손수 재현** 중.

### T-2. root 해석 이원화 통일 (LOW 하드닝)
- run-tests의 `findPersistedCraftState` vs verdict 도구의 `resolveAuditRoot` — 정상 all-in-worktree 흐름에서는 동일 root로 수렴함이 증명됐고 불일치 시 fail-closed라 안전하나, 단일 root-해석 헬퍼로 통일하면 혼합/레거시 엣지의 잠재 불일치가 구조적으로 제거됨. 급하지 않음.

---

## 1. 즉시 착수 가능 (선행 조건 없음)

### A-5. land 단계 worktree 제거 전 경로 불변식 검증 도구화 (P4)
- **근거**: `oh-my-claudecode/src/lib/worktree-cleanup-safety.ts`
- **메커니즘**: 재귀 삭제 전 NUL 바이트·`.`/`..`/`~`·심링크·파일시스템 루트/홈 거부, 소유 루트 내부 확인(relative), realpath 해석, "`.git`이 디렉터리면 메인 리포" 판별로 삭제 거부.
- **적용안**: `src/artifacts/worktree.ts` 옆 `validateWorktreeRemovalTarget` 순수 함수. **T-1(lsc_land)의 force-remove 경로 안전장치로 통합** — post-craft §7.4가 손수 하던 bash 제거를 도구가 대신하면서 이 검증을 강제.
- **검증자 유보**: `git worktree remove` 자체가 미등록/메인 트리를 이미 거부하므로 ".git 디렉터리" 판별은 상당 부분 중복 — 순가치는 (a) fail-open 래퍼 `removeWorktree()`가 잘못된 feature 인자를 못 거르는 것을 코드로 막고 (b) 스킬의 수동 bash 복제를 도구로 승격.

### E-1. pre-craft 산출물 스캐폴드의 결정적 TS 도구화 → `lsc_scaffold` (P5)
- **근거**: `lazycodex/plugins/omo/skills/ulw-plan/scripts/scaffold-plan.mjs`
- **메커니즘**: 계획 파일을 모델이 직접 못 쓰게 하고 스크립트가 정본 헤더를 결정적 생성, 모델은 마킹 영역에만 append. 재실행 no-op(컴팩션 후 재개 안전), 쓰기 경계(심링크 거부) 자가 강제.
- **적용안**: `lsc_scaffold` 도구(paths.ts 재사용). 미해결 과제 "스킬이 paths.ts를 수동 복제(드리프트 위험)" 해소.
- **검증자 핵심 뉘앙스**: 가장 설득력 있는 대상은 markdown 헤더가 아니라 **스킬이 `addWorktree()`/`ensureWorktreesGitignored()` 로직을 산문으로 재구현하는 배선 부분** — 이미 존재하는 TS 함수를 도구가 재사용하면 드리프트를 코드로 봉쇄. phase-scoped로, no-op을 resume 경로와 정합.

### F-3. `/lsc-doctor` 건강검진 커맨드 (P3)
- **근거**: `lazycodex/plugins/omo/skills/lcx-doctor/SKILL.md`
- **메커니즘**: 진단 전 최신 정본 물질화("기억 속 레이아웃 비교 금지"), 모든 검사를 실제 출력/파일 인용이 붙은 PASS/WARN/FAIL 표로, 경고성 통과는 WARN, 진단 중 무변경(수정은 제안만).
- **적용안**: `/lsc-doctor` 커맨드(순수 로직 `src/doctor.ts`) — dist/매니페스트 정합, plugin link 상태, agents 8종 frontmatter 파싱, models.yaml 검증(기존 preset/validate 재사용), 고아 worktree(`git worktree list` 대조), stale craft-state, .gitignore 등록. resume+항상-worktree 설계가 만드는 stale·고아 표면에 진단 가치.

### E-3. durable 파일 스키마 버전 필드 + 마이그레이션 (P3)
- **근거**: `lazycodex/plugins/omo/scripts/migrate-codex-config.mjs`
- **적용안**: CraftState·HashManifest·ModelsFile 세 durable 파일에 version 필드가 없음(fixtures.ts만 version:2). README가 경고하는 models.yaml 구버전 비호환 + resume이 만드는 "업그레이드-중-craft" 빈틈.
- **검증자 경고**: 지문 카탈로그+3-way merge 전체는 과설계 — **"세 파일 version 필드 + 로드 시 마이그레이션 또는 명시적 에러(침묵 오독 금지)" 경량 코어로 한정**.

---

## 2. 선행 조건·주의 있음

### D-1. 인터뷰 모호도 게이트 결정론적 하한 클램프 (P5, 축소형)
- **근거**: `gajae-code/packages/coding-agent/src/gjc-runtime/deep-interview-ambiguity.ts`
- **메커니즘**: LLM 자기채점은 이전 점수에 앵커링돼 상승 과소보고 → 객관 신호만으로 하한 독립 계산해 `effective = max(reported, floor)` 클램프.
- **적용안**: pre-craft Stage 2의 모호도<5% 게이트가 현재 4차원 전부 LLM 자기채점 단독. `interview-state.json` 영속 + `computeAmbiguityFloor()` 순수 함수로 매 라운드 클램프, spec.md에 reported/effective 병기.
- **선행 조건·경고**: floor가 0.05 게이트 위에 고착돼 hard cap을 매번 치는 튜닝 리스크 → **진짜 객관 신호(open-questions 미해결 수·자동응답 라운드 비율·disputed fact 수)에만 하한, 가중치는 fixture E2E로 캘리브레이션**하는 축소형만. → **fixture E2E 기준선에 의존**.

### D-2. 클레임별 dropCondition·반증 쿼리 + 결정적 verifier 기각 기본값 (P4)
- **근거**: `gajae-code/packages/coding-agent/src/research-plan/ledger.ts`
- **적용안**: **pre-craft 리서치의 claim-graph 잠금이 최저위험·고가치** — claim별 dropCondition 필수 + 기계검증 claims.json 병행 + 순수 TS 평가기로 죽은 주장 부활 차단.
- **경고**: (1) 평가기 입력이 LLM 분류라 적대적 오라벨엔 우회 — 효과는 비적대 케이스 한정. (2) claims.json은 드리프트 위험 파일 +1. (3) **post-craft AC 자동차단 확장은 홀리스틱 4값 판정을 무디게 덮어쓸 위험** → 리서치부터 좁게.

### D-3. pre-craft 테스트 뮤테이션 프루프 (P4)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/directive.md`
- **적용안**: pre-craft Stage 4가 현재 "미구현이라 실패(RED)"만 확인 — 스텁에 임시 오답 주입해 테스트가 그것도 잡는지 확인 후 revert. 함께 "무응답 스폰은 합의 통과로 비집계"(QW4에서 pre-craft에 이미 반영됨).
- **선행 조건**: 뮤테이션 프루프는 **불변식 2(pre-craft 구현 코드 절대 금지·감지 시 revert)와 정면충돌** → "즉시 되돌리는 일회성 프루프" 명시 예외를 계약에 새겨야 채택 가능. 완전 그린필드는 뮤테이트할 스텁이 없음.

### D-4. interview 라우팅 판정 공개 + 2단 질문 필터 (P3, 증분 제한)
- **근거**: `lazycodex/plugins/omo/skills/ulw-plan/SKILL.md`
- **검증자 판정**: WHY 첨부는 이미 존재(순증분 없음). "증거로 답 가능하면 재탐색" 필터는 **Override 2(인터뷰 중 재탐색 금지)와 정면 긴장** → 특정 질문 한정 스코프드 재탐색으로 좁혀야. **owner-decision 필터 면제 프레이밍만 미코드화 실질 증분**.

### A-4 파트2. bash 변이 가드를 pre-craft 구현금지 백스톱으로 재사용 (P2)
- **근거**: `gajae-code/.../deep-interview-mutation-guard.ts`
- **주의**: 코어 제안(substring→분류기 승격)은 **기각**(substring은 의도된 1차 방어선, 권위는 lsc_verify_hash). 잔여 가치는 같은 분류기를 pre-craft 구현금지 tool_call 백스톱으로 재사용하는 것뿐 — 단 **테스트 선작성·산출물 쓰기와 구분 모호해 과차단 위험 큼**. 신중 검토.

### E-2 확장. 변이 영수증·소유권 봉투·append-only 원장 (조건부)
- **근거**: `lazycodex/.../plan-io.ts`, `oh-my-claudecode/src/lib/atomic-write.ts`
- **상태**: 최소형(tmp+rename)은 QW1로 착지. 확장(revision·sessionId 영수증, ledger.jsonl)은 활성 craft가 메인 세션 싱글턴이고 resume이 재init로 매니페스트 재계산하는 설계라 **동시-세션 충돌 빈도 검증 필요** → dogfooding 후 증분 판단.

### C-2 파트2. session_stop stop 분류기 (축소)
- **상태**: 파트1(재주입 템플릿)은 QW3로 착지. **`SessionStopEvent`에 stop 사유 필드가 없음이 확인됨** → 원안 분류기 불가, transcript 마커 매칭 순수함수 + continue 카운터 차선책만. continuation cap은 이미 플랫폼 소유라 증분 약함.

### B-2 확장. 감사 APPROVE 시점 고정 sha256 영수증 (후순위)
- **상태**: 축소형(스킬 계약 "§6.2 정본 수정 시 판정 무효")은 QW4로 착지. 전용 TS 도구+sha256 영수증은 **크로스-세션 재진입/재land에 한해서만 증분** — B-1의 cycle-freshness와 결합해 후순위.

---

## 3. 기각됐지만 재검토 가치 (rejected 중)

### R0. SKILL.md ↔ paths.ts 경량 드리프트 게이트
- 원안(SKILL.md 빌드타임 생성 full 하네스)은 근거 불충분으로 기각(OMC의 INCLUDE 템플릿이 주석에만 존재)이었으나, **"paths.ts 헬퍼 출력과 SKILL.md 리터럴을 대조하는 경량 `--check` 드리프트 게이트"**는 검토 가치 — E-1(lsc_scaffold)과 상보적. paths.ts 드리프트가 실존 과제.

---

## 추천 착수 순서
1. **lsc_land (T-1 + A-5)** — 이번 사이클의 자연스러운 완결(merge-차단 seam + worktree 제거 안전), post-craft §7.4 손수 bash 제거. **← 다음 dogfooding 대상 확정**
2. **F-3 /lsc-doctor** — dogfooding 운영 표면(stale·고아 worktree) 진단
3. **E-1 lsc_scaffold** — paths.ts 드리프트 해소(worktree/gitignore 배선 재사용 중심), R0와 묶음
4. 이후 D-2(리서치부터 좁게) → E-3(경량 코어) → D-1(E2E 캘리브레이션 선행) → 나머지
