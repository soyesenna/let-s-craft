# Wave 2 — Expansion wave 1 (2026-08-24)

## Wave 1 EXPAND leads (수집)
- R1: post-craft cycle budget/escalation 부재 — bounded state model 설계 각도. [채택 → 종합 단계 설계 입력]
- R2: NoVerdict 선행 조건 접기 + freeze expected vector provenance. [부분 채택 → W2ProbeOracleObligations]
- R5: severity drift 문헌 부재 → 자체 데이터가 실증원 / commit-before-judge / EIR·ECR 임계 / 고정 cap 비판 3편. [채택 → W2ProbeFixIntroduced, W2LivelockDeep]
- R6: 2607.24604 factorial 재열람 / IAL-Scan / maxTurns 미집행 버그 / severity-끝-출력 레시피 / MAST FM-3 / CodeRabbit 노브. [채택 → W2LivelockDeep; 잔여 low-value 종결]
- R8: IEEE 1028-2008 delta / VIRUPCUS / capture-recapture 적용 / Fagan 1986 원문 / 라운드 미시 역학. [capture-recapture 각도만 유지, 잔여 low-value 종결]
- Lane 판별 프로브 3건 → W2 프로브로 편입.

## Roster (4 workers)
| Worker | Agent | Task |
|---|---|---|
| W2ProbeCheckLogs | lsc-explore | FAIL 로그 red 테스트 (a)/(b)/(c) 분류 |
| W2ProbeFixIntroduced | lsc-explore | c10~14 finding의 fix-introduced 비율 시계열 |
| W2ProbeOracleObligations | lsc-explore | freeze-oracle 축 증명의무 수지 시계열 |
| W2LivelockDeep | lsc-librarian | arXiv 2607.24604 + 2607.05904 원문 심층 |

## 결과 요약
- W2ProbeCheckLogs (method-level blame 최종 보정): 잔여 10로그 테스트케이스 (a)신규 §3.0=8 : (b)기존 파손=40 : (c)하니스=2 → a:b=1:5. 보정 로그 포함 a=11, b=61, c=2. 로그 단위: 순수(a)=4(check2,3,7,8), 순수(b)=2(check4,10), 혼합=2(check17,18), (c)=2(check11,15). check17-19의 adapter 14건은 base dev 기존 테스트(ab32f63507) — **Layer-1 red의 ~83%는 craft의 audit 전 check 1회로 예방 가능했던 파손**.
- W2ProbeFixIntroduced: c10~14 fix-introduced 비율 62.5→80→64.3→81.25→85.7% (보수 71.2% / causality-aware 72.7%) — 하락 없음 → **구조적 트레드밀** 지지.
- W2ProbeOracleObligations: freeze-oracle 축 증명의무 **재생산** 판정 — 요구 축이 상위 경계로 이동 (정규화 함수→좌표 v2/v3→durable→production-effective strata→semantic closure). 유한 종결점 증거 없음.
- W2LivelockDeep: ①"livelock"은 원문 용어 아님 — 실측은 'ON accepted 0/72 + 95.8% 예산 소진'(14B 한정, 복제 스택은 ON에서도 sound 수용 존재). ②liveness 회복의 실증 레버 부재 (cap 상향 −0.23pts ns, 절체 Holm 생존 0, checkpoint는 conformance만). ③commit-first FP 0.719→0.012 (solve 가능 심판 + exact-match 최종답 전제 — 개방형 감사물은 future work).

## EXPAND tail entries
- W2LivelockDeep LEAD 1: audit REJECT 근거 형성 순서 코딩 (expected-state-first vs diff-anchored) — WHY: anchored plausibility 가능성 미검사 — ANGLE: audit-12~14 CRITICAL 코딩. [채택 → wave 3 W3AnchoringAudit]
- W2LivelockDeep LEAD 2: sparse-proposal vs gate-오류-전파 판별 — WHY: fix→신규 CRITICAL 연쇄는 제안 지속 생산을 시사 — ANGLE: fix-유도 vs 재지목 분해. [W2ProbeFixIntroduced가 해소 — fix-유도 지배(71.2%) 확인, 종결]
- 프로브 3건: none — 판별 완료형 프로브 (EXPAND 대상 리드 없음).
