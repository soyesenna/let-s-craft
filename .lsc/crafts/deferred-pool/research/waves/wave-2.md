# Wave 2 — Expansion #1 (2026-07-19)

## Roster
| Worker | Role | 결과 |
|---|---|---|
| W2MutationTarget | lsc-explore — D-3 변이 대상 실체 | 완료 |
| W2DoctorSeams | lsc-explore — F-3 재사용 표면 감사 | 완료 |
| W2Countersearch | lsc-librarian — 클레임 3건 반증 패스 | 완료 |

## 핵심 발견

### W2MutationTarget — D-3의 실행 가능 형태 확정
- pre-craft에는 '스텁'이 없음(§0 구현 금지). 유효한 변이 대상 = **브라운필드의 기존 구현 seam**(예: state.ts:224-227 recordTestResult, validate.ts:38-42 splitEffort). 완전 그린필드 = 명시적 `D-3: N/A` 기록.
- full run_test.sh는 feature RED가 정상이므로 **full run의 nonzero로 kill 판정 불가** — baseline-green 독립 서브셋의 failure delta로만 판정(differential targeted proof).
- 실증: release-gate craft-state.test.ts:202-217(배너 위 green baseline / 아래 RED 확장군 분리), model run-1.log(29 fail/19 pass 혼재).
- oracle-mirroring 함정 실증: FakeSessionApi.resolve가 production splitEffort 재사용 → SUT/오라클 동시 변이로 통과 가능. hard-coded assertion 서브셋만 oracle로 사용해야.
- 변이 대상은 hash 보호 범위(test/ descendants) 밖 — manifest와 무충돌 확인(hash-manifest.ts:72-100).
- 계약 예외의 올바른 형태: '구현 작성 허용'이 아니라 **'source bytes의 일회성 임시 변이 + 즉시 원자 복구'**. 시작/변이/복구 후 git diff 청결 확인.

### W2DoctorSeams — F-3 재사용 매트릭스
- **그대로 재사용**: src-hash.ts(computeSrcHash/hashSrcDir/driftWarning — main.ts:94-97 session_start 선례), validate.ts(validatePreset+splitEffort, inject.ts:34-50의 resolver 콜백 패턴).
- **소폭 개조**: worktree.ts에 listWorktrees+porcelain 파서 추가(private git seam 재사용), state 전체 스캔(readdirSync + readPersistedCraftState 조합, stale predicate 신규), gitignore.ts에서 read-only checker 분리(현행 ensure*는 진단 중 파일을 수정해버림 — no-change 계약 위반).\n- **신규**: plugin link 검사(symlink/lock/manifest/entrypoint 분리 검사 + 실행 중 로드 여부는 **UNKNOWN 고정**), frontmatter 파서(yaml dep 재사용, --- 경계 추출 신규), registerDoctorCommand(preset/command.ts:223-250 템플릿).\n- 함정 확인: BUILD_INFO.gitHash(58fa1e9)는 HEAD(92e5d12)와 다르나 srcHash 일치 — hash 검사만으로 빌드 커밋 신선도 판정 불가. agents 물리 9개 vs README·LSC_AGENT_NAMES 8개 불일치 — doctor의 기준 SSOT 결정 필요.\n\n### W2Countersearch — 클레임 판정\n- **C1(doctor non-zero exit) → 약화**: warning 단계 포함 시 반례 다수(clippy 기본 0, swift-format, cfn-lint 옵션 역사). error-severity 한정으로 좁히면 생존. → F-3 설계에 WARN/FAIL 구분 exit 계약 반영(OMC hasConflicts 분리 선례와 정합).\n- **C2(version 필드 불필요) → 약화**: 'the safest default is schemaVersion in every config'(및 K8s/SQLite user_version/사후 추가 비용 문헌). '짧은 수명'은 사후적 추측. → E-3 판단은 파일별 수명의 **내부 사실 확인**(wave 3 N1)에 의존.\n- **C3(단일 변이 유의미) → 강한 약화**: n=1 지지 1차 문헌 전무, n=25-50에서도 50%p 분산(QCRMut), sufficient 최소 기준 수십-수백 배. → D-3은 '스위트 변별력 검증'이 아니라 **'변이 seam 한정 tautology 스모크 감지'**로 프레이밍 격하 필수.\n\n## 미확정 → wave 3 이월\n1. (N1-N3) CraftState/HashManifest 실수명·타 reader 존재 — E-3 전제('업그레이드-중-craft 창')의 실재 검증. 내부 코드 사실.\n\n## 신규 외부 리서치 리드: 0건 (전부 설계 입력 또는 내부 검증으로 전환)\n