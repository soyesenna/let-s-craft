# Wave 2 — 확장 웨이브 1 (완료)

## Roster
| Worker | Agent | Axis | 결과 |
|---|---|---|---|
| LibKoreanPlain | lsc-librarian | 한국어 쉬운 언어(공공언어) 규칙 | 한국어 고유 체크리스트 10항목 + 법·제도 근거(국어기본법 14조, 시행령 11조, 국립국어원 6대 원칙, 명사형 종결 회피, 순화 대체표, 서울시 조례 3원칙, 경어체) |
| ExploreOtherFlow | lsc-explore | 벤더 ask 도구 Other-flow 엣지 시맨틱 | editor Esc→select 복귀(continue), 질문 취소는 select Esc만(ToolAbortError); multi는 Other+checked 병존(single은 클리어); **다중질문 포매터가 customInput 우선으로 checked 누락하는 비대칭(벤더 결함, 복제 금지)**; timeout 자동선택=하이라이트 옵션 resolve+"(auto-selected after timeout)" 직렬화; 결과 텍스트 템플릿 전문 확보 |

## 신규 관측 (observation-manifest 추가분)
- [O55] editor Esc는 select 복귀(ask.ts:537-538, 606-607 continue), 질문 취소는 select 자체 Esc(choice===undefined → ToolAbortError, ask.ts:811-814). — ExploreOtherFlow, Tier-2.
- [O56] multi에서 Other 입력은 checked 옵션과 병존(selected Set 보존, ask.ts:540-541,555); single은 customInput 시 selectedOptions=[] 클리어(ask.ts:609-611). 단일질문 포맷은 둘 다 표시(ask.ts:825-839), 다중질문 포매터는 customInput 우선으로 checked 누락(ask.ts:630-632) — 비대칭 결함. — Tier-2.
- [O57] timeout: hook-selector가 만료 시 현재 하이라이트 옵션을 resolve(비활성 시 cancel), ask 폴백 getAutoSelectionOnTimeout은 recommended→options[0] 순, 항상 1개(ask.ts:136-143). 직렬화에 "(auto-selected after timeout)" 접미사 + details.timedOut. — Tier-2.
- [O58] 결과 텍스트 계약: "User selected: <a>, <b>" / "User provided custom input: <text>"(멀티라인은 2-스페이스 들여쓰기) / 혼합 시 두 줄 병기 / 다중질문은 "User answers:\n<id>: ..." — Tier-2.
- [O59] 한국어 쉬운 언어 규칙 10항목(순화·한자식 어미 회피·서술식 종결·50자 이내·능동·사용자 입장·괄호 원어 병기·비권위·경어체 통일·중복 회피), 법·제도 1차 근거 부착. 경어체 명시 권장 여부만 1차 PDF 미확보(caveat). — LibKoreanPlain, CONFIRMED(대부분)/single-source(경어체 권장 주체).

## EXPAND 처리
| Worker | Lead | 처리 |
|---|---|---|
| ExploreOtherFlow | (보고서 EXPAND 섹션 참조 — 벤더 비대칭 결함 회피 등) | 설계 제약으로 spec/plan에 이관 — 종결 |
| LibKoreanPlain | 국립국어원 1차 PDF 본문 미확보(6대 원칙 워딩·경어체 권장·50자 수치의 정부 출처) | wave 3 CounterSearchSchema에 보조 타깃으로 배정 |
| LibKoreanPlain | 행정용어 100·일본어투 50 전체 목록 | 도구 description은 규칙 요약만 인코딩(전체 사전 불필요) — 보조 타깃, 미확보 시 종결 허용 |
| LibKoreanPlain | 경어체 톤 결정 | 리서치 아님 — 인터뷰/plan의 제품 톤 결정으로 이관 |

→ wave 3: claim-graph의 countersearch 큐 4건 + 한국어 1차 PDF 보조 타깃.
