# Wave 3 — Expansion #2 / Closure (2026-07-19)

## Roster
| Worker | Role | 결과 |
|---|---|---|
| W3ClaimClosure | lsc-explore — countersearch 좁히기의 내부 사실 검증 | 완료, EXPAND: none |

## 판정
- **N1(CraftState 수명)**: '단일 사이클 단기 파일' 전제 **틀림** — clearActiveCraft는 파일을 삭제하지 않고(state.ts:248-251), post-craft가 active 없이 recordAuditCycleBegin/Validated로 같은 파일을 재기록(state.ts:284-326). 재시작/업그레이드 후 파일 잔존 + init 전 창 실재. reader 4경로(init/verify·run-tests/audit/verdict). → **E-3의 '업그레이드-중-craft' 전제는 CraftState에 한해 CONFIRMED.**
- **N2(HashManifest)**: 매 init 전체 재계산·overwrite(hash-manifest.ts:94-100,293-300), snapshot도 재생성 — 정상 resume에 stale schema 계속-읽기 경로 **없음(REFUTED)**. 잔여는 init 전 verify/restore의 transient reader뿐.
- **N3(다른 reader)**: statusbar/notify는 상태 파일 reader 아님(반증). production writer는 persist() 단일 수렴, 단 reader는 다수 — 'single-writer'는 정확, 'single-reader'는 부정확.
- 검증 프로브: targeted 4 test files 92/92 pass.

## 수렴 선언
- 확장 wave 2회(wave 2, wave 3) 완료 + 미확정 리드 0건 → **수렴 조건 충족** (2 expansion waves AND zero unconfirmed leads).
