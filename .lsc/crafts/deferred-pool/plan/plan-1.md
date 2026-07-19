# Plan Ledger — iteration 1 (deferred-pool)

> 합의 루프 iteration 1의 review-response 원장. 리뷰 원문: architect(lsc-architect, classification **blocking-redesign**) / critic(lsc-critic, verdict **REVISE**, ADVERSARIAL 격상 — CRITICAL 5·MAJOR 5·Minor 4). critic crosscheck: architect BLOCKING 전원 동의(독립 검증) + 신규 MAJOR 1건(merge-conflict 롤백) 추가, 반박 0건.

## 1. 판정 요약

| 리뷰어 | 판정 | 핵심 사유 |
|---|---|---|
| architect | blocking-redesign | (1) fresh-session post-craft에서 [Land] 발급 불가 (2) 승인-실제 operation 미결박 (3) auditValidated 권위 승격 무보강 (4) E 통일이 open-release fail-closed 회귀 파괴 (5) doctor real exit 계약 SDK 표면상 실현 불가 |
| critic | REVISE | blocking 5건 중 4건 needs-redesign — APPROVE-WITH-CHANGE 불가. 골격(D1·D4 이식·Step 순서·B/G)은 건전해 REJECT 아님 |

## 2. 제기된 것 → 저자 대응 (전수)

### CRITICAL/BLOCKING 5건 — 전부 재결정

| # | 지적 (근거 seam) | 대응 | 반영 위치 |
|---|---|---|---|
| C1 | fresh-session 발급 부재: ask.ts:631-655 발급 가드가 active craft 전제인데 plan D2 스스로 "post-craft엔 active 없음" 전제 — 소비만 설계, 발급 없음. AC2의 직접 API 시뮬레이션이 결함 은폐 | **발급 seam 신설**: destructive-approval에 tag-key prepared-operation 슬롯(opaque JSON), lsc_land 2-phase(preflight→approval-required+요약), ask.ts 태그-일반 분기(craft-bound 경로 무변경), recordReleaseApprovalAt 신설로 persist-before-install 보존. AC2를 실 등록 lsc_confirm execute 캡처(captureConfirmExecute 관례)로 교체 | plan ADR D3·Step 3a, appendix-adr-branches D3, test-plan W2-a |
| C2 | 승인-operation 미결박: identity 3필드뿐(destructive-approval.ts:88-90) — source/target/mode 부재, "엉뚱한 브랜치 merge"를 ADR이 자인, force 재승인 구분 불가 | **LandOperation scope 결박**: {sourceBranch/OID, targetBranch/OID, mode: merge-and-clean\|force-clean-only} canonical JSON 동등 비교 + consume 직전 재관찰 일치(drift=재승인) + identity는 ctx.cwd 앵커 재구성(persisted 3필드는 대조 evidence로 강등) | plan ADR D2·Step 3b Phase C, appendix-security-land T7/T10 |
| C3 | auditValidated 권위 승격: marker는 best-effort trace(verdict.ts:349-360)이고 3필드 유지 편집으로 위조 가능 — T7 주장 거짓. 역방향: 기록 실패 시 land 영구 거부 | **marker 권위 강등**: land가 read-only 코어(performAuditValidate에서 추출)로 최신 audit-N.md verdict·auditCycle·fresh passing run-N.log를 land-시점 재검증. marker는 일치 evidence(불일치=tamper isError, 부재=WARN — 영구 봉쇄 해소). producer docstring "비권위 trace" 갱신 | plan ADR D4·Step 3b Phase R③, appendix-security-land T11 |
| C4 | E 오독·회귀 파괴: 채택안("존재 분기+worktree 우선")은 양 호출점 어느 의미론도 아닌 제3 정책 — resolveAuditRoot는 **디렉터리** 존재 분기, findPersistedCraftState는 **open-release 중재**(첫 파싱 성공 아님). worktree-first는 open release를 가려 canon 게이트 재개방(:481-533 회귀 충돌 — 커밋 1a부터 green 불성립) | **'단일 선택 의미론' 포기**: 공유는 decodeCraftState+craftStateCandidates뿐, 선택 정책 2종 named 보존(기존 회귀 무수정 green). appendix 사실 오독 명시 교정. spec E/AC10 문구 동시 교정 | plan ADR D5·Step 1b, appendix-adr-branches D5(사실 교정 절), spec E·AC10 |
| C5 | doctor exit 실현 불가: registerCommand handler는 Promise<void>(SDK types.d.ts:633) — real process exit 배선 전무, AC7 관측 seam 없음 | **2-adapter 재설계**: shared runner(DoctorReport{findings, 논리 exitCode}) + 슬래시 커맨드(UI 뷰·exitCode 표기) + lsc_doctor 도구(FAIL≥1→isError, 게이트 소비). spec AC7을 논리 exit+도구 isError로 교정(독립 CLI 비목표 유지 — 사용자 정책 불변) | plan ADR D6·Step 6, appendix-adr-branches D6, spec C·AC7 |

### MAJOR 5건 — 전부 처리

| # | 지적 | 대응 | 반영 위치 |
|---|---|---|---|
| M1 | CraftState reader 우회: loadActiveCraft(state.ts:189-192)가 별도 JSON.parse — 신버전 침묵 active 승격 | decodeCraftState를 reader 2종 공용, AC9에 reader별 케이스 | plan Step 1a, spec D·AC9, test-plan W1-b |
| M2 | 'pure' 명명 오류 + 등록 preflight 부재: lstat/realpath는 effect, removeWorktree missing no-op인데 membership 확인 없음 — AC3 "미등록 불가" 검증 불성립 | inspect(관찰)/evaluate(순수 평가) 분리 명명 교정 + `git worktree list --porcelain` membership을 merge 전 1회+삭제 직전 재검사, missing no-op 함정 주석·not-registered 별도 isError, TOCTOU 잔여 위험 선언 | plan Step 2·3b Phase R④/X, appendix-security-land T13/T14, spec A(removal 검증) |
| M3 | scaffold 3제약 동시 불성립: "worktree 내부 한정" vs projectRoot/.gitignore 쓰기(비원자 writeFileSync) vs atomic; branch-prefix 보존 방안 부재 | 쓰기 capability 정확히 2종 선언(worktree 내부 + 정확히 projectRoot/.gitignore), atomic writer 소유자=gitignore.ts(ensureGitignored를 writeFileAtomicSync로), branch 인자(addWorktree options.branch 기존 인자) — prefix 탐지는 산문 유지+인자 전달 | plan Step 4, spec B·AC5 |
| M4 | F consumer 부재 + 단조성 모순: runtime callsite 0, stateless evaluateClaim으로 부활 금지 판정 불가 | transition-aware evaluateLedger(claims, previousDecisions) + tombstone 단조 + **lsc_claims 도구 등록** 채택(library-only 기각 — ADR D7에 근거) | plan ADR D7·Step 5a, appendix-adr-branches D7, spec F·AC11 |
| M5 | [critic 신규] merge-conflict 롤백 미명세: consume이 merge 선행 — conflict 시 nonce 소진+conflicted 방치 | 자동 `git merge --abort` + isError 3요소 보고(원복·nonce 소비·재승인) + 순수 preflight 전부 통과 후 소비(게이트 순서 재설계) + partial-land 상태 기계(merged-but-not-cleaned) | plan Step 3b Phase X, appendix-pre-mortem P7/P8, spec AC3 |

### Minor 4건 — 전부 처리

1. 탈출구 기록 durable 위치 미지정 → `.lsc/crafts/{feature}/audit/land-manual-escape.md` 지정(스킬 산문 + skill-contract 고정).
2. claims.json 경로 헬퍼 실재 미확인 → paths.ts에 craftClaimsPath **신설**로 확정(기존 헬퍼 부재 확인).
3. AC5 mtime 단언 취약 → 내용 대조로 교체(test-plan W2-b).
4. DoctorPorts `now`만으론 hang timeout 불가 → D6 재설계에 흡수(AbortSignal+주입 setTimeout, never-resolving hang 테스트).

### open-questions 3건 판정

1. 브랜치 규칙 잠정안 **거부** → D2 결박 채택. 2. E worktree-first 잠정안 **거부** → D5 정책 분리. 3. "executor 재량" **삭제** → land 단일 경로. (open-questions.md에 처분 기록, 신규 잠정 2건 추가 — write-back 형식·prepared 슬롯 수명.)

### 채택하되 유지한 것 (리뷰 양측 인정 골격)

D1 모듈 배치(release.ts 0 변경·소비자 태그 소유), dirty/locked/submodule git 위임 + `--force` 1회, override 금지·수동 탈출구, D4→D7의 gajae 판정 코어 이식 범위, Step 순서(D→E→A로 정밀화·doctor 마지막), B·G 설계 골격, skill-contract 검증 계층.

### 부분 반박/선택 근거 (무시 아님)

- **marker 부재를 거부가 아닌 WARN으로**: architect가 제시한 두 방향(producer hard-error vs land 재검증) 중 후자 채택 — marker는 여전히 untrusted 파일이라 hard-error화해도 읽기 신뢰 문제가 남고, verdict.ts:352-353의 "기록 실패가 검증 성공을 가리면 안 된다" 계약과 충돌하기 때문(appendix-adr-branches D4 Option B 무효화). spec AC1의 "auditValidated 부재" 변형은 "audit 증거 부재/marker 불일치" 변형으로 교정 — fail-closed 강도는 live 재검증으로 오히려 강화됨.
- **F는 library-only 축소가 아닌 도구 등록**: 양 리뷰가 택1을 허용 — dead library는 "결정론적 하한"의 존재 이유를 소멸시키므로 도구 채택(D7).

## 3. spec.md 기술 교정 목록 (iteration 2에서 적용)

사용자 정책 결정(범위 6종+G, FAIL/WARN 구분, fail-closed+수동 탈출구, R0 독립 CLI 비목표)은 전부 불변. 교정은 리뷰가 확인한 기술 사실(SDK 계약·기존 코드 의미론)에 대한 것:

1. Topology A/C/F 행 — 소유 파일에 발급 seam(destructive-approval·ask.ts·state.ts·verdict.ts)·도구 어댑터·paths.ts 추가.
2. 컴포넌트 A — LandOperation 결박·2-phase·audit land-시점 재검증·conflict abort·merged-but-not-cleaned 경로로 재기술.
3. 컴포넌트 A(removal 검증) — "순수 함수"를 inspect/evaluate 분리로 교정 + membership 확인 명시.
4. 컴포넌트 B — capability 2종·atomic화·branch 인자 명시.
5. 컴포넌트 C — 어댑터 2·논리 exit로 교정.
6. 컴포넌트 D — decoder·reader 2종 명시.
7. 컴포넌트 E — "단일 root-해석 헬퍼 통일" → "공유 seam + 소비자별 named policy 보존".
8. 컴포넌트 F — transition-aware·tombstone·lsc_claims 도구 추가.
9. 제약 2 — marker 단독 권위 문구를 scope 결박+live 재검증으로 교체.
10. 제약 3 — 탈출구 durable 기록 위치 추가.
11. 제약 8 — "통일" → "공유+정책 보존".
12. 제약 9 — registrar 캡처 검증·AbortSignal timeout 추가.
13. AC1 — 거부 변형 목록 교정(증거 부재/tamper/앵커 불일치).
14. AC2 — 실 등록 execute 캡처 + replay/wrong-target 부속.
15. AC3 — conflict abort + mode scope 결박 추가.
16. AC5 — 내용 대조·capability 2종·branch 인자.
17. AC7 — 논리 exitCode + 도구 isError.
18. AC8 — hung 검사 UNKNOWN(timeout) 추가.
19. AC9 — reader 2종 각각.
20. AC10 — named policy 보존 + both-root open-release 엣지.
21. AC11 — tombstone transition + registrar 캡처.
22. Technical Context — 재사용 seam·함정 목록을 iteration 1 리뷰 실측으로 갱신.

(Interview Transcript·Ontology·Clarity 표는 역사 기록이므로 무수정.)

## 4. 산출물 변경 (iteration 2)

- `plan.md` — 코어 전 섹션 in-place 개정(ADR 4→7결정, 커밋 8→9, AC 매트릭스 production seam 재작성).
- `plan/appendix-adr-branches.md` — 결정 번호 체계 재편(D1-D7)에 따른 구조적 재작성(사실 교정 절 포함).
- `plan/appendix-security-land.md` — 신뢰 경계 갱신 + T9-T15 신설 + 탈출구 durable 기록 + TOCTOU/audit 위조 비-방어 선언.
- `plan/appendix-pre-mortem.md` — P1 오진 교정 + P7(conflict)/P8(partial land)/P9(TOCTOU) 신설 + 잔여 위험 2건 추가.
- `plan/appendix-test-plan.md` — production seam 중심 재작성(W2-a 발급 캡처, W2-d registrar 일괄, hang 테스트, reader 2종, 내용 대조).
- `spec.md` — 위 §3 교정 22건.
- `open-questions.md` — 3건 종결 처분 + 신규 잠정 2건.
