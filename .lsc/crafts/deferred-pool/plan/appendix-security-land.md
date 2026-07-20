# Appendix — lsc_land 위협 모델 (deferred-pool)

> 보안 상세: 파괴적 표면(merge + worktree 삭제)의 위협 클래스와 방어 배선. 근거: N1(git 원생 거부 R1-R5 + --force 불가침 R1/R2/R4), OMC worktree-cleanup-safety.ts 실전 선례, release-gate 승인 인프라.

## 신뢰 경계

- **입력 신뢰 안 함**: 도구 인자(feature/mode), persisted `.craft-state.json`(3필드·auditValidated marker 포함 — 편집 가능), audit-N.md·run-N.log(디스크 산출물 — 비적대·부주의 모델의 재검증 대상), 파일시스템 상태(심링크·realpath).
- **신뢰함(권위 4분류)**: **pending-approval 슬롯 = sole volatile consume authority**(프로세스 내 유일 소비 권위 — human yes 후에만 설치, release-gate 설계), **prepared-operation 슬롯 = trusted but non-authoritative issuance context**(human yes 없이 lsc_land가 설치하므로 권위가 아니라 scoped 발급 컨텍스트 — durable evidence 선행 불요), persisted approval record = non-authoritative durable evidence, git 원생 거부 의미론과 land 시점 git 재관찰(HEAD/브랜치/OID) = execution-time gate evidence. paths.ts 헬퍼 출력(ctx.cwd 앵커·expectedRoots 원천)도 신뢰.

## 위협 클래스 → 방어

| # | 위협 | 방어 | 검증 |
|---|---|---|---|
| T1 | 인자 주입: 빈/공백·NUL·`.`/`..`/`~`·경로 구분자로 후보 경로 조작 | validateWorktreeRemovalTarget 인자 sanity(1차 검사 — 파싱 전 거부) | AC4 매트릭스 |
| T2 | 심링크 스왑: 후보가 심링크(안→밖: 외부 삭제 / 밖→안: containment 위장) | lstat 심링크 거부를 realpath 해석 **이전**에 배치(OMC 순서 보존) | AC4 2방향 케이스 |
| T3 | realpath 충돌: 후보의 realpath가 우연히 다른 등록 worktree와 일치 — git은 그걸 지운다(N1: containment이 유일 방어) | expectedRoots(paths.ts:94 파생) realpath containment | AC4 |
| T4 | 파일시스템 루트/홈 삭제 시도 | root/home fail-fast 거부 | AC4 |
| T5 | 메인 리포 삭제: `.git` 디렉터리 보유 경로를 후보로 | `.git` **디렉터리** 판별 거부(+git R1/R2와 중복임을 주석 명시 — 방어 심층이지 대체 아님) | AC4 |
| T6 | 승인 우회/재사용: 무발급 호출·기소비 nonce 재사용·dirty 거부 후 무승인 force | consume 선행 게이트(1 소비=1 시도), force 분기는 신규 `[Land]` 소비 필수, 슬롯은 인메모리(프로세스 밖 위조 불가) | AC1·AC3 |
| T7 | identity 위조/혼동: 타 feature용 승인으로 이 worktree 삭제, persisted 파일 조작 | 소비 identity는 **ctx.cwd 앵커 재구성**(persisted 3필드는 앵커 대조 evidence — 불일치 즉시 거부) + LandOperation scope 결박(D2). auditValidated는 T11 참조 — marker 단독 인정 없음 | AC1·AC2(왕복) |
| T8 | dirty/locked 데이터 손실: 미커밋 변경·의도적 잠금 무시 삭제 | git 원생 의미론 위임 — dirty는 1회 `--force`(재승인 후에만), locked는 2회 필요하나 도구는 1회만 전달 → locked는 도구로 불가침 | AC3 |
| T9 | 발급 부재(가용성→정책 우회 연쇄): fresh session에서 승인이 설치되지 않아 도구 상시 거부 → 수동 bash가 정상 경로화 | prepared-operation 발급 seam(D3) — fresh-session 발급을 실 등록 lsc_confirm execute 캡처 테스트가 회귀 고정 | AC2 |
| T10 | operation confused deputy: 승인 질문의 source/target/mode와 실제 소비 작업 불일치(승인 후 HEAD 이동 포함) | LandOperation scope 결박 + consume 직전 재관찰 일치(D2) + **consume 직후 target branch/OID effect-boundary 재확인 + merge는 승인된 sourceOID로 실행(branch ref 금지 — consume 후 source ref 이동에도 승인된 OID만 merge)**. drift는 소비 전=scope-mismatch 거부·재승인, 소비 후=consumed nonce 상태 명시 거부. 발급 측은 exact approvalQuestion+prepareId 결박(cross-feature prepare 교체 시 무발급) | AC2(wrong-target·왕복)·AC3(mode) |
| T11 | evidence tampering: auditValidated marker만 편집(3필드 유지)해 검증 위조 | marker 권위 강등(D4) — land가 strict 코어(validateLandAuditEvidence — cycle·threshold·fresh passing run-N.log 필수)로 read-only 재검증, marker는 cycle-aware(부재·이전-cycle=WARN, current-cycle 다른 verdict·future-cycle=evidence-tamper 거부) | AC1 |
| T12 | partial land: merge 성공 후 validation/remove/prune 실패로 중간 상태 방치·성공/실패 혼동·abort 실패로 원복 미보장 | 상태 기계 사유 코드(merge-aborted / merge-recovery-failed / merged-but-not-cleaned / cleaned-but-not-pruned — merge/worktree/prune 실제 state flags를 거짓 없이 보고) + **target-dirty preflight(`??` 이외 tracked 변경 한정 — untracked는 git merge 원생 거부 위임)** + conflict 자동 `git merge --abort` 후 **사후 상태 검증(branch/OID/clean — 성공 시에만 "repo 원복" 보고)** + force-clean-only 재승인 경로(merge 생략 — 중복 merge 없음) | AC3 |
| T13 | TOCTOU/resolution swap: 관찰(lstat/realpath/membership)과 git remove 사이 스왑 | 삭제 **직전** 재검사(membership + inspect/evaluate 재실행)로 창 최소화 — 완전 제거 불가, 잔여 위험 명시 수용(아래 비-방어 선언) | AC3(재검사 배선) |
| T14 | missing/미등록 target 성공 혼동: removeWorktree의 missing 성공 no-op(worktree.ts:84-88)이 land 성공 보고로 오인 | land가 `git worktree list --porcelain` membership을 직접 확인 — 미등록/부재는 not-registered isError(no-op 경로 도달 불가) | AC3 |
| T15 | manual escape 정상화: '도구 결함' 판별 없이 수동 merge 상시화 | 스킬 산문 — 도구 결함 시에만·exact base 재확인·fresh `[Land]` 승인 유지·사유를 durable 기록(아래 탈출구 절) | skill-contract 계층 |

## 탈출구 의미론 (R4 contrarian 생존 결정)

- 도구 내 override 플래그 **없음** — 보안 표면 재개방이므로 기각(spec 제약 3).
- 최후 수단은 인간의 직접 `git merge`(수동 bash 복귀) — 스킬 산문이 "도구 결함 시에만"으로 조건을 명문화하고, **예외 사유를 `.lsc/crafts/{feature}/audit/land-manual-escape.md`에 durable 기록**하도록 지시한다(무엇이 결함이었는지·수동 수행한 정확한 명령·exact base 재확인 결과·검증 방법). fresh `[Land]` 승인 확인은 수동 경로에서도 유지. skill-contract가 이 절의 존재를 고정. 도구가 막을 수 없고 막지 않는다: 인간이 궁극 권위라는 R4 결정의 코드-밖 표현.
- '탈출구 없음'은 데드락 위험으로 기각됨 — 도구 버그가 land 자체를 영구 봉쇄하는 상황을 배제.

## 비-방어 선언 (명시적 비목표)

- dirty/locked/submodule 검사 재구현 안 함 — git 원생과의 이중화는 버전 간 드리프트 표면(제약 1). 검증 함수의 음성 확인 테스트(AC4)가 이 경계를 회귀로 고정.
- 적대적 프로세스-내 공격(같은 프로세스에서 슬롯 직접 조작)은 위협 모델 밖 — 인메모리 권위는 release-gate가 확립한 경계.
- **TOCTOU 잔여 위험 수용**: 삭제 직전 재검사와 실제 `git worktree remove` 사이의 심링크/rename race는 원자적으로 제거 불가 — 재검사로 창을 최소화하고 잔여 위험을 명시 수용(비적대·부주의 위협 모델과 정합).
- **audit 산출물 위조는 방어 범위 밖**: land의 audit 재검증(D4)은 사고·드리프트·stale 증거의 검출이 목적 — 적대적 로컬 파일(audit-N.md·run-N.log) 조작 방어가 아니다(인메모리 권위·인간 승인·비적대 모델이 경계).
