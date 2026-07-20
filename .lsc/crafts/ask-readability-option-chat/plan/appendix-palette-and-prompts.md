# Appendix — Palette, Keymap, Prompts, Schema, Cache Probe (OQ 2/3/5/6/7 상세)

> Core는 `plan.md` §Open Questions에 1줄 결론+포인터. 여기는 구현용 구체값.
> [Cn] = claims.json 순서. vendored oh-my-pi 17.0.5(HEAD 39c95e5e) file:line 인용.

---

## 1. 컬러 팔레트 (OQ3, Constraint 14, [C17])

**적응 규칙:** 라이트/다크는 `Theme.isLight`(theme.ts:1528-1534, statusLineLuminance>0.5)로 분기 — **`getColorMode()`는 쓰지 않는다**(그것은 truecolor/256color capability, theme.ts:1271,1669-1671). `getColorMode()==="256color"`일 때만 24-bit RGB를 xterm-256 근사로 폴백. 임의 24-bit ANSI는 렌더 파이프라인이 보존(wrapTextWithAnsi/truncateToWidth ANSI-aware, utils.ts:157-180; natives index.d.ts:1590-1605; [C17]).

**위계 매핑 (9역할) — lets-craft 브랜드 팔레트(제안치 — exact RGB는 테스트 계약이 아니며[D4], craft에서 불변식 테스트 하에 튜닝):**

| 역할 | 다크(다크 bg) RGB / SGR | 라이트(라이트 bg) RGB | 굵기/속성 | 256 폴백(다크/라이트) |
|---|---|---|---|---|
| 질문 제목 | #E6C384 (warm gold) | #7A5A00 | bold | 179 / 94 |
| 옵션 label | #8FBCE6 | #005B99 | bold | 110 / 25 |
| 포커스 label | #F5A742 (accent) | #B25E00 | bold + reverse 여백 | 214 / 130 |
| 옵션 설명 | #A8B0B8 (muted) | #48525C | normal | 145 / 240 |
| 푸터 키 힌트 | #6C757D (dim) | #8A929A | normal | 242 / 246 |
| 채팅 질문(에코) | #7FB894 (green) | #2E7D4F | italic | 108 / 29 |
| 채팅 답변(에이전트) | #D0D6DC | #22282E | normal | 253 / 235 |
| 에러 상태 | #FF6B6B | #C0392B | bold | 203 / 160 |
| 구분선/보더 | #3A3F44 | #C9CDD2 | — | 237 / 251 |

**SSOT:** 위 24-bit role table이 정본(SSOT)이며, 256 폴백 열은 결정론적 근사 함수로 파생한다 — 동일 역할의 두 표현(24-bit/256)을 별도 하드코딩으로 유지하지 않는다.

**대비 목표:** 본문(설명/답변) fg는 명시한 reference light/dark background 대비 ≥ 4.5:1, bold/제목/label은 ≥ 3:1 지향. 정확한 bg는 호스트 소관이라 미지 — isLight 변형으로 명암 방향을 맞춘다. **모드별 불변식 테스트**(AC5.2, D4 재비준)는 **역할 매핑·구분·적응의 회귀 증거**이고(exact 색값 비계약), 대비 수치는 **명시한 reference light/dark background에 대한 proxy**다(실제 미지 host background 전체에 대한 증명이 아님). 팔레트는 `src/ask-ui/palette.ts`가 SSOT.

**주의:** 굵기·색 대비·여백·구분선만으로 '크기감' 구현. OSC 66/DECDWL 미사용(AC5.3, Constraint 15).

---

## 2. 키맵 (OQ2, Constraint 11)

**전제:** custom<T>는 fresh `KeybindingsManager.inMemory()`를 factory에 주입받고(extension-ui-controller.ts:998-1018), Component.handleInput은 raw terminal `data:string`을 받는다(tui.ts:145-158(handleInput :157),2412-2419). 즉 **우리 컴포넌트가 모든 키를 소유** — 진짜 호스트 키 충돌은 없다. 관건은 호스트 selector 관례(hook-selector.ts:640-680: ↑↓ nav / Enter 선택 / Space는 검색모드에서만 / PgUp·PgDn·Tab 직접 분기 없음)와의 근육기억 일관성 + 내부 서브모드 모호성 제거.

**browse 서브모드(기본):**

| 키 | 동작 |
|---|---|
| ↑ / ↓ (up/down) | 포커스 이동 |
| PgUp / PgDn | 목록/설명 스크롤 |
| Enter | 포커스 옵션 선택 / confirm |
| Space | 체크 토글(멀티선택만) |
| `?` | 원버튼 상세(포커스 옵션, 질문 자체는 question header focus(canonicalCursor=-1) 시) |
| `t` | 자유 프롬프트 채팅 진입 |
| `/` | FuzzyText 검색 서브모드 진입(**mandatory baseline parity** — 기존 HookSelector 검색 대체) |
| Esc | 질문 취소(현행 동작) |

**chat 서브모드(패널 열림):**

| 키 | 동작 |
|---|---|
| (에디터 포커스) 인쇄 문자 | 프롬프트 입력 |
| Enter | 프롬프트 전송(멀티턴) |
| Esc (단계적) | ① 에디터 포커스 → 패널로 blur; ② 패널 → 닫고 목록 복귀(질문 생존); ③ 목록 → 질문 취소 |

**search 서브모드(`/` 진입 시, mandatory):** 인쇄 문자=검색어(label+description fuzzy filter, original-index mapping, checked state 유지, empty result, backspace/clear), `?`/`t` 비활성(모호성 제거), Esc=검색 종료(Esc-to-browse). `matchesKey(data, keyId)`(keys.ts:547-549)로 키 판정, KeyId enter/up/down/pageUp/pageDown/space(keys.ts:139-177) 사용.

**상태 전이(정본):**

```text
outer state owner는 mode, returnMode, canonicalCursor, checkedIndices, optionScroll,
descriptionScrollByTarget, searchQuery, askDraft/askCursor, sideSession, activeTurnId를
custom mount 전체 수명 동안 소유한다. view 전환은 이 owner를 재생성하지 않는다.
select/confirm: question header는 option row가 아닌 canonicalCursor=-1 focus target이다.
첫 option에서 Up→question, question에서 Down→첫 option; header에서 Enter/Space는 no-op,
?/t는 question target에 작동한다.
ask: printable ?/t는 editor 입력으로 전달한다. Esc 1회는 draft/cursor를 보존한 채
question-header focus로 이동하고, header의 ?/t가 side chat을 열며, Enter/Down은 editor로
복귀하고 header에서 Esc 2회째만 질문을 취소한다. side panel 종료 시 returnMode로 복귀한다.
/ search는 optional이 아니라 mandatory baseline parity다. label+description fuzzy filter,
original-index mapping, checked state, empty result, backspace/clear, Esc-to-browse를 보존한다.
```

마운트 시 초기 포커스는 recommended ?? 0의 옵션 행이며 question header가 아니다. ask의 2단 Esc(에디터→header→취소)는 현행 1단 Esc 대비 의도된 UX 변경이며, 폴백(ctx.ui.editor) 경로는 현행 1단 Esc를 유지한다.

**충돌 검사 방법론:** statusbar TOGGLE_CHORD 선례(src/statusbar/index.ts:41-43)와 동형 — 우리 컴포넌트는 full-focus라 호스트 chord와 물리 충돌은 없지만, `?`/`t`가 검색 서브모드와만 겹치므로 검색을 `/` 게이트 뒤에 두어 browse에서 command 키를 무모호화. 푸터 상시 힌트: `↑↓ 이동 · Enter 선택 · Space 체크 · ? 상세 · t 채팅 · / 검색 · Esc 뒤로`.

---

## 3. 원버튼 상세 고정 프롬프트 (OQ5, Constraint 8, [C13])

**시스템 프롬프트(비공백, no-tools 리마인더 — Codex 400 가드):**
```
You are assisting a user who is answering a multiple-choice question inside the
lets-craft pipeline. Explain clearly and concisely so they can decide.
You have NO tools and cannot run commands or call functions — answer directly
from the provided context. Be concrete: what it means, when to choose it, and
its main tradeoff versus the alternatives.
```

**유저 프롬프트 — 옵션 대상:**
```
Question:
<질문 제목 verbatim>

Options:
- <label 1>: <description 1>
- <label 2>: <description 2>
...

Explain the option "<focused label>": what it does, why one would choose it,
and its main tradeoff versus the other options. Keep it under ~150 words.
```

**유저 프롬프트 — 질문 자체 대상(변형):**
```
Question:
<질문 제목 verbatim>

Options:
- <label i>: <description i> ...

Explain this question: what is being decided, why it matters, and how the
options differ, so I can choose. Keep it under ~150 words.
```

**자유 프롬프트 채팅:** 시스템 프롬프트는 위와 동일(no-tools 유지), 유저 메시지는 사용자 자유 입력. 멀티턴 히스토리는 패널 내부 messages[]에 누적(프리픽스 불변 — 캐시 조건). **자유 프롬프트 턴에는 길이 상한 지시가 없다(심층 경로, R4). 상한 문구는 원버튼 유저 프롬프트에만 있으므로 시스템 프롬프트 프리픽스는 모드와 무관하게 불변이다(캐시 조건 유지).**

**히스토리 스냅샷 주입:** ctx.sessionManager.getBranch()(session-manager.ts:1715-1717) 스냅샷을 직렬화해 side 호출 messages 앞에 실음(Constraint 6, /btw 충실도). 질문/옵션 텍스트는 위 유저 프롬프트에 포함. SideChatSession은 질문당 최초 side interaction에서 정확히 한 번 생성하며 nonce/sessionId/promptCacheKey/model/systemPrompt/canonicalized getBranch snapshot을 freeze한다 — panel close/reopen·turn·retry 전체에서 재사용하고 도구가 끝날 때만 폐기하며, getBranch는 1회만 호출한다(plan §PR3 캐시 수명 정본).

---

## 4. details.sideChat 스키마 (OQ6, Constraint 5)

**신규 optional 필드** — `AskResultDetails`(ask.ts:127-131)·`SelectResultDetails`(:169-174)·`ConfirmResultDetails`(:481-486) **3종 모두**에 동일 배치. 기존 필드(question/selections/confirmed/freeText/source) 무변경. 채팅 미발생 시 필드 부재(AC1.4).

```ts
sideChat?: {
  turns: Array<{
    target:
      | { kind: "option"; label: string }   // 대상 옵션(canonical label)
      | { kind: "question" };                // 질문 자체 대상
    mode: "one-button" | "free-prompt";
    prompt: string;      // 렌더된 유저 프롬프트 전문(verbatim); free-prompt=사용자 입력 원문
    response: string;    // 에이전트 답변(중단 시 부분 응답 가능)
    model: string;       // "provider/id" (세션 현재 모델)
    startedAt: string;   // ISO 8601
    endedAt: string;     // ISO 8601
    status: "complete" | "aborted" | "error";
    error?: string;      // status==="error"일 때 pure redactor 통과 후의 provider/resolver 에러 메시지(시크릿 제외)
  }>;
}
```

**불변:** CONTENT envelope(ask.ts:75-107)에는 채팅이 절대 나타나지 않는다([C7], Constraint 4). details.sideChat만 테스트·감사 채널. apiKey/bearer 미기록(appendix-precedent §보안).

---

## 5. 캐시 1회 실측 절차 (OQ7, AC6.2, [C18])

- **provider:** Anthropic 권장(cacheRetention→cache_control 자동, applyPromptCaching; usage에 cache_read/cache_creation 노출). 세션 모델이 Anthropic이 아니면 OpenAI/Codex는 prompt_cache_key 경로로도 관찰 가능하나 cache_read 신호가 가장 명확한 Anthropic으로 실측 권고.
- **구성:** SideChatSession은 질문당 최초 side interaction에서 정확히 한 번 생성한다. nonce/sessionId/promptCacheKey/model/systemPrompt/canonicalized getBranch snapshot을 freeze하고, panel close/reopen·turn·retry 전체에서 재사용하며 도구가 끝날 때만 폐기한다. getBranch는 1회만 호출한다. (구성치: promptCacheKey=메인 세션ID 시드(안정), sessionId=`{main}:side:{nonce}`(고유), cacheRetention 마커 전달 — StreamOptions.cacheRetention, ai/src/types.ts:372.)
- **관찰:** StreamOptions.onResponse(ProviderResponseMetadata) 콜백 또는 완료 AssistantMessage의 usage에서 cache_creation(가능한 provider)과 **2턴째 cache_read_input_tokens > 0** 확인. 1턴=캐시 생성, 2턴부터 히트. **telemetry 부재 또는 값 0은 구조 테스트(U3) 통과와 별개로 AC6.2 미충족이며 증거 성공으로 기록하지 않는다(fail-closed)** — prompt_cache_key 전달 사실이나 "provider 미지원" 기록은 통과 근거가 아니다.
- **절차(craft):** 라이브 세션에서 컴포넌트 구동 → 원버튼 상세(1턴) → 같은 프리픽스로 후속 자유 프롬프트(2턴) → 2턴 usage 캡처.
- **기록:** craft 증거로 `.lsc/crafts/ask-readability-option-chat/plan/appendix-cache-probe.md`(신규, craft가 실측치 기입)에 provider·모델·1/2턴 usage·cache_read 토큰 수·타임스탬프 기록. 상시 테스트 아님(AC6.1 단위 테스트가 요청 형태를 고정, AC6.2는 1회 증거).
