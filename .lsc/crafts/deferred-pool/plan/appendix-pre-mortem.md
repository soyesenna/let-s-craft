# Appendix — Pre-mortem (deferred-pool, 9 시나리오)

> DELIBERATE 요건(3+). 각 시나리오는 "이 feature가 실패했다면 왜였는가"의 사후 서사 + 방어선. 방어선은 전부 코어 plan의 Step/AC에 배선돼 있다.

## P1 — 발급/결박 seam 결함으로 lsc_land가 태어나면서 죽거나 위험해진다 (iteration 1 오진 교정)

**서사**: iteration 1은 증상(도구 상시 거부→수동 우회 정상화)의 원인을 identity 경로-정규화 차이로 오진했다 — 실제 1차 원인은 **발급 자체의 부재**(ask.ts 발급 가드의 active craft 전제)였고, 어떤 정규화 방어도 발급 없는 소비를 성립시키지 못한다. 2차 위험은 반대 방향: 발급은 되는데 결박이 없어 승인과 다른 target으로 merge된다.
**방어**: ① prepared-operation 발급 seam(D3) — fresh-session 발급이 AC2의 **실 등록 lsc_confirm execute 캡처**로 회귀 고정 ② LandOperation scope 결박 + consume 직전 재관찰 일치(D2) ③ 앵커 identity 재구성(persisted 3필드는 대조 evidence) — 경로 정규화 지점은 후보/decoder seam 1곳 유지.

## P2 — containment 검증의 심링크/realpath 순서 결함으로 우회 성립

**서사**: 검사 순서를 잘못 배열(realpath 해석을 심링크 거부보다 먼저)하면, expectedRoots 밖 후보가 심링크로 안을 가리켜 containment를 통과하거나, 안의 심링크가 밖을 가리켜 다른 등록 worktree를 지운다(N1: realpath 충돌 시 git은 그걸 지워버린다 — isInside가 유일 방어).
**방어**: ① OMC worktree-cleanup-safety.ts:1-118의 검사 순서 보존(인자 sanity → 심링크 lstat → realpath → containment) ② AC4 매트릭스에 심링크 방향 2케이스(밖→안, 안→밖) 명시 포함 ③ 순수 함수라 매트릭스 전수를 vitest로 저비용 고정.

## P3 — doctor가 무언가를 쓴다 (read-only 계약 위반)

**서사**: 구현 중 gitignore 검사에서 기존 `ensureWorktreesGitignored`를 "재사용"하는 유혹 — 이 헬퍼는 읽고-즉시-쓴다 → 진단 실행이 리포를 변경 → "진단 전후 무변경" AC7 위반이 배포 후 발견(사용자 리포가 doctor 실행만으로 dirty).
**방어**: ① read-only 체커를 gitignore.ts에 **별도 함수로 신설**(Step 6 명시 작업 — ensure* 호출 금지가 Must NOT 4) ② AC7에 "진단 전후 파일 무변경" 단언을 해시 대조로 포함 ③ DoctorPorts에 쓰기 함수 자체를 넣지 않음(구조적 차단 — ports 표면이 read 5종뿐).

## P4 — stateVersion이 구버전/기존 fixture를 깨뜨린다

**서사**: 읽기 경로에서 필드 부재를 에러로 처리하거나, 쓰기 각인을 fixture 생성 경로에 빠뜨려 기존 craft-state 테스트·실사용 `.craft-state.json`이 전부 red → AC12(전수 green) 붕괴.
**방어**: ① 부재=관용은 AC9의 명시 케이스(Cargo 준거 N6 — 에러는 오직 `> CRAFT_STATE_VERSION`) ② 각인은 쓰기 경로(writeFileAtomicSync 경유 전부)에서만 — 읽기 경로는 검사만 ③ Step 1b 커밋 게이트가 기존 스위트 전수 green을 강제.

## P5 — R0 대조 검사가 co-evolution 문구와 어긋나 doctor가 상시 FAIL

**서사**: Step 3-5가 SKILL.md 경로 문구를 바꾸는 동안 doctor의 기대 문자열이 하드코딩돼 있으면, 착지 순서에 따라 doctor가 자기 리포에서 FAIL을 뿜는다(exit 1) → "doctor는 신뢰 불가" 낙인.
**방어**: ① C를 마지막 Step으로 배치(산문 확정 후 착지 — Task Flow 순서 강제 근거) ② 기대 문자열 집합은 paths.ts 헬퍼 출력에서 **파생**(하드코딩 금지 — Step 6 명시) ③ AC8의 R0 케이스는 "조작된 fixture에서 FAIL"과 "본 리포에서 PASS" 양방향.

## P6 — force 재승인 경로의 nonce 의미론 붕괴

**서사**: dirty 거부 후 force 재호출이 소비 없이 통과하거나(재승인 무의미), 첫 승인 하나로 force까지 도달(재승인 우회) → "1 승인 = 1 파괴적 시도" 붕괴.
**방어**: ① **순수 preflight 전부 통과 후에만 소비**(게이트 순서 고정 — 검증 실패로 인한 nonce 낭비 없음; 소비 후 효과 실패는 상태 보고로 종결) ② force 경로는 mode=force-clean-only의 **별도 scope 승인 필수** — 초기 merge 승인으로는 도달 불가(기계 구분, D2) ③ AC3가 재승인 후 force 성공과 무승인 force 불가를 함께 고정 ④ `--force` 정확히 1회 전달(locked의 2회 의미론 보존).

## P7 — merge conflict가 projectRoot를 반쯤 병합된 채 방치한다

**서사**: consume이 merge에 선행하므로 conflict 시 nonce는 소진되는데, 자동 복구가 없으면 projectRoot가 conflicted 상태로 방치 — 게다가 target에 선행 dirty changes가 있으면 `git merge --abort`가 정확한 원복을 보장하지 못하고, abort 자체도 실패할 수 있다. "repo 원복"을 검증 없이 보고하면 거짓 성공 보고가 된다.
**방어**: ① merge는 승인된 sourceOID로 실행(`git merge --no-ff --no-edit <sourceOID>`) + Phase R target-dirty preflight(`??` 이외 tracked 변경 한정 선제 거부 — 선행 dirty target에서의 abort 원복 불확실성 자체를 차단; untracked 충돌은 git merge 원생 거부 위임) ② merge 실패/conflict 시 자동 `git merge --abort` 후 **사후 상태 검증(branch=targetBranch·HEAD=targetOID·clean status — abort exit code가 아닌 상태 기준: merge 미시작 거부가 false recovery-failed로 새지 않음)** — 검증 성공=merge-aborted("repo 원복"은 이 경우에만 보고), 검증 실패=merge-recovery-failed(원복 미보장 명시) ③ AC3 conflict fixture가 abort 후 상태 3요소를 단언하고 abort 실패 fixture가 merge-recovery-failed를 고정 ④ conflict의 nonce 소비-손실은 명시 수용(잔여 위험 절).

## P8 — partial land: merge는 됐는데 정리가 실패한 중간 상태

**서사**: merge 성공 후 validation/remove/prune 실패(dirty 포함) — 사용자는 성공인지 실패인지 모른 채 재호출하고, 상태 보고가 없으면 중복 merge·이중 정리를 시도한다. prune 실패까지 침묵하면 잔재 metadata가 남는다.
**방어**: ① 상태 기계 사유 코드 — post-merge validation/remove 실패=merged-but-not-cleaned(merge 완료·worktree 보존 명시), remove 성공 후 prune 실패=**cleaned-but-not-pruned**(merge/worktree/prune 실제 state flags를 거짓 없이 보고) ② 정리 재시도는 mode=force-clean-only 재승인 경로(merge 생략 — 중복 없음; merge-and-clean 재호출도 already-up-to-date no-op으로 안전) ③ AC3가 dirty→merged-but-not-cleaned→force 성공 시퀀스와 prune 실패 fixture를 고정.

## P9 — 관찰/삭제 사이 TOCTOU 스왑

**서사**: preflight 관찰과 실제 remove 사이 심링크/rename 스왑 — containment을 통과했던 경로가 삭제 시점엔 다른 곳을 가리킨다.
**방어**: ① 삭제 **직전** 재검사(membership + inspect/evaluate 재실행) ② 잔여 race는 security appendix에 명시 수용 선언(비적대 모델) — 침묵 가정 금지.

## 잔여 위험 (수용)

- **E 헬퍼의 미관측 레거시 엣지**: 혼합 배치(파일이 projectRoot에만 존재하는 구식 흐름)의 실사용 빈도를 알 수 없음 — 수용 근거: 엣지 델타는 개선 방향(침묵 스킵 제거)이고 주석+테스트로 문서화(제약 8), 정상 흐름은 회귀 green으로 보증.
- **doctor plugin-link 검사의 환경 의존**: 심링크/lock 배치가 개발 환경마다 다름 — 수용 근거: 판정 불가 상태를 UNKNOWN으로 명시 분리(exit 미반영, 제약 5)해 오탐을 구조적으로 흡수.
- **conflict 시 nonce 소비-손실**: 순수 preflight 후 소비라 검증 실패 낭비는 없으나 merge conflict는 소비 후 발생 — 재승인 1회가 비용. 수용 근거: "1 승인 = 1 파괴적 시도" 불변식이 nonce 재사용 허용보다 우선(T6).
- **auditValidated marker 부재 WARN**: producer가 best-effort라 marker 없는 정상 흐름 존재 — live 재검증(D4)이 권위이므로 게이트는 성립, WARN으로 관측만 남긴다.
