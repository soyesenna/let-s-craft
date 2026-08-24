# Research SYNTHESIS — postcraft-14cycle-approval-failure

> claims.json(정본, 18/18 accepted @2026-08-24T13:48Z)의 projection. 역방향 편집 금지.
> 조사 대상: 대상 프로젝트 `<대상 기능>` (craft→post-craft 루프, audit cycle 0~14 전부 REJECT).

## 1. 사실 기반 (무엇이 일어났나)

15회 감사 전부 REJECT였다 [Source 1: C-01 — audit grep 전수 + .craft-state.json]. 기간 5.33일(08-13~08-19), 커밋 174개, findings 약 209건(집계 방식에 따라 204~216), check 19회 중 13회 FAIL. craft는 지시받은 finding을 사실상 전량 소비했고(참조율 ~100%) 어떤 감사도 미이행을 REJECT 사유로 들지 않았다 [Source 2: C-03 — Lane2 커밋↔finding 대응]. 즉 이 실패는 실행자의 불복종이 아니다.

## 2. 4중 원인 구조 (검증된 주장)

### 2-1. 계약 축 — post-craft에만 수렴 장치가 없다
post-craft 계약에는 사이클 상한이 없고("No cycle cap" — SKILL.md:266-268), 유일한 장치는 cycle≥3의 판정-무영향 WARN이다. pre-craft(cap 10 + 에스컬레이션)·craft(re-entry cap 1)와 비대칭 [Source 3: C-02]. §2.6은 REJECT 후 무조건 full 재감사를 강제하고, §4.2(any-lane REJECT/생존 CRITICAL→REJECT) 아래 cycles 9~14 전부 생존 CRITICAL이 있어 AWC 축소 경로는 0회 진입됐다 [Source 4: C-12]. E2E fixture는 audit-0 1회만 검증 — 반복 사이클은 미시험 영역이었다 (R1).

### 2-2. 요구 축 — 검증 불가능한 헤드라인 AC가 대리 게이트를 강제했다
"85% 캐시 적중률"은 어느 provider에서도 결정론적으로 달성·검증 가능한 목표가 아니며 — 4사 공식 문서 전부 best-effort 명시, countersearch에서 오히려 강화됨("Repeated prompt content alone does not guarantee a cache hit" — OpenAI) [Source 5: C-08, Source 6: C-18]. spec의 AC-08/09(live 85% 판정)는 루프 안에서 실행 불가였고(live probe 15사이클간 0회), 그 간극을 메운 결정적 대리 게이트(freeze oracle/wire identity)의 충실성 증명이 audit 11~14 CRITICAL 과반을 생성했다 [Source 7: C-07]. 이 대리 게이트의 증명의무는 단조 감소가 아니라 **재생산**됐다 — 요구 축이 정규화 함수→좌표 v2/v3→durable coordinate→production-effective strata→semantic closure로 상위 경계로 이동, 14사이클 내 유한 종결점 증거 없음 [Source 8: C-15].

### 2-3. 동역학 축 — 트레드밀이지 유한 재고가 아니다
완전 해소율은 한 번도 100%가 아니었고(36~69%), fix→신규 CRITICAL 연쇄가 후기 4사이클 연속 발생 [Source 9: C-04]. finding의 fix-introduced 비율은 62.5→80→64.3→81.25→85.7%로 상승 (전체 71.2%) — 비수렴의 1차 동역학은 감사-표면 상호작용(구조적 트레드밀)이다 [Source 10: C-14]. 문헌도 일치: 반복 비평 루프는 1~3회 후 정체/악화, 적대적 비평 지시는 위양성 상승, 심판 승인 종료 조건은 Goodhart 함정 [Source 11: C-09]. 순차·무상한 적대 루프의 수렴 실측은 부재하고, '더 많은 감사'의 실증 레버는 병렬 멀티패스+집계뿐이다 [Source 6: C-18].

### 2-4. 측정 축 — 검증 장치 자신이 REJECT를 제조했다
Layer-1 red 테스트케이스의 ~83%는 기존 테스트 파손((a)8:(b)40:(c)2) — craft가 audit 전 check 1회로 예방 가능했던 낭비 [Source 12: C-13]. check-15 FAIL은 감사 lens의 Gradle 동시 실행이 만든 artifact, check-17/18은 §3.0 자신이 저작한 테스트 결함, F14-10은 spec 소급 변경(기준 이동) [Source 13: C-06]. audit 근거 형성 순서 코딩: E9:D0:M46 — 순수 diff-anchored 오판은 없지만 83.6%가 코드 증거 선행형이고, 인용 표본 10건 중 7건이 전면/부분 오인용(존재하지 않는 spec/plan 요구 인용) — commit-first 구조 부재가 anchoring 위양성 위험을 열어뒀다 [Source 14: C-17]. 최종 REJECT의 CRITICAL 4건 중 순수 구현 결함은 2건뿐이고, 최상위 CRITICAL F14-1(Flyway 이중 점유, dev 152커밋 drift)은 루프가 자력으로 닫을 수 없는 인간 통합 결정 항목이었다 [Source 15: C-05].

## 3. 수렴 장치의 선례 (해결 방향 입력)

- 인간 공정: 사전 고정 exit criteria(Fagan), 변경 범위+부작용 스코프 재검사(IEEE 1028 §6.5.5.6), 재검사 진입 전 anomaly 전량 해결(§6.4.3(e)), capture-recapture 잔여 추정. 기준 creep·검사자 분산이 측정 무효화 2대 모드. 반복 자체는 탐지를 안 늘린다(Porter 1998) [Source 16: C-11].
- OSS: 다층 상한 + 상한 도달 시 명시 정책(폐기/최선안 채택/에스컬레이션); 동일-지적-반복 감지는 OpenHands stuck detector가 유일 선례 [Source 17: C-10].
- 문헌의 최강 개입: commit-before-judge (FP 0.719→0.012, TPR 97%) — 단 solve 가능 심판 + exact-match 최종답 전제, 개방형 감사물은 future work. cap 상향 단독은 효과 없음(caps rarely bind) [Source 18: C-16].

## 4. 한 문단 결론

14-cycle 미승인은 단일 결함이 아니라 **상한 없는 계약(C-02/12) × 검증 불가능한 헤드라인 AC가 낳은 대리 게이트의 증명의무 재생산(C-07/15/08) × fix-introduced 트레드밀(C-04/14) × 검증 장치의 자기 오염(C-06/13/17)**의 합성이며, 마지막 사이클의 지배 CRITICAL은 루프 밖 인간 결정 항목(C-05)이라 cycle 15+를 돌려도 구조적으로 REJECT가 지속될 상태였다. 이는 문헌이 예측하는 정확한 패턴이다(C-09/16/18).

## Sources
1. C-01 ← Lane3MeasurementPremise (audit-0..14.md), 메인 세션 (.craft-state.json)
2. C-03 ← Lane2OrchestrationState (git 커밋↔finding 대응)
3. C-02 ← R1DesignHistory (skills/post-craft/SKILL.md:266-268), Lane1 (src/craft/verdict.ts:277-282)
4. C-12 ← Lane1PipelineContract (SKILL.md:77-79 §2.6, audit 헤더 전수)
5. C-08 ← R3PromptCaching, R4HitRateMeasure (Anthropic/OpenAI/Bedrock/Gemini 공식 문서, 게이트웨이 생태계)
6. C-18 ← W3Countersearch (arXiv:2605.12280, 2509.01494, 2407.21787; provider 문서 재독)
7. C-07 ← Lane4SpecAchievability, R2TargetSubject (<게이트 평가기>), Lane3 M10
8. C-15 ← W2ProbeOracleObligations (audit-11~14 freeze/oracle finding 전수 시계열)
9. C-04 ← Lane2, Lane5FindingDynamics (audit-12:246/13:263/14:433)
10. C-14 ← W2ProbeFixIntroduced (66건 fix/existing/doc 분류)
11. C-09 ← R5CritiqueLoops (arXiv:2303.17651+2305.13829, 2310.01798, 2508.12358, 2210.10760, 2607.05904), R6 (2607.24604)
12. C-13 ← W2ProbeCheckLogs (13개 FAIL 로그 method-level blame)
13. C-06 ← Lane3 M2/M3/M4/M7 (audit-13/14 당사자 진술)
14. C-17 ← W3AnchoringAudit (55건 코딩 + 표본 10건 인용 대조)
15. C-05 ← Lane2 (git ls-tree 실증), Lane3 M5 (audit-14:432,469,486)
16. C-11 ← R8HumanExitCriteria (IEEE 1028-1997 원문, Fagan 2002, Porter 1998, Google ICSE-SEIP 2018)
17. C-10 ← R7OssGates (OpenHands/SWE-agent/ACR 파일 수준 인용)
18. C-16 ← W2LivelockDeep (arXiv:2607.24604v1, 2607.05904v1 원문 정독)
