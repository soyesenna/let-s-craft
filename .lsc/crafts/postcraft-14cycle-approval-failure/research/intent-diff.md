# Intent Diff — postcraft-14cycle-approval-failure

## What is actually being asked
대상 프로젝트의 `<대상 기능>` feature가 lets-craft 파이프라인(craft↔post-craft 루프)에서 14 audit cycle 전부 REJECT로 끝난 **근본 원인**을 규명하는 것. 원인 후보 공간은 4개 축이 모두 열려 있다:
(a) lets-craft 파이프라인 자체의 구조적 비수렴 (audit 계약이 매 사이클 새 finding을 무한 생성),
(b) 대상 feature의 spec/AC가 달성 불가능하거나 검증 불가능하게 작성됨 ("cache hit rate 85%"류 수치 목표),
(c) 구현 품질 자체의 결함 (정당한 REJECT의 연속),
(d) 감사 방법론 결함 (auditor가 잘못된 것을 검증, check 스크립트 비결정성).

## What a lazy read would assume
"구현이 그냥 나빴다" — 14회 REJECT를 곧이곧대로 구현 결함의 증거로 읽는 것. 이 가정 자체가 검증 대상이다.

## What needs EXTERNAL research (vs. codebase lanes)
1. LLM prompt caching 의미론 (Anthropic/OpenAI/Bedrock): TTL, eviction, prefix 조건 — "85% 캐시 적중률"이 결정론적으로 검증 가능한 AC인가?
2. 프로덕션 LLM gateway에서 hit-rate 측정 관행과 함정 (정규화, per-tenant key 등).
3. 반복적 LLM 비평/심판 루프의 비수렴 병리 연구 (LLM-as-judge, self-refine, finding inflation, 골대 이동).
4. OSS 에이전트 프레임워크·CI 리뷰 봇의 승인 게이트 설계 선례 (반복 상한, severity 예산, hysteresis).
5. 인간 소프트웨어 공정의 리뷰 수렴 장치 (Fagan inspection exit criteria 등).
