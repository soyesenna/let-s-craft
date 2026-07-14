# Claim Graph — ask-tool-enhancement (orchestrator-owned)

상태 어휘: **VERIFIED**(비코드 클레임: 독립 도메인 2+, 관측 그룹 2+, countersearch 1회+, 1차 소스, 시의성 / 코드 클레임: 버전 고정 직접 확인) · **CONFIRMED-CODE**(버전 고정 소스/실험 확인) · **PENDING-COUNTERSEARCH**(1차 소스 확보, countersearch 미실시) · **SINGLE-SOURCE**(주의 표기).

코드 클레임 환경 고정: repo c39a725, SDK 16.4.0 (node_modules), 벤더 16.3.15, 2026-07-14.

| # | Claim | 상태 | 근거 (관측 ID) | 소스 그룹 |
|---|---|---|---|---|
| C1 | SDK 16.4.0 ctx.ui.select는 {label, description?} 옵션을 받고 TUI가 description을 마크다운+자동줄바꿈으로 렌더링한다 | CONFIRMED-CODE | O1, O2, O18, O22 | TracerCodePath + TracerPremise + ExploreUiApi (독립 3그룹, 타입→wire→TUI 전 스택) |
| C2 | select 프리미티브에는 자유텍스트 입력이 없다 — 반환은 기존 label 또는 undefined | CONFIRMED-CODE | O7, O22("Other_escape_NO") | TracerCodePath + ExploreUiApi |
| C3 | 'Other (type your own)' 상시 자유입력은 도구 레벨 조합 패턴이다: 옵션 append → 선택 시 ctx.ui.editor 체인 (벤더 ask 도구 + 공식 문서) | CONFIRMED-CODE | O3, O18, O20, O31 | TracerPremise + ExploreAskTool + 공식 docs/tools/ask.md |
| C4 | lets-craft의 좁힘 지점은 정확히 3곳(zod string[], 포트 인터페이스, resolveSelectOption) — SDK가 아니라 플러그인이 제약 | CONFIRMED-CODE | O5, O17, O18 | TracerCodePath + TracerPremise |
| C5 | 현 fixture(answers.json)는 lsc_select 게이트에서 이미 잠재 결함: 'yes' 응답이 다중단어 옵션에 매칭 불가(undefined→hard error), optionIndex 규칙 부재 | CONFIRMED-CODE (Tier-1 실험 + 직독) | O11, O53 | TracerOrchestration 실험 + 메인 세션 answers.json 직독 (독립 2그룹) |
| C6 | 자유답변 추가는 additive가 아니다 — 정확 라벨 분기 소비자 최소 4곳(post-craft disposition, pre-craft escalation, resolveSelectOption, parseYesNo)의 계약 변경 수반 | CONFIRMED-CODE | O10, O19 | TracerPremise + TracerOrchestration (독립 2그룹) |
| C7 | ui.input의 placeholder는 interactive TUI에서 렌더링되지 않는 dead param이다 | CONFIRMED-CODE | O25 | ExploreUiApi (단일 그룹 — planner가 의존 시 재확인 권장) |
| C8 | ui.confirm은 ['Yes','No'] 2-옵션 셀렉터의 설탕이며 dialogOptions를 무시한다 | CONFIRMED-CODE | O26 | ExploreUiApi (단일 그룹) |
| C9 | RPC/print/ACP 백엔드는 select 옵션 description을 라벨로 축소한다(비인터랙티브 표시 경로에서 description 소실) | CONFIRMED-CODE | O6 | TracerCodePath (단일 그룹) |
| C11 | "짧은 label + 트레이드오프는 description에" 작성 지침은 Claude Code 계보의 모델-대면 프롬프트에 실재 | SINGLE-SOURCE | O39 | 하니스 미러 ask.md (공식 원문 비공개 — issue #10346) |
| C10 | Claude Code AskUserQuestion 공식 스키마 = questions[1-4]{question, header≤12, options[2-4]{label, description}, multiSelect}; 회신 = answers맵 + response?(자유텍스트, "The user responded: …"). **`preview?`는 TS 전용 opt-in(previewFormat 설정 시에만; Python SDK에 없음)** | **VERIFIED** (wave 3 countersearch 완료: 2026 현재 스키마 변경/deprecation 없음 — 행동 변경만; 독립 교차 kirmad/askuserquestion 재구현 + issue #20275) | O36, O37, O38, O40 + wave3 | 공식 문서 2절 + changelog + 독립 재구현 + 이슈 (도메인 4, 그룹 2, countersearch 1회) |
| C12 | **(수정)** 순수 select/search/fuzzy 위젯에 상시 자유텍스트는 없음(관례 = Other choice + 조건부 input 2단계). **유일 병존형 선행 = inquirer-autocomplete `suggestOnly:true`**(Enter=입력 텍스트 확정, Tab=목록 선택). @inquirer/search·InquirerPy fuzzy·terkelg(fallbackAsInput PR 미병합)·dialoguer·fzf 기본은 filter-only. '순수 select + 상시 텍스트 필드' 병존은 선행 없음 | **VERIFIED** (wave 3 countersearch가 반례를 찾아 클레임 자체를 정정 — 정정 후 상태로 잠금) | O41, O42 + wave3 | 5+ 리포 소스 + countersearch 7축 (도메인 7+, 그룹 2) |
| C13 | per-choice description의 렌더 함정: 자동 wrap 부재 시 스크롤 아티팩트; 완화책은 명시적 wrap + 슬라이딩 윈도우. omp는 이미 wrap+ellipsis+compact 처리(O22/O23)라 직접 위험 아님 | VERIFIED-형식완화 (코드 관측 O22가 실질 방어를 확인 — 추가 countersearch 불요) | O43, O44, O22 | inquirer 이슈 3건 + terkelg/clack 소스 + omp 소스 |
| C14 | **(단서 추가)** 쉬운 언어 description 작성 규칙 15항목(WHAT/WHY/장점/단점 구조, 균형 프레이밍 등)은 유지. 단 countersearch 결과 단서: **overload는 비중복 정보량×옵션 수의 곱**(Chernev 2015/Fasolo 2009/Lee 2004) → 옵션당 description 길이 상한(1-2줄/파트, 비중복 정보 3-4개 이하) 필수; **추천 기본값+간결 균형 설명 조합**이 장황한 설명 단독보다 우수 가능(Dinner et al. 2011 — description이 default 효과를 형성/완화, 상보적) | **VERIFIED** (규칙별 1차 2+소스 + countersearch 1회 — 반론은 '길이·복잡도'를 겨냥, '균형 병기 자체'는 반박 안 됨) | O45, O46 + wave3 | PLG+CDC+GOV.UK+NN-g+학술 5편 (도메인 8+, 그룹 2) |
| C15 | **(정밀화)** 타 하니스 비교: 자유텍스트 의미론 3모델 정립 — ① Claude Code/omp 벤더: Other 선택→커스텀 텍스트가 곧 답값(customInput 병렬 직렬화) ② opencode: custom **강제 true**(2026-01-13 커밋으로 모델이 끌 수 없게 격상; header≤30 상향 이력) ③ codex: is_other(질문 단위 bool, 3소스 교차)는 **"None of the above" 거부 옵션** 추가 + 자유텍스트는 별도 상시 notes 채널("user_note: ..." 직렬화). gemini-cli 타입분리는 안티패턴; MCP elicitation은 per-option description 불가; 요구 4종 동시 만족 선행 없음 | **VERIFIED** (wave 3 countersearch: codex TUI 소스 직독 + 공식 README + 제3자 3소스 교차; opencode git 이력 전수) | O47-O52 + wave3 | 소스 직독 6리포 + 스펙 + git 이력 (cline만 여전히 single-source 표기 유지) |
| C16 | 벤더(16.3.15)와 installed(16.4.0)의 드리프트는 timeout API에 한정, select 렌더링 동일 | CONFIRMED-CODE | O28 | ExploreUiApi |
| C17 | recommended 표시는 append-then-strip 원자 패턴이어야 함(" (Recommended)" 접미사가 답변 문자열에 오염되지 않도록) | CONFIRMED-CODE | O30 | ExploreAskTool |
| C18 | fixture 매칭은 질문 태그 prefix 기반이라 옵션 스키마 변경과 독립적으로 안전; 파괴되는 것은 응답 해석 단계 | CONFIRMED-CODE | O14, O34 | TracerOrchestration + ExploreConsumers (독립 2그룹) |

## Countersearch 결과 요약 (wave 3 완료 — 큐 소진)
- C10: 반례 불발견(스키마 안정) + preview TS-only 정밀화 적중 → 정정 반영 완료.
- C12: **반례 발견**(inquirer-autocomplete suggestOnly) → 클레임 정정 후 잠금. lets-craft 설계 함의: 병존형 TUI 선행이 존재하나 autocomplete 형태뿐 — omp select 프리미티브 경로에서는 여전히 Other→editor 체인이 유일한 검증된 길.
- C14: 반론 부분 타당 → 길이 상한·추천 조합 단서 부착 후 잠금.
- C15: codex is_other 의미론 정정(거부 옵션+notes 채널 = 제3 모델) → lets-craft는 omp 벤더와 동일한 Claude Code 모델(customInput 병렬)로 설계할 것; 의미론 혼동은 직렬화 버그 원인.
- 한국어 1차 PDF: 확보 성공(/tmp/gongmun.pdf 텍스트 추출 가능, /tmp/admin_terms.pdf 스캔). 의미론 순화쌍은 O59 웹 1차로 이미 충분 — 종결.
