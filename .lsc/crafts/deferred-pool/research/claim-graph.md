# Claim Graph — deferred-pool (orchestrator-owned)

> verified 진입 조건(비코드): 독립 소스 도메인 ≥2, 독립 관측 그룹 ≥2, countersearch ≥1, 1차 소스, 시의성.
> 코드 클레임: CONFIRMED/REFUTED/PARTIAL (환경: repo HEAD 92e5d12, macOS, git 2.37.2 로컬 / 문서 기준 2.43+, SDK @oh-my-pi/pi-coding-agent 16.4.0).

## 코드 클레임 (직접 검증)

| ID | 클레임 | 판정 | 근거 |
|---|---|---|---|
| K1 | deferred-pool.md의 리포 상태 서술 10건 전부 정확, stale 0건 | CONFIRMED | LanePremiseAudit 10/10 file:line 대조 + git log 37커밋 역방향 검증 |
| K2 | `[Land]` 태그 발급 인프라 완비, 소비자만 부재 (T-1 잔여 작업 = 소비자 배선) | CONFIRMED | destructive-approval.ts:22, release.ts:24(RELEASE_CONSUMABLE_TAGS에 [Land] 미포함), release.ts:54-88 소비 템플릿 |
| K3 | SessionStopEvent에 stop 사유 필드 구조적 부재 (C-2p2 원안 분류기 불가) | CONFIRMED | shared-events.d.ts:83-91 + 이웃 이벤트 reason 보유 대조 + runner.d.ts:48-49,85 |
| K4 | removeWorktree는 existsSync만 검사하는 fail-open 래퍼 (A-5 갭 실재) | CONFIRMED | worktree.ts:84-93 |
| K5 | 두 root-해석 함수는 동일 알고리즘 아님 (T-2 통합은 순수 additive 아닌 의미 변경 수반) | CONFIRMED | state.ts:345-351(후보 추측) vs verdict.ts:163-166(존재 분기) |
| K6 | E2E green 기준선 부재 (D-1 캘리브레이션 선행 조건 미충족) | CONFIRMED(정황 5종 수렴) | CI 부재+test/logs 부재+npm test 14 skip+e2e-helpers 실패 서술+green 커밋 부재. 직접 실행 미수행(비용) |
| K7 | lazycodex에 R0 원형(--check 마커 바이트 게이트) 부재 — R0는 신규 설계 | CONFIRMED | ResLazycodex 전수 검색: full-string toBe 테스트/sync 변환 마커만 실존 |
| K8 | 레퍼런스 3리포 인용 파일·메커니즘 전부 실재 (경로 2건만 교정: doctor-conflicts.ts는 src/cli/commands/, model-catalog.json은 plugins/omo/ 직하) | CONFIRMED | ResOmcGajae·ResLazycodex 직접 read + 원천 테스트 실행(9/9, 54/54, 7/7) |
| K9 | D-3의 변이 대상은 '스텁'이 아니라 브라운필드 기존 구현 seam; full run RED로는 kill 판정 불가(differential 필요); 변이 대상은 hash 보호 밖 | CONFIRMED | W2MutationTarget: SKILL.md:10,350-366, release/model 실사례, hash-manifest.ts:72-100 |
| K10 | F-3 재사용 표면: src-hash·validatePreset 즉시 재사용, worktree list·state 스캔·gitignore 체커 소폭 개조, plugin link·frontmatter 파서·registrar 신규 | CONFIRMED | W2DoctorSeams file:line 전수 |

## 비코드 클레임 (verified 세트)

| ID | 클레임 | 상태 | 소스 도메인 | countersearch 결과 |
|---|---|---|---|---|
| N1 | git worktree remove의 원생 거부는 R1-R5이며 --force로 R1/R2/R4는 불가침; A-5 순증분은 인자 sanity·containment·심링크·root/home 4종 | **verified** | git-scm man + git/git 소스(2도메인·2관측군) | 해당 없음(코드 준거) |
| N2 | 게이트 사용 가능 doctor의 exit 계약: **error-severity 발견 시 non-zero, WARN-only는 0** (좁힌 형태) | **verified(좁힘)** | brew/npm/expo 소스 + clippy/swift-format/cfn-lint 반례 | C1 약화 → 좁혀서 잠금. WARN/FAIL 구분이 설계 요건으로 승격 |
| N3 | LLM 자기채점 앵커링·과신은 정량 실증된 현상이며 max(reported,floor)는 산업 표준 패턴의 특수화 | **verified** | Nature MI/ACL/ICLR/EMNLP + DSPy/Inspect/Guardrails/LangGraph | floor 고착 '상한 안전장치'는 선례 부재 — 자체 설계 필요로 기록 |
| N4 | 반박-우선 기각 기본값·단조 상태 전이·정본-projection 분리는 D-2 설계의 정석 근거 | **verified** | Lakens/PNAS + FEVER/TACL + CALM/EventSourcing | 한계 병기: LLM 오라벨 우회(비적대 한정 하한으로 프레이밍) |
| N5 | 단일 변이 프루프는 스위트 변별력의 유의미한 검증이 **아니다** — 변이 seam 한정 tautology 스모크로만 유효 | **verified(역방향)** | QCRMut/TOSEM/Learning-from-Mutants 정량 | C3 countersearch가 원 프레이밍을 강하게 약화 — D-3 계약 문구에 반영 필수 |
| N6 | durable 파일 version 필드 필요성 (파일별 상이) | **verified(잠금, wave 3)** | npm/Terraform/Cargo/ESLint + K8s/SQLite countersearch + 내부 코드 검증(W3ClaimClosure) | 최종: **CraftState의 upgrade-during-craft 창·다수 reader 노출 CONFIRMED**(clearActiveCraft 파일 미삭제, post-craft 재기록, reader 4경로) → 좁은 대상 후보. **HashManifest 정상 resume gap REFUTED**(매 init 전체 재계산; 잔여는 init 전 verify/restore transient reader). ModelsFile은 content-shape 무모호 유지 시 연기 |
| N7 | doctor 출력·격리 관례: expo Promise.all+per-job try/catch 뼈대, flutter timeout·4단 시각, brew 서문·Finding 구조·--json, WARN↔fail 분리(OMC) | **verified** | 4개 도구 소스 직접 판독 + OMC 로컬 | flutter exit-0은 반례가 아니라 '게이트 비사용 설계'로 분류 |

## 기각/교정된 클레임
- ~~"F-3: agents 8종 frontmatter 파싱"~~ → 물리 9종(critic-recheck 8bfac8d 추가). 문서 stale. 검사 대상 SSOT 결정은 인터뷰/plan으로.
- ~~"E-3 원천 = durable 파일 스키마 마이그레이션"~~ → 원천은 Codex 모델 프로필 마이그레이션. E-3는 봉투+명시 에러의 신규 설계.
- ~~"D-3 = 스텁에 오답 주입"~~ → pre-craft에 스텁 없음. 브라운필드 기존 seam의 일회성 변이로 재정의(K9).
- ~~"reference-insights E-2 확장 = OMC atomic-write가 영수증까지 제공"~~ → OMC 파일에는 원자성만. 영수증/원장은 합성 서술.
