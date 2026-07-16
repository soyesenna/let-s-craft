# lets-craft 개선 인사이트 최종 보고서

> 3개 레퍼런스 리포(lazycodex, gajae-code, oh-my-claudecode)에서 추출한 인사이트 30건 중, 2중 적대 검증(원천 리포 근거 실재 확인 + lets-craft 미기구현·철학 적합 확인)을 통과한 confirmed 22건과 탈락한 rejected 8건을 정리한다. 모든 서술은 검증자 notes의 유보·경고를 그대로 반영했다.

---

## 1. 총평

### lazycodex — "프롬프트 계약을 코드 검증으로 격상"하는 강제 계층의 교과서

omp와 유사한 플러그인 구조(OmO) 위에서 스킬 계약 + 훅 이중화라는 lets-craft와 가장 가까운 철학으로 만들어져 있어 이식 적합도가 압도적으로 높았다. quality gate의 리터럴 파서·증거 실존 기계 검사, 결정적 스캐폴드 스크립트, stop/resume 훅의 컨텍스트 압박 탈출구, doctor 커맨드 등 "LLM이 말로 주장하는 것을 코드가 파일·바이트 수준에서 재확인"하는 패턴이 핵심 자산이다. confirmed 22건 중 13건에 관여(단독 7건)해 기여도 1위이며, rejected 단독 탈락은 1건(서브에이전트 센티널 영수증 — lets-craft의 직접 재검증이 이미 더 강함)뿐이다.

### gajae-code — LLM 재량 판정을 결정론적 순수 함수로 클램프하는 평가기 설계

모호도 자기채점의 결정론적 하한(floor) 클램프, 시점 고정 해시 영수증에 의한 승인 자동 실효, 반증 조건 사전 등록 + 코드 강제 기각 기본값을 가진 리서치 원장 등 "LLM이 수렴하고 싶어서 낙관하는 지점에 코드 하한을 박는" 패턴이 강점이다. confirmed 단독 6건으로 질적 기여가 크지만, rejected 단독 3건 + 공동 1건으로 탈락도 가장 많다 — 탈락 사유는 아이디어의 질이 아니라 위협 모델 불일치가 대부분이다(해시-영수증 계열은 헤드리스 자율 재시도 루프를 전제하는데, lets-craft는 매 사이클 사용자 게이트가 있는 human-gated 직렬 파이프라인이라 방어 대상 위협 자체가 희박).

### oh-my-claudecode — 실장애 기반의 운영 방어와 훅 수명주기 안전장치

이슈 번호(#240, #362, #524)가 주석에 박힌 실장애 경험 기반의 방어 패턴 — stop 사유 분류기, stale 상태 밸브, 원자적 쓰기 + 세션 소유권 봉투, worktree 삭제 안전 검증, HUD 상태 표시 — 이 자산이다. 단독 confirmed는 2건(nonce 승인 토큰, worktree 제거 검증)으로 적지만 lazycodex 인사이트의 교차 검증·보강 공동 기여가 7건으로 많다. rejected 단독 3건은 모두 멀티프로세스 데몬/팀 파이프라인 아키텍처를 전제한 항목이 lets-craft의 단일 프로세스 동기 싱글턴 모델과 맞지 않아 탈락한 경우다.

**분포에서 드러나는 것**: lets-craft의 현재 공백은 "새 기능"이 아니라 **기존 불변식의 코드 백스톱 반쪽**이다. confirmed P5 11건 중 9건이 '이미 스킬 계약으로 존재하는 규율에 플랫폼/코드 층을 덧대는 것'(불변식 8 '강제는 이중화'의 미완 지점)이고, 이는 세 리포가 각자 다른 방식으로 같은 교훈에 도달했음을 보여준다.

---

## 2. 핵심 인사이트 (confirmed 22건)

### 테마 A. 승인 게이트·강제 계층의 코드 백스톱 — release 보안 MEDIUM 직결

#### A-1. 일회용 nonce 상관 승인 토큰 (P5, oh-my-claudecode)
- **근거**: `oh-my-claudecode/src/hooks/ralph/verifier.ts`
- **메커니즘**: ralph verifier는 검증 시도마다 `randomUUID` request_id를 발급하고, 승인을 자유 텍스트가 아닌 현재 시도의 request_id·story-id와 정확히 상관되는 태그로만 인정한다. 매칭 전 주입된 승인 예시를 소독하고, 검증 시도 상한(3회)으로 루프를 끊는다.
- **적용안**: `lsc_confirm`이 `[Canon Amendment]`/`[Land]` 등 파괴적 게이트에서 UUID nonce를 발급해 `.craft-state.json`에 기록하고, `lsc_craft_release`/land 도구가 "해당 nonce가 걸린 confirm이 방금 사용자 yes로 소비됐는지"를 TS 레벨에서 fail-closed 검증할 때만 실행. 미해결 과제인 release 승인 게이트(보안 MEDIUM)의 직접 해법.
- **검증자 유보**: `lsc_confirm`의 yes/no 응답은 플랫폼(ctx.ui) 산출물이라 모델이 에코로 위조할 수 없음 — 주입-예시 소독 절반은 여기선 대체로 불필요하며, 실제 벡터는 "confirm을 건너뛰고 release 직접 호출"이므로 **nonce-소비 게이트 부분만 채택 권장**. AUDIT VERDICT 라인으로의 확장은 이를 소비하는 TS 도구가 없어 우선순위 낮음.

#### A-2. release-재init 구간을 닫는 증거 계약: 사전 expected 기록 + 사후 대조 (P5, gajae-code)
- **근거**: `gajae-code/scripts/release-evidence.ts`, `gajae-code/scripts/check-public-version-sync.ts`
- **메커니즘**: 첫 mutation 전에 expected evidence를 먼저 기록하고, 발행 후 레지스트리에서 재다운로드해 바이트 대조를 통과해야만 final evidence를 쓰는 closed contract.
- **적용안**: release 실행 전 `.craft-state.json`에 open-release 증거(승인 confirm 태그·응답 원문, 해제 시점 매니페스트 해시, 예정 수정 범위)를 먼저 기록하고, open-release가 닫히지 않은 상태(재베이스라인 미완)면 `lsc_verify_hash`/`lsc_run_tests`가 fail-closed로 거부. `lsc_craft_init` 재베이스라인이 증거를 close하며 old/new 매니페스트 diff를 audit 입력으로 남긴다. 검증자가 코드로 확인한 사실: release 후 verify는 `hash-manifest.ts:268`에서 active craft 부재로 `ctx.cwd`로 폴백해 **실제로 verify blind가 발생**하므로 이 상태머신이 그 창을 닫는다.
- **검증자 유보**: 원문의 npm tarball 다운로드-백 대조는 패키지 발행 특화라 이식 불가 — 증거 스키마는 lets-craft 도메인으로 재정의 필요.

#### A-3. 단계·순서 불변식의 tool_call 백스톱 — 축소형 채택 (P5, lazycodex)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/src/spawn-guard.ts`
- **메커니즘**: PreToolUse 훅이 스폰을 가로채 선행 아티팩트({goal}-code-review.md 등)가 비어있지 않게 실존하는지 확인하고 없으면 deny — 파이프라인 순서를 프롬프트가 아닌 툴 호출 거부로 강제.
- **적용안(검증자가 좁힌 범위)**: 원안의 5개 항목 중 2개만 채택 가치가 있다. (a) `lsc_craft_init`(hash-manifest.ts:215)은 현재 `test/` 실존만 검사 — trace.md/spec.md/plan.md 비어있지 않음 검사 추가(불변식 1의 코드화, 매우 저렴). (b) release 승인 상태의 파일 토큰화(A-1/A-2와 합류). 반면 스폰 카운터/fan-out 캡·architect→critic 순서 백스톱·리서치 wave 캡은 **부적합** — enforcement.ts:9-20이 "cap·카운터는 플랫폼 소유, 중복 추적은 desync 위험"을 명시적 설계 원칙으로 못박았고, omp가 서브에이전트 스폰을 tool_call 훅으로 라우팅하는지 자체가 미확인이다.

#### A-4. bash 변이 가드의 쓰기 벡터 분류기 — 원안 기각, 부수 제안만 신중 검토 (P5, gajae-code)
- **근거**: `gajae-code/packages/coding-agent/src/skill-state/deep-interview-mutation-guard.ts`
- **메커니즘**: 리다이렉션·tee/rm/mv·sed/perl in-place·인터프리터 -c/-e 내부 쓰기·heredoc·dd of= 를 정규식으로 열거해 "쓰기 대상 경로"를 추출한 뒤 보호 경로 여부를 판정 — 읽기 전용은 통과, 쓰기 벡터는 명시 봉쇄.
- **검증자 판정(중요)**: 코어 제안(substring→분류기 승격)은 **기각 권장** — enforcement.ts:84-106 주석이 substring 매칭을 "권위 보증이 아닌 fail-fast 1차 방어선"으로 의도적으로 설계했음을 명시하고, 실제 권위는 `lsc_verify_hash`의 디스크 바이트 재검증에 있다. 정규식 셸 파서 도입은 과차단 UX 개선 대비 fail-open 갭을 늘려 불변식 7과 상충. 잔여 가치는 부수 제안뿐: 같은 분류기를 **pre-craft '구현 코드 절대 금지' 불변식의 tool_call 백스톱**으로 재사용(현재 enforcement는 craft 단계에만 발동, pre-craft 구현금지는 스킬 계약 단일 강제) — 단 테스트 선작성·산출물 쓰기와의 구분이 모호해 과차단 위험이 커 신중 검토 대상.

#### A-5. land 단계 worktree 제거 전 경로 불변식 검증 도구화 (P4, oh-my-claudecode)
- **근거**: `oh-my-claudecode/src/lib/worktree-cleanup-safety.ts`
- **메커니즘**: 재귀 삭제 전 NUL 바이트·`.`/`..`/`~`·심링크·파일시스템 루트/홈 거부, relative() 기반 소유 루트 내부 확인, realpath 해석, ".git이 디렉터리면 메인 리포" 판별로 삭제 거부.
- **적용안**: `src/artifacts/worktree.ts` 옆에 `validateWorktreeRemovalTarget` 순수 함수를 두고 `lsc_land`(또는 `lsc_validate_worktree_removal`) 도구로 노출, 스킬이 force-remove 직전 반드시 호출하게 계약에 명시. 'paths.ts 수동 복제 드리프트' 한계도 동시에 줄인다.
- **검증자 유보**: `git worktree remove` 자체가 미등록 워크트리·메인 트리를 이미 거부하므로 ".git 디렉터리" 판별식은 git과 상당 부분 중복 — 순가치는 (a) fail-open 래퍼인 removeWorktree()가 잘못된 feature 인자를 못 거르는 것을 코드로 막고 (b) 스킬의 수동 bash 복제를 도구로 승격하는 데 있다.

### 테마 B. 감사(post-craft) 판정의 기계 검증

#### B-1. VERDICT 리터럴 파서 + 증거 실존·사이클 신선도 기계 검사 (P5, lazycodex)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/src/quality-gate.ts`, 동 `src/paths.ts`
- **메커니즘**: `validateQualityGate()`가 최종 제출물을 코드로 검증 — recommendation이 literal "APPROVE"(유사어 거부), blockers 빈 배열, 모든 증거 경로가 현재 attempt 디렉터리 내부의 비어있지 않은 실존 파일. attempt별 네임스페이스 격리로 과거 시도의 낡은 증거 재제출을 구조적으로 차단.
- **적용안**: `src/craft/verdict.ts` 순수 모듈 + `lsc_audit_validate` 도구 — `**AUDIT VERDICT:` 라인을 4값 리터럴로만 파싱(critic 5값도 파서 공유), APPROVE 계열이면 현 감사 사이클 이후의 통과 run 로그 실존을 기계 확인. 현재 4값 어휘는 `test/e2e-full-cycle.test.ts:265`의 테스트 전용 정규식에만 존재하고 런타임 검증이 전무하다(CraftState에 사이클 개념도 없음).
- **검증자 핵심 뉘앙스**: **최고 가치는 cycle-freshness**(auditCycle 카운터 + 사이클별 로그 네임스페이스)로, AWC 후속 fix-verification 경로에서 낡은 green 로그 재인용을 막는 — 어디에도 커버 안 된 진짜 공백이다. 인용 file:line 실존 검사는 "라인 존재 ≠ 주장 정합"이라 저가치. 스킬이 자발 호출하는 형태면 약하므로 "검증된 판정 없으면 git merge 차단"으로 배선해야 실제 백스톱이 된다.

#### B-2. 감사 APPROVE의 시점 고정 해시 영수증 — 축소형 권고 (P5, gajae-code)
- **근거**: `gajae-code/packages/coding-agent/src/gjc-runtime/ultragoal-receipt-freshness.ts`
- **메커니즘**: 완료 시점의 정규화 스냅샷+원장 이벤트 ID를 sha256으로 묶어 영수증에 박고, 검증 시 재계산해 불일치면 완료를 자동 무효화(stale receipt). 상태 파일 미독은 fail-closed.
- **적용안과 검증자 판정**: 판정 이후 `[Spec Change]`/`[Plan Change]`로 정본이 수정된 채 land로 이어지는 동일-턴 창은 실존하나, 최대 드리프트 벡터(구현 커밋 추가)는 post-craft가 코드를 안 쓰므로 발생 불가하고 craft 재호출 시엔 사이클 구조가 새 감사를 강제해 이미 커버된다. 따라서 **전용 TS 도구+sha256 영수증은 다소 과하며, "§6.2가 정본을 수정했으면 현 판정 무효 → land 전 재감사"라는 스킬 계약 가드가 더 값싸게 같은 갭을 막는다**. 크로스-세션 재진입/재land에 한해 영수증의 증분 가치가 실재 — B-1의 cycle-freshness와 결합해 후순위로.

#### B-3. 트리거-매핑된 적대 클래스 매트릭스 (P4, lazycodex)
- **근거**: `lazycodex/plugins/omo/skills/start-work/SKILL.md`
- **메커니즘**: 검증 전에 9개 적대 클래스(malformed input, stale state, dirty worktree 등)의 적용 여부를 트리거 사실("새 입력 파싱이 있으면 → malformed input 적용")로 결정하고, 적용 클래스는 관측 결과·배제 클래스는 한 줄 사유를 원장에 강제 기록.
- **적용안**: `skills/post-craft/SKILL.md`의 audit-N.md 필수 구조에 lets-craft 도메인 재매핑 클래스(해시 보호 밖 테스트 위치 위임, worktree 잔여/base 오염, spec AC 경계 입력, resume 후 상태 정합, 프롬프트 인젝션 표면)를 추가 — 기존 컴플라이언스 매트릭스(스펙 일치)와 성격이 다른 "고려한 위협의 완전성" 표면이다. E2E는 절 존재/행 수만 검증(철학 9).
- **검증자 경고**: 배제 사유가 체크박스 극장으로 전락할 위험 — 적용 클래스에 file:line 관측을 요구하는 부분을 반드시 유지해야 실효.

### 테마 C. craft 루프·세션 수명주기의 안전장치

#### C-1. 무진행(no-progress) 감지 — 실패 시그니처 카운팅으로 사용자 게이트 에스컬레이션 (P5, lazycodex + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/src/quality-gate-blockers.ts`, `oh-my-claudecode/src/hooks/persistent-mode/index.ts`
- **메커니즘**: 실패 evidence를 정규화(URL·구두점 제거, 소문자화)해 시그니처를 추출하고, 동일 시그니처 3회 누적 시 자동으로 사용자 결정 큐로 승격. 재개 사이 원장이 늘었으면 카운터 리셋 — "몇 번 재시도"가 아니라 "실제 전진 여부"가 예산 키.
- **적용안**: `src/craft/run-tests.ts`의 구조화 실패 요약에 시그니처(실패 테스트명 집합 + 정규화 에러 1행) 계산을 추가, `.craft-state.json`에 durable 저장. 연속 N회 동일 시그니처면 continue 대신 `[No Progress]` lsc_confirm 게이트(전략 전환 / lsc-architect 자문 / abort 3택 — `[Consensus Escalation]`과 동형). 검증자가 코드로 확인: `shouldContinueCraftLoop`(enforcement.ts:166)은 무조건 continue이며 라이브 모드 진행도 측정이 전무 — §5에 자인된 미해결 영역을 정확히 메운다. 루프를 자동 종료하는 게 아니라 조기 가시화이므로 불변식 4(유일한 출구는 abort)와 충돌 없음.
- **검증자 유보**: session_stop이 print 모드에서 미발동하므로 **카운터/게이트 주 동력은 스킬이 소유**하고 TS는 durable 상태·시그니처 계산만 제공하는 이중화가 맞다. 비결정적 에러 라인(타임스탬프·경로) 흡수가 구현 난점이나 블로커는 아님.

#### C-2. session_stop 백스톱의 리치 재주입 템플릿 + stop 분류(축소형) (P5, lazycodex + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/components/start-work-continuation/src/codex-hook.ts` + `directive.md`, `oh-my-claudecode/src/hooks/todo-continuation/index.ts`
- **메커니즘**: 상태 파일 기반 지시문 템플릿("메모리를 믿지 말고 plan/ledger를 다시 읽어라") 재주입 + 컨텍스트 압박 마커 7종 감지 시 continue 포기. OMC는 차단 시 데드락이 되는 stop(컨텍스트 한계, 레이트리밋)을 분류기로 화이트리스트 통과.
- **적용안(검증자가 나눈 두 파트)**: **파트 1(채택 권장)** — `continuationResult()`(enforcement.ts:170-176)는 실제로 한 줄만 주입 중. `.craft-state.json`·`logs/run-N.log` 재독과 "continue?를 묻지 말고 재개" 등 SKILL.md §5 resume 규율을 훅 층에 이중화하는 미니 지시문 템플릿으로 격상(위험 낮음, 철학 8 부합). **파트 2(축소 적용)** — `SessionStopEvent`에는 stop 사유 필드가 없음이 확인됐으므로 분류기는 원안대로 불가, transcript 마커 매칭 순수함수 + continue 카운터라는 차선책으로만. 탈출은 자동 통과가 아니라 상태 기록 + `--continue` 안내(또는 `[Context Pressure]` confirm 게이트)로 설계해야 불변식과 충돌하지 않는다. continuation cap 자체는 이미 플랫폼 소유(cap 8)라 파트 2의 증분은 파트 1보다 약함.

#### C-3. 컴팩션 이벤트 훅 — 캐논 재독 강제 지시문 (P5, lazycodex + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/components/rules/src/post-compact-directive.ts`, `oh-my-claudecode/src/hooks/pre-compact/index.ts`
- **메커니즘**: PostCompact에서 "컴팩션이 룰 파일들을 드롭했다. 전부 다시 읽어라. 기억으로 재구성하는 것은 읽은 것이 아니다"라는 지시문을 재주입. OMC는 컴팩션 직전 활성 모드 상태를 checkpoint로 저장해 재주입.
- **적용안**: lets-craft에 컴팩션 대응이 전무함이 확인됐고, omp 타입에 `session_before_compact`·`session_compacting`·`session_compact` 이벤트가 실재해 등록 가능. 활성 craft 감지 시 "현재 단계 SKILL.md·spec.md·plan.md·해시 규율 재독" 지시문을 생성하는 순수 함수(`src/craft/compact-directive.ts`)를 추가 — 테스트 불변식·질문 태깅 규약이 컴팩션 후 유실돼 스킬 계약이 무력화되는 실패 모드를 방어.
- **검증자 핵심 경고**: lazycodex식 "컴팩션 후 재주입"은 omp에 그대로 매핑되지 않는다 — `session_compact` 핸들러는 반환이 void라 주입 채널이 없고, **omp의 관용 경로는 `session_compacting`의 `context`/`preserveData` 반환(요약 자체에 지시문 보존) 또는 `session_before_compact`의 `customInstructions`**다. 이 채널 차이를 반영해야 작동한다. 후반부 제안(pre-craft `.pipeline-state.json` 내구화)은 아티팩트-존재 기반 stage 재개라는 기존 설계와 상충하고 드리프트 위험 파일을 늘리므로 가치 약함 — 전반부만 채택.

### 테마 D. LLM 재량 판정의 결정론화 (pre-craft 품질)

#### D-1. 인터뷰 모호도 게이트에 결정론적 하한 클램프 — max(자기채점, 코드 floor) (P5, gajae-code)
- **근거**: `gajae-code/packages/coding-agent/src/gjc-runtime/deep-interview-ambiguity.ts`
- **메커니즘**: LLM 자기채점은 이전 점수에 앵커링돼 상승을 과소 보고한다. 순수 모듈이 객관 측정 항목(미해결 disputed fact ×0.10, 미채점 컴포넌트 ×0.05, 자동응답 라운드 비율 ×0.05)만으로 하한을 독립 계산해 저장 직전 `effective = max(reported, floor)`로 클램프하고 원점수를 감사 보존. 답변 철회 시 해당 라운드 fact를 기계적으로 disputed 처리해 floor 재상승.
- **적용안**: pre-craft Stage 2의 모호도<5% 게이트는 현재 4차원 전부 LLM 자기채점 단독임이 확인됨. 라운드별 구조화 상태를 `interview-state.json`으로 영속화하고 순수 함수 `computeAmbiguityFloor()` + 도구로 매 라운드 클램프를 강제, spec.md에 reported/effective 두 값을 모두 기록. 라운드 4/6/8 challenge 모드에서 사용자가 답을 뒤집을 때 disputed 규칙이 특히 유효.
- **검증자 경고(축소형 권고)**: 제안 가중치의 상당 부분이 여전히 LLM 채점 의존이라 **floor가 0.05 게이트 위에 고착돼 hard cap 20을 매번 치는 튜닝 리스크**가 있다. 진짜 객관 신호(open-questions.md 미해결 수, 자동응답 라운드 비율, disputed fact 수)에만 하한을 걸고 **가중치는 fixture E2E로 캘리브레이션**하는 축소 형태로 도입할 것.

#### D-2. 클레임별 dropCondition·반증 쿼리 + 결정적 verifier의 코드 강제 기각 기본값 (P4, gajae-code)
- **근거**: `gajae-code/packages/coding-agent/src/research-plan/ledger.ts`
- **메커니즘**: 리서치 항목마다 counterexampleQueries·dropCondition을 사전 등록하고, 순수 함수 `evaluateResearchLedger()`가 결정적으로 accepted/rejected/uncertain 판정. 핵심은 하드코딩 기각 기본값 — "반박 증거가 있는데 살아남은 지지 증거가 없으면" 무조건 rejected로, 순수 반박된 주장이 uncertain으로 빠져나가는 환각 생존 경로를 코드로 닫는다.
- **적용안**: 3지점 중 **pre-craft 리서치의 claim-graph 잠금이 최저위험·고가치** — claim별 dropCondition 필수화 + 기계 검증 가능한 claims.json 병행 + 순수 TS 평가기로 LLM이 SYNTHESIS.md에서 죽은 주장을 되살리는 경로를 차단. lsc-tracer 가설별 기각 조건 선언은 그다음.
- **검증자 경고**: (1) 평가기 입력(support/contradict 라벨)이 여전히 LLM 분류라 적대적 오라벨엔 우회 가능 — 효과는 비적대·부주의 케이스 한정이며 "코드로 완전 차단"은 과장. (2) 병행 claims.json은 드리프트 위험 파일 +1. (3) **post-craft AC 자동 차단 확장은 의도적으로 홀리스틱한 4값 감사 판정을 무디게 덮어쓸 위험**(사소한 contradict가 APPROVE 자동 차단)이 있어 심각도 임계 설계가 필수 — 리서치부터 좁게 도입 후 확장 검토.

#### D-3. pre-craft 테스트 뮤테이션 프루프 + 무응답 비승인 규칙 (P4, lazycodex)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/directive.md`
- **메커니즘**: 테스트-온리 작업에 회귀를 의도적으로 주입해 assertion이 실제로 실패하는지(항상-실패가 아니라 변별-실패인지) 확인하는 mutation proof. 별도로, 무응답 서브에이전트는 inconclusive로 종결하되 절대 승인으로 집계하지 않음.
- **적용안**: pre-craft Stage 4는 현재 "미구현이라 실패"(RED)만 확인하고 변별력은 검증하지 않는다 — 스텁에 임시 오답을 넣어 테스트가 그것도 잡는지 확인 후 revert. craft에서 "테스트가 너무 약해 아무 구현이나 통과"하는 실패 모드를 사전 차단하며, 테스트가 craft의 유일한 판정 권위라는 철학과 정합. 함께 합의 루프에 "architect/critic 스폰이 사망·오류·VERDICT 미파싱으로 끝나면 합의 통과로 집계 금지" 명문화(현재 스폰 실패는 어떤 규칙도 커버하지 않음 — fail-closed 불변식의 작지만 실질적 강화).
- **검증자 경고**: 뮤테이션 프루프는 **불변식 2(pre-craft 구현 코드 절대 금지·감지 시 revert)와 정면충돌**하므로 "즉시 되돌리는 일회성 프루프" 명시 예외를 계약에 새겨야 채택 가능. 완전 그린필드는 뮤테이트할 스텁이 없다는 한계.

#### D-4. interview 라우팅 판정 공개 + 2단 질문 필터 (P3, lazycodex)
- **근거**: `lazycodex/plugins/omo/skills/ulw-plan/SKILL.md`
- **메커니즘**: 판정(CLEAR/UNCLEAR)을 반드시 한 줄로 공표하고, 모든 후보 질문은 "증거로 답 가능한가 → 탐색으로 해소"의 필터를 통과해야 하며, 되돌릴 수 없거나 제품 표면에 남는 owner-decision만 항상 질문으로 남는다.
- **검증자 판정(증분 제한적)**: WHY 첨부는 이미 존재(weakest_dimension_rationale)해 순증분 없음. 모호도 %·캡 잔여의 명시 공표는 소폭 UX 증분. lets-craft는 라운드당 1질문 원칙이라 "이번 라운드 N질문" 형태는 이식 불가. **"증거로 답 가능하면 재탐색" 필터는 Override 2(인터뷰 중 재탐색 금지)와 정면 긴장** — 특정 질문 한정 스코프드 재탐색으로 좁혀야 방어 가능. owner-decision 필터 면제 프레이밍만 미코드화 실질 증분. UNCLEAR 시 무단 기본값 채택은 철학 충돌로 처음부터 제외됨(기본값은 '제안+명시 확인'만).

### 테마 E. 상태·산출물의 내구성과 드리프트 방지

#### E-1. pre-craft 산출물 스캐폴드의 결정적 TS 도구화 (P5, lazycodex)
- **근거**: `lazycodex/plugins/omo/skills/ulw-plan/scripts/scaffold-plan.mjs`
- **메커니즘**: 계획 파일을 모델이 직접 작성하지 못하게 하고 스크립트가 정본 섹션 헤더를 결정적으로 생성, 모델은 마킹 영역에만 append. 재실행 no-op으로 컴팩션 후 재개에 안전, 파괴적 덮어쓰기는 2단 플래그 뒤, 쓰기 경계(심링크 거부 포함)를 스크립트 스스로 강제.
- **적용안**: `lsc_scaffold` 도구(src/artifacts/, paths.ts 재사용) — 산출물 정본 헤더 생성 + 재실행 no-op + 경로를 worktree 내부로만 제한. 미해결 과제 "스킬이 paths.ts를 수동 복제(드리프트 위험)"를 정면 해소.
- **검증자 핵심 뉘앙스**: 가장 설득력 있는 대상은 markdown 헤더(길이 제한 없는 산문이라 결정성 이득이 작음)가 아니라, **스킬이 `addWorktree()`/`ensureWorktreesGitignored()` 로직 자체를 산문으로 재구현하고 있는 배선 부분** — 이미 존재하는 TS 함수를 도구가 재사용하면 드리프트를 코드로 봉쇄. 단계별 도구 분리 불변식에 맞춰 phase-scoped로 만들고 no-op을 resume 경로와 정합시킬 것.

#### E-2. .craft-state.json 원자적 쓰기(tmp+rename) + 변이 영수증·소유권 봉투 (P4, lazycodex + gajae-code + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/components/ulw-loop/src/plan-io.ts`, `oh-my-claudecode/src/lib/atomic-write.ts`
- **메커니즘**: `{path}.{pid}.{ts}.tmp` → rename 원자적 쓰기, 변이마다 owner·전이·content_sha256 영수증, `_meta{written_at, sessionId}` 봉투, 읽기 스키마 관용·쓰기 스키마 엄격의 비대칭.
- **적용안**: 검증자가 코드로 확인 — `state.ts:48`과 `hash-manifest.ts:120` 모두 비원자 `writeFileSync`이고, `.craft-state.json`은 해시 매니페스트 제외 대상(EXCLUDED_FILES)이라 위조 무방비다. **최소 적용(tmp+rename 순수 헬퍼)은 crash 시 durable resume이 절단 파일로 깨지는 실제 위험을 막는 확실한 가치·저비용**. 확장(revision·sessionId 영수증, ledger.jsonl)은 활성 craft가 메인 세션 싱글턴이고 resume이 이미 재init로 매니페스트를 재계산하는 설계라 동시-세션 충돌 빈도 검증이 필요 — **원자적 쓰기부터 도입하고 영수증/원장은 dogfooding 후 증분 판단** 권고.

#### E-3. durable 파일 스키마 버전 필드 + 마이그레이션 (P3, lazycodex + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/scripts/migrate-codex-config.mjs`, `lazycodex/plugins/omo/model-catalog.json`
- **메커니즘**: 역대 배포 설정 지문(managedProfiles) 대조로 (a) current 일치→표시만 (b) 과거 지문 일치→자동 업그레이드 (c) 불일치→user-modified 절대 불변조의 선언적 3-way 판정.
- **적용안**: CraftState·HashManifest·ModelsFile 세 durable 파일 모두 version 필드가 없음이 확인됨(fixtures.ts만 version:2 보유). README가 스스로 경고하는 models.yaml 구버전 비호환 + resume 지원이 만드는 "업그레이드-중-craft" 빈틈이 실재.
- **검증자 경고**: managedProfiles 지문 카탈로그 + 3-way merge 전체는 **출하 이력도 dogfooding 산출물도 0건인 현 성숙도 대비 과설계** — 증분은 "세 파일 version 필드 + 로드 시 마이그레이션 또는 명시적 에러(침묵 오독 금지)"라는 경량 코어로 한정하고, 카탈로그는 배포 이력이 쌓인 뒤로.

#### E-4. 빌드 타임 버전 각인 + dist↔src 드리프트 단언 (P3, lazycodex + oh-my-claudecode)
- **근거**: `lazycodex/plugins/omo/scripts/sync-version.mjs`, `oh-my-claudecode/scripts/release-boundary.mjs`
- **메커니즘**: 리포 루트 버전을 단일 정본으로 전 컴포넌트에 스탬핑하고, 훅 statusMessage 자체를 로드된 버전의 실시간 표시기로 만든다. OMC는 "배포된 것 = 빌드한 것"을 다이제스트 동등성으로 단언.
- **적용안**: `omp plugin link .` + dist 로드 구조라 "TS 수정 후 빌드 누락 → 구버전 dist 로드"가 전형적 stale 실패 모드이며, **tool_call 차단 같은 강제 계층이 구버전 코드로 돌면 강제 이중화의 훅 절반이 조용히 무력화**된다 — 검증자가 문제 진단의 정확성을 확인. 빌드 시 version+git short hash를 `src/generated/version.ts`로 생성해 statusbar·LSC_DEBUG·`.craft-state.json`에 각인, src 트리 해시를 dist에 기록해 session_start에서 대조·불일치 시 경고 배너(부팅은 안 막음).
- **검증자 유보**: 가치는 사실상 개발/dogfooding 시점 한정(npm 미배포)이고 tsc 외 빌드 후처리 스텝 추가가 전제 — 그러나 dogfooding이 명시된 다음 단계라 시의적절.

### 테마 F. 가시성·진단

#### F-1. statusbar에 craft 파이프라인 진행 카드 상시 표시 (P4, gajae-code + oh-my-claudecode)
- **근거**: `oh-my-claudecode/src/hud/elements/autopilot.ts`, `gajae-code/packages/coding-agent/src/deep-interview/render-middleware.ts`
- **메커니즘**: 모드 상태 파일을 statusline 렌더러가 읽어 "[AUTOPILOT] Phase 2/5: Plan | Tasks: 5/12"처럼 상시 표시. 정형 텍스트 파싱 실패 시 폴백으로 UX가 깨지지 않음.
- **적용안**: `src/statusbar/`의 기존 gather→view-model→render 파이프라인에 두 번째 소스를 추가 — craft 단계는 durable 상태, pre/post-craft는 산출물 존재로 단계 추론, 최신 audit의 `**AUDIT VERDICT:` 라인 파싱(실패 시 세그먼트 생략). 긴 craft 루프 중 "지금 몇 번째 iteration인지"를 스크롤 없이 읽을 수단이 현재 없다.
- **검증자 교정**: 인사이트의 데이터소스 서술은 부정확 — **CraftState에는 iteration/run 인덱스 필드가 없어**(feature·testsPassed·aborted·worktreeRoot만) iteration 표시는 `logs/run-N.log` 파일명에서 유도해야 한다. statusbar는 메인 세션 전용이므로 in-process `getActiveCraft()` 싱글턴을 읽으면 FS 스캔 없이 저비용. 가치는 중간 수준.

#### F-2. 세션 첫 출력에 프리셋 해석 결과와 출처 레이어 공개 (P4, gajae-code)
- **근거**: `gajae-code/packages/coding-agent/src/defaults/gjc/skills/deep-interview/SKILL.md`, 동 `render-middleware.ts`
- **메커니즘**: 어떤 안내보다 먼저 `threshold: <값> (source: <출처 파일>)` 한 줄을 출력하고, 다층 config에서 "어느 레이어에서 왔는지"를 산출물 메타데이터까지 전파.
- **적용안(검증자가 좁힌 범위)**: lets-craft는 이미 session_start에서 프리셋 이름·경고를 notify로 노출하지만, **출처 레이어(project vs global vs none)는 `mergeModelsFiles`(models-file.ts:120-129)가 소스 추적 없이 병합해 LSC_DEBUG 없이는 알 수 없다** — 이 provenance 노출만이 실질 증분. 곁가지 2개는 기각: TUI regex 카드는 별도 제품 전제라 미매핑, `Ambiguity gate: 5% (source: skill default)` 공개는 게이트가 하드코딩 상수라 정보량 0의 카고컬트.

#### F-3. /lsc-doctor 건강검진 커맨드 (P3, lazycodex)
- **근거**: `lazycodex/plugins/omo/skills/lcx-doctor/SKILL.md`
- **메커니즘**: 진단 전 최신 정본 소스를 물질화("기억 속 레이아웃과 비교 금지"), 모든 검사를 실제 출력/파일 인용이 붙은 PASS/WARN/FAIL 표로 보고, 경고성 통과는 WARN 강등, 진단 중 무변경(수정은 제안만).
- **적용안**: `/lsc-doctor` 커맨드(순수 로직은 `src/doctor.ts`) — dist/매니페스트 정합, plugin link 상태, agents 8종 frontmatter 파싱, models.yaml 검증(기존 preset/validate 재사용), 고아 worktree(`git worktree list` 대조), stale craft-state, .gitignore 등록. 검증자 확인: 진단 커맨드는 전무하고(registerCommand 2개뿐), resume + 항상-worktree 설계가 stale 상태·고아 worktree라는 실제 운영 표면을 만들므로 진단 가치가 실질적. 재사용 대상 모듈이 모두 실존해 순수 함수 분리 패턴이 그대로 성립.

---

## 3. 적용 로드맵 제안

### 선행 게이트 (모든 변경 전)

**`npm run e2e` 3종 회귀 확인** — 미해결 과제 "fixture E2E 수렴 동역학 미검증"(AWC 계약 7커밋이 TS 변경 0·단위 245 green이지만 E2E 미실행)을 먼저 해소해 기준선을 확보해야, 아래 변경들의 수렴 영향(스폰 수/iteration)을 분리 측정할 수 있다. 특히 D-1(모호도 floor)은 가중치 캘리브레이션을 fixture E2E에 의존하므로 이 기준선이 전제 조건이다.

### Quick win (작은 변경, 즉시 효과 — 추천 순서)

1. **E-2 최소형: tmp+rename 원자적 쓰기 헬퍼** — state.ts:48·hash-manifest.ts:120 두 곳, 순수 함수라 vitest 검증 용이. durable resume의 실제 crash 취약점 제거.
2. **A-3 축소형: `lsc_craft_init`에 trace/spec/plan 비어있지 않음 검사** — 불변식 1의 코드화, 검증자 표현으로 "매우 저렴".
3. **C-2 파트 1: `continuationResult()` 리치 재주입 템플릿** — 한 줄 → resume 규율 미니 지시문. 훅 층 이중화, 위험 낮음.
4. **스킬 문서만으로 되는 것 묶음**: D-3의 "무응답 스폰 비승인" 명문화 + B-2 축소형("§6.2가 정본 수정 시 현 판정 무효 → land 전 재감사" 가드) + B-3 적대 클래스 매트릭스 절 추가.
5. **F-2: 프리셋 출처 레이어 공개** — mergeModelsFiles에 소스 추적 추가, notify 한 줄 확장.
6. **E-4: 빌드 버전 각인** — dogfooding 착수 직전에 넣어야 효과가 가장 큼(stale dist로 강제 계층이 무력화된 채 dogfooding하는 사고 방지).
7. **F-1: statusbar 진행 카드** — 기존 순수 파이프라인 재사용, iteration은 run-N.log 파일명 유도로.

### 구조적 개선 (설계 변경 필요 — 추천 순서)

1. **release 승인 게이트 패키지 (A-1 nonce + A-2 open-release 증거 + A-3의 release 부분)** — 유일한 문서화된 보안 MEDIUM이자 세 인사이트가 수렴하는 지점. nonce-소비 검증(도구 층) + open-release 상태머신(verify blind 창 폐쇄)을 한 설계로 묶어 진행. 미해결 과제 §5 첫 항목 직결이므로 구조 개선 중 최우선.
2. **B-1: verdict 파서 + auditCycle cycle-freshness** — 특히 사이클별 로그 네임스페이스는 AWC fix-verification 경로의 유일한 미커버 공백. "검증된 판정 없으면 git merge 차단" 배선까지 포함해야 실제 백스톱.
3. **C-1: no-progress 시그니처 + `[No Progress]` 게이트** — CraftState 확장 + run-tests 시그니처 계산 + 스킬 계약. dogfooding에서 라이브 craft 루프를 처음 돌리기 전에 있어야 안전한 항목.
4. **C-3: 컴팩션 훅(전반부만)** — omp 채널 조사(`session_compacting` context vs `session_before_compact` customInstructions)가 선행 과제.
5. **D-1: 모호도 floor 축소형** — 객관 신호 한정 + fixture E2E 캘리브레이션. 선행 게이트(E2E 기준선)에 의존.
6. **E-1: `lsc_scaffold`** — worktree/gitignore 배선 재사용 중심으로. paths.ts 드리프트 과제 해소.
7. **후순위 묶음**: D-2(리서치 claim-ledger부터 좁게), F-3(/lsc-doctor — dogfooding 운영 표면 커버), E-3(version 필드 경량 코어), A-5(land 검증 도구), E-2 확장(영수증/원장 — dogfooding 후 재판단), A-4 Part 2(pre-craft bash 백스톱 — 과차단 위험 검토 후), D-3 뮤테이션 프루프(불변식 2 예외 조항 설계 후), D-4(스코프드 재탐색 조율 후).

**dogfooding 과제와의 연결**: §5의 "다음 기능부터 자기 자신에 파이프라인 적용"을 위 로드맵과 결합하면 — Quick win 6·7(버전 각인, statusbar)과 구조 개선 3(no-progress)은 dogfooding의 안전망·관측 도구이므로 dogfooding **전에**, 나머지 구조 개선 항목들 자체를 dogfooding의 **대상 기능**으로 삼으면 파이프라인 검증과 개선이 동시에 진행된다.

---

## 4. 탈락했지만 언급할 가치가 있는 것 (rejected 8건)

**R0. SKILL.md 빌드 타임 생성 + CI 바이트 드리프트 게이트** (3리포 공동, P5) — 유일한 근거 불충분(ev.evidence_ok=false) 탈락: OMC `compose-docs.mjs`의 `{{INCLUDE:}}` 템플릿 합성이 헤더 주석에만 존재하고 실제 코드는 단순 복사뿐이었다(리포 전체 INCLUDE 사용 0건). 그러나 lazycodex·gajae-code 부분(마커 구간 바이트 비교 --check)은 정확했고, 적용성 검증자는 applicable=true로 판단 — paths.ts 드리프트가 실존 과제인 만큼, full 템플릿 하네스 대신 **"paths.ts 헬퍼 출력과 SKILL.md 리터럴을 대조하는 경량 --check 드리프트 게이트"**는 여전히 검토할 만하다(E-1과 상보적).

**R2. 서브에이전트 산출물 센티널 영수증 게이트** (lazycodex, P4) — 기구현 탈락이지만 '차이'가 흥미롭다: lets-craft는 센티널 파싱 대신 **메인 세션이 인용된 file:line을 직접 read하는 더 강한 메커니즘**(post-craft C24)으로 같은 관심사를 커버하고, 심링크 fail-open 갭도 enforcement.ts:96-105가 "substring 매처는 1차 방어선, 권위는 lsc_verify_hash의 디스크 바이트 재검증"이라고 의식적으로 논증한 defense-in-depth다. omp에 SubagentStop 훅이 없어 원안 자체가 구현 불가이기도 하다.

**R6. executor 완료 보고의 구조화 claims 팩트체크** (oh-my-claudecode, P4) — 기구현 탈락: craft의 유일한 통과 권위는 executor 자기보고가 아니라 `lsc_run_tests` 독립 재실행 + 매 iteration `lsc_verify_hash`이며, 스킬은 새 executor에게 이전 보고 대신 git log/diff로 상태를 재도출하게 한다 — **executor claims가 애초에 load-bearing이 아니라서** "검증 없는 워커 주장으로 단계 전환"이라는 원천의 전제가 성립하지 않는다. 감사 재확인의 도구 선처리는 오히려 불변식 5와 충돌.

**R7. 훅 오류 격리 이원화(강제 훅 fail-closed)** (oh-my-claudecode, P4) — 사실상 플랫폼 제공으로 탈락: enforcement.ts:4-8이 "omp의 tool-wrapper.ts가 핸들러 throw 시 이미 fail-closed"임을 명문화하고 있고, 두 강제 핸들러는 예외 표면이 거의 0이다. session_stop을 fail-closed-continue로 만들면 오히려 무한루프 위험. 확인 가치는 있었던 항목.

**R1. craft 백스톱 폭주 방지 밸브 3중화** (oh-my-claudecode, P4) — 아키텍처 불일치 탈락: abort-race는 단일 프로세스 동기 싱글턴에서 성립하지 않는 비문제, thinking-only 카운트는 "cap은 플랫폼 소유" 원칙과 중복. stale 임계만 유효한 갭이지만 세션 전환마다 이미 clear되고 인터랙티브 출구(abort)가 있어 한계 가치가 작으며 불변식 4를 약화시키는 긴장을 만든다. C-1(no-progress)이 같은 관심사를 철학 정합적으로 커버한다.

**R3. plan/audit 기록의 content-addressed 원장** (gajae-code, P4) — 위협 모델 불일치 탈락: "audit-N.md 무단 재작성" 위협은 단계별 git 커밋(4섹션 커밋 본문, pre-craft ≥5커밋)이 이미 content-addressed 이력·diff로 커버하고, "land 후 위상 잠금"은 land가 worktree 자체를 제거하므로 잠글 대상이 사라져 무의미. human-gated 파이프라인에서 멱등 원장의 한계효용이 작다.

**R4. ask 스키마 게이트 메타데이터 + prose 누출 감지기** (gajae-code, P4) — 플랫폼 제약 탈락: `{stage, kind}` 튜플은 게이트를 유일 식별하지 못해 질문 텍스트 매칭을 대체 못 하고, confirm에 kind:destructive를 달아도 실제 실행 지점(bash git merge, release 도구)을 강제하지 못한다 — 진짜 공백(release approval:"read")은 A-1/A-2가 해결. prose 누출 감지기는 omp 훅에 어시스턴트 메시지 이벤트가 없어 **호출할 트리거 표면 자체가 존재하지 않는다**.

**R5. 합의 루프 리뷰의 sha256 영수증 결박** (gajae-code, P4) — 실효성 탈락: LLM 서브에이전트는 해시를 직접 계산할 수 없어 스킬이 프롬프트에 넣어준 해시를 되받아 적는 것은 "실제로 읽은 파일"과의 결박을 증명하지 못하는 형식적 영수증이며, 단일 메인 세션의 직렬 스폰 모델에서는 두 리뷰어가 다른 리비전을 볼 경로 자체가 거의 없다. AWC diff-only 재확인의 무결성이 걱정되면 "스폰 전후 스킬이 bash로 해시를 계산해 불변 assert"하는 정도로 충분하다는 것이 검증자 판단.
