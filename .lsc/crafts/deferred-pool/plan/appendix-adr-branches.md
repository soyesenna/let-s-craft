# Appendix — ADR 브랜치별 전체 검토 (deferred-pool, iteration 2)

> 코어 plan.md §4의 7결정(D1-D7)의 옵션별 상세. 각 결정은 실행 가능 옵션 ≥2를 검토했고, 기각 옵션은 무효화 근거를 명시한다. iteration 1의 사실 오독(E 양 호출점 의미론)과 잠정 채택 3건의 리뷰 판정은 본 개정에서 실코드 인용으로 교정·종결했다.

## D1 — lsc_land 모듈 배치 (유지)

**Option A (채택) — 신규 `src/craft/land.ts`**
- 소비자 모듈이 자기 소비 가능 태그 집합을 소유(release-gate ADR CS1: `RELEASE_CONSUMABLE_TAGS`는 release.ts 소유) — `LAND_CONSUMABLE_TAGS = ["[Land]"]`를 land.ts가 소유하면 대칭이 유지되고, 소비자 추가가 기존 소비자 코드를 건드리지 않는다.
- release.ts 0 변경 → release-gate의 소비 경로 회귀 표면이 생기지 않는다.
- craft-phase(release: active craft 존재)와 post-craft-phase(land: 앵커 재구성)의 identity 원천이 다르다 — 한 모듈에 두 원천이 공존하면 잘못된 원천 참조 실수 표면이 생긴다.
- iteration 2 추가: destructive-approval.ts는 **opaque scope 1필드 + prepared-operation 슬롯 확장만** 받는다 — scope 내용은 소비자 정의(opaque JSON), 슬롯은 태그 키. "발급 인프라는 소비자를 모른다"(destructive-approval.ts:9) 불변식이 유지된다. LandOperation의 관찰·구성은 land.ts 소유 — ask.ts는 land.ts를 import하지 않는다.
- 단점: 소비 트랜잭션 템플릿이 release.ts:54-88과 형태상 중복(~30행 의도된 구조 반복 — 두 소비자의 fail-closed 경로 개별 감사 가능성이 공용화보다 우선).

**Option B (기각) — release.ts 확장** / **Option C (기각) — destructive-approval.ts에 land 로직 배치**
- 무효화(iteration 1과 동일): B는 CS1 위반+게이트 전제 상이+직전 보안 파일 재개봉. C는 권위 모듈의 repo-internal dependency 0 불변식 파괴(merge/fs 오케스트레이션 유입).

## D2 — 승인-operation 결박 (재설계 — iteration 1 BLOCKING 2·3 대응)

**Option A (채택) — ctx.cwd 앵커 identity + LandOperation scope 결박**
- identity는 ctx.cwd에서 재구성(feature, projectRoot=ctx.cwd, worktreeRoot=worktreePath(ctx.cwd, feature)) — persisted 3필드는 sole authority가 아니라 **앵커와의 일치 evidence**(불일치=isError). persisted 파일 편집만으로는 identity도 audit 검증도 위조할 수 없다(evidence tampering 차단은 D4와 협동).
- scope = `LandOperation{sourceBranch/OID, targetBranch/OID, mode: merge-and-clean|force-clean-only}` — canonical JSON 직렬화 동등 비교. consume 직전 재관찰 일치 필수: 승인 후 target/source가 움직이면 scope-mismatch 거부·재승인("1 승인 = 1 구체 파괴 작업").
- post-craft가 base를 탐지해 `[Land]` 질문에 명시하는 기존 흐름(SKILL.md:69-75,214-220)과 정합 — 질문에 적힌 base가 곧 기계 검증되는 승인 범위가 된다.
- force 재승인은 mode=force-clean-only로 초기 merge 승인과 기계 구분(T6 방어 완결).
- 단점: 승인 record·발급 경로 확장. 수용: 확장은 opaque scope 1필드+슬롯 1개 — 인프라 일반성 유지.

**Option B (기각 — iteration 1 채택안) — 3필드 identity + "feature 브랜치 아님" preflight만**
- 무효화: 승인된 base와 다른 임의 브랜치로 merge 가능(iteration 1 ADR 스스로 인정) — fail-closed 기본값 아님. force 재승인이 초기 승인과 구분 불가. architect BLOCKER·critic CRITICAL 2로 기각 확정.

**Option C (기각) — 도구가 base checkout까지 수행**
- 무효화: checkout 부수효과·오판 위험(iteration 1 근거 유지). 무 checkout을 유지하면서 결박으로 안전을 확보하는 Option A가 상위 호환 — checkout은 스킬 산문 선행 지시로 존속.

## D3 — [Land] 발급 seam (신규 — iteration 1 BLOCKING 1 대응)

**Option A (채택) — destructive-approval prepared-operation 슬롯 + ask.ts 태그-일반 분기**
- lsc_land가 read-only preflight 통과(또는 consume mismatch) 시 **generic issuance envelope** `PreparedDestructiveOperation{prepareId, tag, identity: ApprovalCraftIdentity, operationScope: JsonValue, approvalQuestion, evidenceRoot}`를 tag-key 인메모리 슬롯에 설치하고 "approval-required"+exact approvalQuestion으로 반환(2-phase). `operationScope`만 consumer-opaque — envelope는 generic issuance metadata라 발급 인프라의 소비자-무지 불변식(destructive-approval.ts:9)이 유지된다. **prepared slot은 trusted/non-authoritative issuance context**(human yes 없이 설치되므로 권위가 아님), **pending slot만 sole volatile consume authority**. ask.ts 발급 분기(ask.ts:631-655)는 `preparedAtPrompt = peekPreparedOperation(tag)` 캡처 — prepared branch 발급 조건: tag 일치 + `params.question === prepared.approvalQuestion`(exact question 결박) + `prepareId` confirm 전후 유지 + (active craft 부재 또는 `sameCraftIdentity(prepared.identity, getActiveCraft())`). eligible prepared 부재 시 기존 craft-bound 경로(**무변경**).
- persist-before-install 보존: land 경로 durable evidence는 신설 `recordReleaseApprovalAt(root, identity, evidence)`(state.ts — **exact-root writer**: `craftStatePath(root, identity.feature)` 직접 read/write + persisted 3필드의 identity 전부-일치 검사 후 writeFileAtomicSync; generic `persist(next)` 호출·persisted path 필드의 write authority 사용 금지)를 install **이전** 호출. 기존 recordReleaseApproval은 active craft 없으면 no-op(state.ts:259-260)이라 land 경로에 쓸 수 없음이 신설 근거.
- 슬롯 수명(normative lifecycle — TTL 없음): 새 prepare의 same-tag replacement / successful issuance 후 clear / tagged no·free·cancel 후 clear / Phase R failure 후 clear / setActiveCraft·load·abort·clearActiveCraft·session_switch·session_branch·session_shutdown에서 clear / 프로세스 재시작 시 소멸(=fail-closed). invalidation은 `prepareId` conditional — confirm await 중 더 최신 prepare를 지우지 않는다.

**Option B (기각) — lsc_confirm에 명시 operation context 인자 추가**
- 무효화: confirm 도구 스키마가 소비자별 인자로 오염되고(태그마다 다른 context 형), OID/브랜치를 LLM이 인자로 전달 — 관찰 권위가 untrusted 도구 인자로 이동한다. 슬롯 안은 관찰을 land.ts가 직접 수행해 인자 신뢰 문제가 없다.

**Option C (기각) — post-craft가 active craft 재활성화**
- 무효화: post-craft 명시 계약(SKILL.md §1.5 — lsc_craft_init 미호출) 및 enforcement 비확장 제약(spec 제약 11)과 충돌. architect도 부적합 판정.

## D4 — audit 증거 권위 (재설계 — iteration 1 BLOCKING 4 대응)

**Option A (채택) — land 시점 strict read-only 재검증 + cycle-aware marker evidence**
- land 전용 strict 코어 `validateLandAuditEvidence` 추출(marker 기록 없음): persisted state 존재 + integer `auditCycle === latestAuditNumber` + integer `runLogAtCycleStart` + `number > threshold && passed` run log 전부 **필수** — `validateAuditFreshness`의 undefined-tolerant 분기(verdict.ts:132-147, legacy audit tool용)는 land에서 미사용(missing-threshold fail-open 차단). cycle/threshold 부재=no-audit-cycle, fresh pass 부재=stale-run-log isError. marker는 **cycle-aware evidence**: 부재·이전-cycle=WARN(producer 기록 실패가 land를 영구 봉쇄하지 않음), current-cycle 동일 verdict=일치, current-cycle 다른 verdict·future-cycle=evidence-tamper isError. `recordAuditCycleBegin`은 새 cycle 기록과 함께 이전 `auditValidated`를 원자적으로 clear — `{...existing}` stale marker 보존(state.ts:295-301)이 만들던 다-cycle 가용성 결함 차단.
- producer 계약 동시 수정: recordAuditValidated는 best-effort 유지하되 docstring·경고문을 "비권위 trace — land는 독립 재검증"으로 갱신. best-effort 설계(verdict.ts:349-360)와 권위 부재가 이제 정합.

**Option B (기각) — marker 권위 유지 + recordAuditValidated hard-error화**
- 무효화: marker는 여전히 projectRoot 내 편집 가능 untrusted 파일 — 3필드 불변 편집으로 위조 가능(architect BLOCKER 4). 쓰기 의미론을 고쳐도 읽기 신뢰 문제가 남고, hard-error화는 "기록 실패가 검증 성공을 가리면 안 된다"는 기존 주석 계약(verdict.ts:352-353)과 충돌하는 새 결함을 만든다.

## D5 — E: 후보/decode seam 공유 + 정책 보존 (재설계 — iteration 1 BLOCKING 5·오독 교정)

**사실 교정** (iteration 1 appendix의 양쪽 전제가 실코드와 불일치했다):
- resolveAuditRoot(verdict.ts:163-166)는 상태파일이 아니라 **worktree 디렉터리** 존재로 분기 — all-in-worktree artifact-root 정책.
- findPersistedCraftState(state.ts:345-351)는 '첫 파싱 성공'이 아니라 **open-release 중재**: 어느 후보든 미폐쇄 openRelease면 그것이 우선, 둘 다 닫혔을 때만 worktree tie-break. 기존 회귀(test/craft-state.test.ts:481-533)와 run-tests.ts:224-228·hash-manifest.ts:354-357이 이 보안 불변식에 의존한다.

**Option A (채택) — decodeCraftState + craftStateCandidates 공유, 선택 정책 2종 named 보존**
- 공유 가능한 것은 후보 구성·정규화·decode(D 버전 검증 포함)뿐. 선택 정책은 소비자별 권위(보안 중재 vs artifact-root)라 각각 보존 — K5가 경고한 의미 변경을 실제로 회피하는 유일한 합성(architect Synthesis 동의). 드리프트 방어는 "후보·정규화 단일 seam"이 담당하고, 정책 차이는 각 함수 주석이 의도임을 명시.

**Option B (기각 — iteration 1 채택안) — '존재 분기' 단일 의미론 통일(worktree 우선)**
- 무효화: projectRoot 측 open release를 stale closed worktree record가 가려 protected canon 게이트 재개방 — AC10(기존 무손상)·AC12(전수 green)·Must-Have와 동시 만족 불가. 오독 기반 결정이라 기각.

**Option C (기각) — 후보 추측(첫 파싱 성공) 의미론 통일**
- 무효화: audit root 해석이 '존재하지 않는 root 추측 읽기'를 얻음 — 감사 경로 결정론 후퇴.

## D6 — doctor 표면 (재설계 — iteration 1 BLOCKING 6 대응)

**Option A (채택) — shared runner + 어댑터 2 (슬래시 커맨드 UI 뷰 / lsc_doctor 도구 isError)**
- SDK registered command handler는 `Promise<void>`(SDK 16.4.0 types.d.ts:633) — real process exit는 slash 표면에서 구현 불가하고, slash에서 process.exitCode 조작은 interactive host 오염. runner 1개가 `DoctorReport{findings, exitCode}`(논리 exit)를 소유, 어댑터 2는 thin: 커맨드=표+증거+exitCode 표기, 도구=FAIL≥1→isError(에이전트 게이트/자동화 소비 — spec AC7 교정 근거).
- ports 재설계: `collectObservations`(effect — readFile/exists/readdir/exec(signal), AbortController+주입 setTimeout/now per-check deadline)와 `evaluateFindings`(pure) 분리 — never-resolving Promise도 UNKNOWN(timeout)으로 완주(iteration 1 "now만으로 timeout 불가" 해소).

**Option B (기각) — slash 단독 + AC를 논리 상태로만 축소**
- 무효화: 게이트/자동화 소비 표면 부재로 exit 계약의 실사용처 소멸 — R0 흡수 취지(드리프트의 기계 검출) 반감.

**Option C (기각) — 독립 CLI 허용**
- 무효화: spec 비목표("R0 독립 --check CLI" 기각 — R6 인터뷰의 사용자 정책 결정, 불변)와 정면 충돌. 도구 어댑터가 CLI 없이 동일 가치를 제공.

## D7 — F 이식 범위(유지) + runtime consumer(신규 결정 — iteration 1 MAJOR 7.4 대응)

**이식 범위 (iteration 1 유지)**: gajae `ledger.ts:110-178` 판정 코어(invalid→반박-무지지 무조건 rejected→uncertain→accepted)+`:145-148` 주석 취지 충실 이식, 스키마는 lets-craft 재정의(dropCondition 필수·4어휘). sourceConflictPolicy·counterexampleQueries(원천에서도 validation-only)·unknowns 불이식. 통짜 vendoring·전면 신설은 iteration 1 근거로 기각 유지.

**Option A (채택) — transition-aware reducer + lsc_claims 도구 등록**
- `evaluateLedger(claims, previousDecisions)`: tombstone 단조(previous가 rejected/invalid면 어떤 신규 지지로도 불부활) — transition 입력 없이는 부활 금지가 검증 불가(critic MAJOR 4). lsc_claims가 claims.json 로드→재평가→decision write-back(decision 필드 도구 단독 소유)+projection 요약 — 정본-projection 계약이 runtime에서 실제 강제된다.
- 비용: thin registrar+fs adapter 1개 — 기존 도구 관례 그대로.

**Option B (기각) — library-only 명시 축소**
- 무효화: runtime callsite 0의 dead library(architect MAJOR 7.4) — 스킬 산문이 호출할 표면이 없어 "결정론적 하한"이 실행되지 않는 선언에 그친다. 도구 1개 비용 대비 기능 가치 손실이 크다.
