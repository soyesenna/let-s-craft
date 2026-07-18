# Observation Manifest — deferred-pool

> 워커 귀속 원시 발견. 전문은 각 워커 아티팩트(agent://) 참조.

## Wave 1 (saturation, 2026-07-19)

### ResOmpSdk (lsc-explore) — omp SDK 표면
- SDK = `@oh-my-pi/pi-coding-agent` 16.4.0. ToolDefinition: extensions/types.d.ts:321-353 — name/label/description/parameters 필수, approval(read/write/exec, 생략 시 exec), execute(toolCallId, params, signal, onUpdate, ctx)→Promise<AgentToolResult>.
- registerCommand(name, {description?, handler}) :690-694 — 이름에 슬래시 없음. handler ctx는 ExtensionCommandContext(:273-296).
- `pi.exec`은 ExtensionAPI 메서드(:731-732), ctx에는 exec 없음. ExecOptions: signal/timeout/cwd.
- SessionStopEvent(shared-events.d.ts:83-91): stop 사유 필드 **부재** — 이웃 SessionSwitchEvent는 reason 보유 → 구조적 부재. runner.d.ts:48-49,85로 교차 확인.
- 컴팩션 채널 비대칭: `session_before_compact` result는 cancel/compaction만(customInstructions는 **수신 전용**); `session.compacting`(dot literal!) result만 context/prompt/preserveData; `session_compact` 반환 없음. 기존 compact-directive.ts:61이 dot 키 정확 사용.
- 상태 영속: ExtensionAPI.appendEntry(:729-730, "not sent to LLM"); sessionManager는 ReadonlySessionManager(읽기+아티팩트).
- AgentToolResult(pi-agent-core types.d.ts:479-486): content 필수, isError/details 선택.

### ResLazycodex (lsc-explore) — 레퍼런스 원문 검증
- F-3(lcx-doctor): 진단 전 정본 물질화 + PASS/WARN/FAIL 표 + 증거 인용 확인. **무변경 규율은 '사용자 표면 무변경'으로 좁혀야 정확**(소스 캐시 쓰기는 허용). "경고성 통과 WARN 강등"은 runtime probe에 한정 명시.
- E-1(scaffold-plan.mjs): 결정적 헤더 8종, sentinel 기반 no-op(:142-147), --reset/--force 2단 게이트(:258-273), 심링크/realpath 이중 containment(:88-140). **loose sentinel(문자열 포함 검사)·비원자 2파일 쓰기**는 원문 한계 — 이식 시 교정 여지.
- E-3(migrate-codex-config): 실체는 **Codex 모델 프로필 마이그레이션**이지 durable 파일 스키마 버전이 아님. 분기 5개(empty/current/prev-managed/known-legacy/user-modified). version은 파일이 아닌 별도 state의 catalogVersion. → E-3 이식은 {schemaVersion,...payload} 봉투 + 미지 버전 명시 에러의 신규 설계.
- D-3(directive.md:246-257): mutation proof는 **TEST-ONLY regression coverage에만** 허용된 유일 RED 대체. never-committed. prose는 machine consumer 없으면 grep 테스트 금지(:258-265). 무응답 비승인(:324-355)은 별개 seam.
- D-4(ulw-plan SKILL.md): 2단 필터 + owner-decision 면제 + **explicit interview override + ON THE FENCE 1질문 규칙**(reference-insights가 누락).
- R0: **lazycodex에 marker-byte --check 게이트 부재 확정**(전수 검색). 실존은 full-string toBe 테스트 + sync 변환 마커뿐. R0 도입 시 신규 설계 필요.
- 검증 프로브: scaffold 테스트 9/9, migration 54/54, directive mirror 7/7 pass, cmp exit 0.

### ResOmcGajae (lsc-explore) — OMC/gajae 원문 검증
- A-5(worktree-cleanup-safety.ts:1-118): 거부 목록 전수 확인 — NUL/trim-빈값/`.`,`..`,`~` 정확 일치/심링크(lstat)/root·home(assertSafeBoundary, expectedRoots에도 적용)/relative() containment(root 자신도 거부)/mainRepoRoots 정확 일치/`.git` 디렉터리 판별(.git 파일은 허용). 반환 {resolvedPath, matchedRoot}. teleport.ts:691-756에서 삭제 직전 2회 호출 배선 — 실전 배선 선례.
- E-2 확장: OMC atomic-write.ts에는 영수증/봉투/원장 **없음**(atomic tmp+rename+fsync만). reference-insights의 합성 서술 주의.
- F-3 보조: doctor-conflicts.ts 실경로는 src/cli/commands/. **WARN과 hasConflicts 분리**(informational은 exit 1 미유발) — severity 모델 선례. read-only chain, --json 지원.
- D-1(deep-interview-ambiguity.ts:1-206): 가중치 0.10/0.05/0.05 정확. disputed 처리는 recorder.ts:501-528에서 답변 교체 시 **기계적**(LLM 불개입). 해소 조건은 superseded_by뿐(re-confirmation 규칙 없음 — 문서와 차이). clamp는 [0,1] bound 후 max. historical round 불변.
- D-2(ledger.ts:1-177): dropCondition 필수 코드화(:74-87), contradiction-only hard reject(:145-157, 주석이 환각 생존 경로 차단 명시). **counterexampleQueries는 validation-only — 평가기 미실행**. no-evidence는 reject 아닌 uncertain.
- A-4p2(mutation-guard.ts:1-644): 실체는 planning guard(3스킬 한정, fail-open on invalid state, neutral temp 예외, .gjc allowlist). 명령 목록에 touch/mkdir/cp/install/truncate 추가. 원문 그대로 이식하면 pre-craft 의미론과 다름.

### ResGitWorktree (lsc-librarian) — git 원생 의미론
- remove 거부 R1~R5 전수(builtin/worktree.c 소스 확정): R1 미등록(realpath 매치)/R2 메인/R3 locked(-f -f만 우회)/R4 gitdir 라운드트립/R5 dirty+submodule(-f 1회 우회). R1/R2/R4는 --force 불가침.
- **A-5 순증분 확정**: ①feature 인자 sanity(빈/NUL/./../~/구분자 주입) ②expectedRoots containment(realpath 충돌 공격은 git이 못 막음 — isInside가 유일 방어) ③심링크 거부 ④root/home fail-fast. **중복(넣지 말 것)**: dirty/locked/submodule 재구현(git --force 의미론 존중), .git 디렉터리 판별은 fail-fast 명확성만(주석 명시 권고).
- prune: locked면 무조건 보존; --expire 유일 의미 지점 = gitdir 깨진 entry의 index mtime. rm -rf 잔류는 remove가 아닌 **prune**으로만 정리(R1이 막음).
- list --porcelain: 버전 무관 안정 계약. prunable <reason> 문자열로 F-3 세분 진단 가능.

### ResDoctorArt (lsc-librarian) — doctor 선행 기술
- exit code: brew/npm/expo = 이슈 시 non-zero, **flutter만 항상 0**(의도적 — doctor는 게이트 아님 철학). F-3은 게이트 사용 가능성 때문에 non-zero 권고.
- 격리: expo Promise.all+per-job try/catch 뼈대 + flutter per-check timeout(4:30) + crash 전용 결과 타입. npm은 직렬(비권장).
- 출력: flutter 4단 시각([✓][!][✗][☠]) + 요약 라인, brew 'this is not an error' 서문, brew Finding{text,tier,affects,links,remediation.commands} 구조화+--json.
- read-only 예외 선례: npm verifyCachedFiles(안전·멱등 복구는 doctor가 직접) — F-3은 opt-in 플래그 뒤로 권고.
- npm groups 멀티 태그 + 인자 필터, flutter applies-게이트(비활성 검사 리스트 제외), yarn doctor는 부재(비교 대상 제외).

### ResSchemaVer (lsc-librarian) — 스키마 버전 관례
- 관례 지도: npm lockfileVersion(부재=관용, 미지=best-effort — 재생성 가능 파일 특권) / Terraform version(필수, 미지=hard error) / Cargo(부재=V1 관용, 미지=first-class error, 4단계 롤아웃 정본) / ESLint(파일명=버전).
- **E-3 도전 결론**: CraftState(수명=단일 사이클, 단일 writer, optional-관용 docstring 관례 확립)·HashManifest(매 init 전체 재계산 — 파일 자체가 버전)는 version 필드 **불필요**; ModelsFile만 조건부 후보(hand-edited·긴 수명)이나 현행 content-shape 판별이 아직 모호성 없음 → 도입 연기 권고. '침묵 오독 금지'는 현행 설계가 이미 충족.
- 결정 규칙: 재생성 가능→관용 허용 / 단독 진리원→hard error. lets-craft 3파일 모두 후자.

### ResMutation (lsc-librarian) — 뮤테이션 프루프
- 4축 정합: PIT RETURN_VALS 계열이 스텁 변이의 정식 명명 / Beck Broken Test·Fake It / Altmann 격리 브랜치 권고(worktree가 이미 충족) / LLM 테스트 문헌(mutation kill이 유일 신뢰 척도, tautological assertion 빈발).
- 3단계 게이트 정식화: 주입 전 상태 확인 → 주입 후 RED(=killed) → revert 후 원상태 복원 확인. 단일 변이, 관측 가능 차이 필수(equivalent mutant 회피), never-committed.
- revert 우선순위: git checkout -- <file> > git stash > 임시 브랜치. 커밋 금지.

### ResLlmFloor (lsc-librarian) — D-1 근거
- 전제 강력 지지: Kumaran 2026(+0.22 confidence 부풀림, answer-hidden 시 편향 소멸), Xu 2024(self-refine이 편향 증폭), Huang ICLR 2024, Tian EMNLP 2023(RLHF 과신) 등 7+ 소스.
- max(reported,floor)는 KnowU-Bench 'bounded base score'·DSPy Assert·Guardrails·LangGraph recursion_limit과 동형 — 산업 표준 특수화.
- **floor 고착 방지 상한 안전장치는 외부 선례 미확인** — gajae도 1.0 cap뿐. 완화: state-연동 floor(superseded_by 해소 시 하락) + 보수 가중치 + reported/effective 이중 기록 + E2E 캘리브레이션.
- 경고: 부정확한 객관 신호는 편향을 증폭('accurate'가 핵심 수식어) — floor 성분은 기계 판정 신호로 한정해야.

### ResClaimLedger (lsc-librarian) — D-2 근거
- 4축 지지: Lakens 사전등록(기각 조건 사전 명시가 1차 목적) / FEVER 3-label 동형 / CALM tombstone 단조성("once rejected, no synthesis resurrects") / Event Sourcing projection(claims.json=정본, SYNTHESIS.md=파생 뷰 — 드리프트 경고의 정석 해법).
- 한계 명시: 라벨링이 LLM 의존인 한 적대 오라벨 우회 가능(Structured Outputs는 형태 강제뿐) — "비적대·부주의 케이스의 결정론적 하한"으로 프레이밍할 것. 기각 과발화(노이즈 단일 contradict) 리스크.

## Wave 2 (expansion — 진행 중)
