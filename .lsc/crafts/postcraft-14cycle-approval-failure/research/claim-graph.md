# Claim Graph — orchestrator-owned (workers: read-only)
정본은 claims.json — 이 파일은 서술적 projection이다 (역방향 편집 금지). 최종 각인: 2026-08-24T13:48Z, 18/18 accepted.

## Verified set (18/18 accepted — C-01~C-18 상세는 claims.json·SYNTHESIS.md 참조)

| ID | 요지 | 승격 근거 (≥2 독립 도메인 / 관측 그룹) |
|---|---|---|
| C-01 | 15/15 REJECT | audit 파일 grep 전수 + .craft-state.json (2 관측 그룹) |
| C-02 | post-craft 사이클 상한 부재 (pre-craft/craft와 비대칭) | SKILL.md 문언 + verdict.ts 코드 + R1 git 이력 (3) |
| C-03 | craft finding 소비율 ~100% — 불복종 반증 | 커밋 태그 대응 + audit 이행표 (2) |
| C-04 | 완전 해소율 천장 ~52% + fix→신규 CRITICAL 연쇄 | Lane2 집계 + Lane5 가계 추적 + audit 3개 파일 독립 자인 (3) |
| C-05 | F14-1은 루프 밖 인간 결정 항목 (base drift) | audit-14 당사자 진술 + git ls-tree 독립 실증 (2) |
| C-06 | 검증 방법론 결함의 실질 기여 (check-15 artifact, §3.0 자기 결함, F14-10 소급, M7 허위 CRITICAL) | audit 원문 당사자 진술 + 로그 대조 (2) |
| C-07 | AC-08/09 live 판정 루프 내 실행 불가 → 대리 게이트가 CRITICAL 과반 생성 | Lane4 문서 계보 + R2 코드 실증 (2) |
| C-08 | 85% 캐시 적중률은 결정론적 검증 불가 (provider best-effort) | 4 provider 공식 문서 + 게이트웨이 생태계 문서 (R3+R4, 다 도메인) |
| C-09 | 비평 루프 1~3회 후 정체/악화, 적대 지시→위양성↑, 심판 승인=Goodhart, 과도 게이트=livelock | arXiv 다수 독립 논문 (R5) + 2607.24604 (R6) — countersearch: R5가 반대증거(수렴 사례) 탐색 후 부재 확인 |
| C-10 | OSS 바운딩=다층 상한+명시 정책; 동일-지적 감지는 OpenHands 유일 | R7 저장소 파일 수준 인용 (6 저장소) |
| C-11 | 인간 공정 수렴 장치 4종; 기준 creep·검사자 분산이 측정 무효화 2대 모드 | IEEE 1028 원문 + Fagan 2002 + Porter 1998 + Google 2018 (4 독립) |
| C-12 | §2.6 full-audit 반복 + §4.2 생존 CRITICAL → AWC 경로 0회 진입 | SKILL.md 문언 + 15개 audit 헤더 (2) |
| C-13 | Layer-1 red의 ~83%는 기존 테스트 파손 (예방 가능 낭비) | check 로그 method-level blame + audit-14 교차 (W2ProbeCheckLogs) |
| C-14 | fix-introduced 비율 62.5→85.7% 상승 — 구조적 트레드밀 | 66건 git 대조 (W2ProbeFixIntroduced) |
| C-15 | freeze-oracle 증명의무 재생산 — 유한 종결점 없음 | audit-11~14 전수 시계열 (W2ProbeOracleObligations) |
| C-16 | liveness 회복의 실증 레버 부재; commit-before-judge가 최강 개입 | 원문 2편 정독 (W2LivelockDeep) |
| C-17 | 감사 근거 83.6% 코드-선행형 + 오인용 7/10 — commit-first 부재 | 55건 코딩 (W3AnchoringAudit) |
| C-18 | 순차 무상한 루프 수렴 실측 부재; 병렬 멀티패스+집계가 실증 레버 | countersearch 3축 (W3Countersearch) |

## Pending
(없음 — wave 3에서 전부 해소. 수렴 선언: waves/wave-3.md)

## Code verification
- git 판별 수행: ls-tree V82/V83 (Lane2), 실패 메서드 blame (W2ProbeCheckLogs), finding↔fix 커밋 대조 (W2ProbeFixIntroduced) — 전부 CONFIRMED.
- 이 진단에서 코드 실행 판별 대상 없음 — git 읽기/grep 판별은 Lane2(ls-tree V82/V83)·W2 프로브가 수행 (verification-economics.md 참조).
