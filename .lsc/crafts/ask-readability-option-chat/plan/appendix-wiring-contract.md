# ask-ui wiring contract v2 — Main 재비준 정본 (iteration 2 재작성의 SSOT)

v1(local://ask-ui-wiring-contract.md)을 대체한다. 변경 근거: architect blocking-redesign(P1-P4) + critic REVISE(N1-N13) + Main 재비준 D1-D4.

## 1. 배선 (D1 + P1 잔여 비준)

```ts
// src/ask-ui/types.ts (Node-safe)
export type AskExecutionContext = Pick<ExtensionContext,
  "model" | "models" | "modelRegistry" | "sessionManager" | "getSystemPrompt" | "hasUI">;
// ↑ import type 만 — 값 import 금지. (Pick 대상 멤버는 이 6개로 고정)

// src/ask-ui/index.ts (Bun leaf)
export function createAskRuntimeFactory(pi: ExtensionAPI): AskRuntimeBinder;
export type AskRuntimeBinder = (ctx: AskExecutionContext) => AskRuntime;

export interface AskRuntime {
  buildSelect(params: SelectParams): CustomFactoryFn<SelectResult>;
  buildConfirm(params: ConfirmParams): CustomFactoryFn<ConfirmResult>;
  buildAsk(params: AskParams): CustomFactoryFn<AskResult>;
}
```

- `registerAskTools(pi, binder?)` — wrapper는 **UI 채널에서만** execute의 ctx로 `binder(ctx)`를 호출해 bound `AskRuntime`을 만들고 `performX(channel, ui, params, runtime?)`의 4번째 인자로 전달한다. **fixture/unavailable 채널에서는 binder 호출 자체가 0회**다.
- `performX` 시그니처는 v1과 동일(불변): `performX(channel, ui, params, runtime?)`. runtime===undefined → legacy 경로.
- main.ts: `registerAskTools(pi, createAskRuntimeFactory(pi))`. production 조립 판별자(critic bar ②): Bun 테스트가 plugin default export를 실제 등록 → captured lsc_select execute를 UI 채널로 호출 → binder(ctx) 호출·custom 도달을 관측.

## 2. 결과 union (T — CS4, N13 SSOT)

```ts
type SelectResult  = { kind: "answer"; selections: string[]; freeText?: string } | { kind: "cancel" };
type ConfirmResult = { kind: "answer"; confirmed: boolean | null; freeText?: string } | { kind: "cancel" };
type AskResult     = { kind: "answer"; response: string } | { kind: "cancel" };
```
- free-text 운반 필드: select/confirm=`freeText`, ask=`response` — 도구별 details 타입(SelectResultDetails 등 기존)과 1:1 매핑. undefined는 정상 결과가 아님(cancel도 명시 union).

## 3. 포커스 도메인 (D2 + P2 잔여 비준)

- `canonicalCursor` 정수 도메인 확장: **-1=질문 헤더, 0..n-1=옵션, n=Other, n+1=Done(multi && checked>0일 때만 존재)**.
- 컨트롤 행은 포커스·활성 가능: Other Enter→editor 체인(현행 parity), Done Enter→커밋.
- multi: **옵션 행 Enter=토글(Space 동등)**, 커밋은 Done Enter만. single/confirm: 옵션 행 Enter=커밋.
- 검색(search) 서브모드 중 `?`/`t` 무효(printable은 쿼리 입력), filtered 커서 이동→원본 index 선택, empty-result 안전.

## 4. CompletionPort (v1 유지 + D3 보정)

```ts
interface SideChatRequest {
  systemPrompt: string;               // 비공백
  messages: SideChatMessage[];        // getBranch 스냅샷(1회·freeze) prefix + 문답
  model: string;
  sessionId: string;                  // `{main}:side:{nonce}` — 질문당 1회 생성·freeze
  promptCacheKey: string;             // 메인 세션ID 시드
  cacheRetention: "none" | "short" | "long";  // pi-ai 정확 union — 기본 "short" (D3; v1의 string/"5m" 폐기)
}
interface SideChatResult { text: string; status: "complete" | "error" | "aborted"; error?: string; usage?: SideUsage }
interface CompletionPort { run(req: SideChatRequest, opts: { signal: AbortSignal; onDelta?: (d: string) => void }): Promise<SideChatResult> }
```
- tools 필드 없음(no-tools = 어댑터가 stream에 미전달). 에러 이원성: provider terminal→resolved {status:"error"}, resolver reject→throw→normalizeSideError. error 문자열은 redactSecrets 통과 후에만 저장.
- B2는 typed 페이크 + 호출 인자 캡처로 실제 createCompletionPort를 검증: model·{systemPrompt:[...]}·변환 메시지·tools 부재·apiKey resolver·signal·sessionId·promptCacheKey·cacheRetention("short"|"long")·terminal error/aborted/usage(cacheRead/cacheWrite) 매핑.

## 5. 이벤트 어휘 보강 (D3, N1/N2)

- reducer는 순수 — 시간은 이벤트 페이로드로 주입: `startTurn{at: string(ISO)}`, `settle{result, at}` → SideChatTurn.startedAt/endedAt는 이 값 복사. 테스트는 ISO 형식·결정론 검증.
- retry: error 상태에서 `r` → `retryTurn{at}` — **createSession 재호출 없음**(동결 세션 재사용), 새 turnId(단조), 실패 턴과 **byte-equal 동일 프롬프트** 재전송.

## 6. 렌더 oracle 정책 (D4)

- exact RGB/ANSI byte 스냅샷은 **비계약**(팔레트는 craft-tunable). 테스트 소유 불변식만 계약: 9역할 매핑(각 역할 fgCode가 해당 요소에 적용)·pairwise 역할 구분·light≠dark 적응·명시 reference bg 대비 방향·styled run의 RESET 종결·크기 시퀀스(OSC66/DECDWL/DECDHL/DECSWL) 부재.
- description 도달성은 sparse sentinel 금지 — 정규화된 원문 세그먼트 전체의 union으로 검증, 고정 스크롤 상한(30) 제거(수렴 조건으로 대체).
- production ROLE_TABLE을 기대값 산출에 재사용하는 oracle-mirror 금지(불변식 판정에 필요한 역할→코드 조회는 허용하되, '값 자체가 옳다'는 단언의 근거로 쓰지 않는다).

## 7. 러너 fail-closed (P4)

- package-lock 해시 스탬프 비교 → 변경 시 npm ci 강제.
- sync 전 feature 네임스페이스(test/ask-ui-*.test.ts, test-bun/ask-ui-*.test.ts) 정확 정리(잔존 사본 제거).
- 결정론 Bun 스위트(B1-B3)는 bun 존재 시 **기본 실행 필수**(LSC_BUN 게이트는 부재 시 skip 사유 출력용); 명시 게이트(LSC_E2E=1/LSC_BUN=1)에서 전제 미충족은 **nonzero**.
- 유닛 스테이지 전 `LSC_FIXTURE=` 클리어(env 위생). E1은 3도구 각각 fixture 스크립트로 구동 + 도구별 positive guard.
- 신규 Node 회귀: package.json/package-lock에 pi-coding-agent/pi-ai/pi-tui 3종 exact `17.0.5` 핀 검증(단, 이 테스트는 PR1 전 RED — U5와 같은 'RED until PR1' 클래스로 라벨).
- import 경계 가드: 정적 `import … from` 외 dynamic import·side-effect import·`export … from` 재수출까지 검사, 경로 정규화.

## 8. 소유권 (재작성 배정)

| 파일 | 소유 |
|---|---|
| ask-ui-state / render-model / palette / completion-core .test.ts | TesterUnit |
| ask-ui-integration / fallback / destructive-parity / fixture-isolation .test.ts | TesterIntegration |
| ask-ui-e2e.test.ts, test-bun/ask-ui-adapter.test.ts(+production 조립 판별자), docs/cache-probe-procedure.md, docs/o1-live-spike-procedure.md(신설) | TesterE2E |
| ask-ui-snapshot.test.ts | TesterSnapshot |
| ask-ui-contract-regression.test.ts(파일명 유지, 헤더에 'baseline pins + U5/pin future contract' 명시), run_test.sh | TesterRegression |

## 9. 보강 (iteration 2 중 확정)
- §2 결과 union의 answer variant는 optional `sideChat?: SideChatTurn[]`을 포함한다 — performX가 이를 각 details 타입의 `sideChat: { turns: [...] }`로 매핑(미발생 시 필드 부재). done payload가 turns의 유일 운반 경로.

## 10. §5 이벤트 어휘 정정 (N-D, doc-only — 자산 5파일은 이미 이 어휘로 정합)
- 비준 어휘: `session{at}`(최초 사이드 상호작용, auto-fire) · `key{detail|enter|retry, at}` · `settle{turnId, result, at}` · delta 이벤트는 at 없음. `startTurn`은 이벤트가 아니라 **effect**({turnId, request:SideChatRequest} 운반)다. §5 본문의 startTurn/settle/retryTurn '이벤트' 표기는 이 어휘로 대체 해석한다.
