# Wave 1 — Saturation (2026-07-19)

## Roster (9 research workers + 참고: trace 레인 5)
| Worker | Role | Agent | 결과 |
|---|---|---|---|
| ResOmpSdk | codebase-facing: omp SDK 표면 | lsc-explore | 완료 — registerTool/registerCommand/이벤트 전수, SessionStopEvent stop-사유 부재 재확인, `session.compacting`(dot) 확정 |
| ResLazycodex | repo-dive: lazycodex | lsc-explore | 완료 — F-3/E-1/E-3/D-3/D-4 원문 검증, R0 `--check` 게이트 lazycodex에 부재(정본 교정) |
| ResOmcGajae | repo-dive: OMC+gajae | lsc-explore | 완료 — A-5/E-2/D-1/D-2/A-4p2 원문 전수, doctor-conflicts.ts 실경로 교정 |
| ResGitWorktree | web: git worktree 의미론 | lsc-librarian | 완료 — remove 거부 R1-R5 전수, A-5 순증분 = feature sanity·containment·심링크·root/home 4종 확정 |
| ResDoctorArt | web: doctor 선행 기술 | lsc-librarian | 완료 — brew/flutter/npm/expo 4종 비교, exit code 계약 차이(★flutter만 0) |
| ResSchemaVer | web: 스키마 버전 관례 | lsc-librarian | 완료 — ★E-3 전제에 도전: 3파일 모두 당장 version 필드 불필요 권고 |
| ResMutation | web: 뮤테이션 프루프 | lsc-librarian | 완료 — 4축 모두 D-3 프로토콜 지지, 격리·단일변이·revert 3단계 게이트 정식화 |
| ResLlmFloor | web: LLM 자기채점 floor | lsc-librarian | 완료 — D-1 전제 강력 지지(7+ 1차 소스), floor 고착 상한 안전장치는 선례 미확인 |
| ResClaimLedger | web: 클레임 원장 | lsc-librarian | 완료 — D-2 4축 지지, 정본-projection 계약이 드리프트 경고의 정석 해법 |

## EXPAND 리드 종합 (분류)

### 해소됨 (wave 1 내부 교차로 닫힘)
- D-1 disputed 라벨링의 LLM 의존 여부 → ResOmcGajae: recorder.ts:501-528에서 답변 교체 시 **기계적** disputed 처리 확인. 닫힘.
- D-2 counterexampleQueries 실행 여부 → ResOmcGajae: validation-only 스키마, 평가기는 미실행. 닫힘(설계 입력).
- omp SDK 관련 전 리드 → ResOmpSdk 전수 응답. 닫힘.

### 설계 입력으로 전환 (추가 리서치 불요 — trace/plan에 반영)
- A-5: containment(isInside)가 유일 방어인 realpath-collision 경로 / dirty·locked 검사 재구현 금지 / prune --expire 설계 결정
- F-3: exit non-zero 관례 채택, expo Promise.all 격리 뼈대 + flutter timeout, groups 태그, --json 이중 출력, applies() 게이트, WARN↔hasConflicts 분리(OMC 선례)
- E-3: ResSchemaVer 권고 — CraftState/HashManifest는 version 불필요(수명·단일 writer), ModelsFile만 조건부 후보. "침묵 오독 금지"는 현행 설계가 이미 충족
- D-3: 3단계 게이트(주입 전 GREEN 확인→주입 후 RED→revert 후 GREEN), 단일 변이, PIT RETURN_VALS 계열, prose no-seam 제한, 격리 worktree가 이미 Altmann 권고 충족
- D-1: reported/effective 병기, superseded_by 해소 규칙, floor 고착 감지기 설계 필요(선례 없음 — 자체 설계)
- D-2: claims.json=정본, SYNTHESIS.md=projection 계약, FEVER 3-label 어휘 차용
- E-1: loose sentinel/비원자 쓰기 교정 여지, paths.ts 재사용 중심
- R0: lazycodex에 --check 원형 부재 — 신규 설계 필요(마커 구간 추출기+바이트 비교기)

### 미확정 — wave 2로 이월
1. D-3 뮤테이션 대상의 lets-craft 실체: pre-craft는 구현 코드를 안 쓰므로 '스텁'이 없을 수 있음(브라운필드는 기존 미수정 구현이 대상). craft 파이프라인에서 프로브가 실제로 무엇을 변이하는지 내부 확인 필요.
2. F-3 검사 항목별 기존 헬퍼 실재성: src-hash.ts driftWarning, gen-version.mjs, preset/validate 재사용 표면과 plugin link 상태 감지 방법의 구체 좌표.
3. 고위험 비코드 클레임 countersearch(클레임 잠금 요건): (a) doctor exit 관례, (b) version 필드 불필요 권고, (c) 단일 변이 프루프의 통계적 의미.
