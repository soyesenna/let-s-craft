# Appendix — External / Host Precedent & Security

> Core는 `plan.md` §Context. 여기는 재사용 선례와 보안·멀티레포 상세. [Cn] = claims.json 순서.

## 선례 (재사용)

- **BYO-completion canonical** — host eval completion-bridge.ts:124-164(vendored 17.0.5): getApiKey preflight → `completeSimple(model, {비공백 systemPrompt, messages}, {apiKey: resolver(model, sessionId), signal})` → stopReason error/aborted 게이트 + try/catch(resolver reject). 에러 이원성이 여기서 정본. omp 번들 examples/hooks/qna.ts가 custom 로더 안 complete 호출을 시연([C2]).
- **/btw runEphemeralTurn** — no-tools 리마인더 프롬프트 패턴, 고유 side sessionId + promptCacheKey 재사용 방식 참고([C9][C18]). extension엔 동등물 없음(host-internal) — BYO는 캐시 재사용·계측·난독화·in-flight 스냅샷을 상실(수용).
- **호스트 제거된 'Chat about this' wiring** — onChat→{kind:'chat'}→chatRedirect details([C14], 38a5c8a89 도입/48b2a742c typed/bcee73e58 제거). lets-craft 자체 chat-row 설계의 직접 UX 선례(재도입 없음 git -S 증명).
- **히스토리 스냅샷** — ctx.sessionManager.getBranch()(session-manager.ts:1715-1717, ReadonlySessionManager Pick 포함 :337) 직렬화. forkFrom/branch/appendMessage는 Pick에서 제외되어 사용 불가([C15]) — 스냅샷만.
- **가독성 렌더 기법** — pi-ask-user 검색·랩핑, 17.0.5 askDialog 인라인 preview(a741e0b38) 참고([C19]). 단 askDialog 자체는 미채택.
- **MCP sampling** — deprecated(SEP-2577), shape 참조만([C6]). 리스크 완화 카탈로그: no-tools 강제 + (여기선 상한 없음, R8) + ephemeral(details만) + 명시적 승격 없음.

## 보안 / 인증

- **OAuth 스티키·회전** — resolver(model, sessionId)에 side 고유 sessionId 일관 전달로 세션 스티키 유지([C13]). provider 에러=terminal AssistantMessage(도구 비오염), resolver 실패=예외(패널 에러). 실패·취소 시 목록 복귀(질문 생존, AC4).
- **시크릿 비기록** — details.sideChat에 apiKey/bearer 절대 미기록(prompt/response/model/타임스탬프/status만). BYO는 호스트 시크릿 난독화를 상실하므로([C9]) 로깅 표면을 details로 한정하고 원문 토큰 미노출.
- **no-tools 강제** — 사이드 호출은 tools 미제공 + no-tools 지시(루프 방지). 시스템 프롬프트 비공백(Codex 400 가드, Constraint 8).

## 멀티레포 / 격리

- **worktree 스코프** — 이 feature는 .lsc/worktrees/ask-readability-option-chat 내에서 구현; 크로스레포 상태 없음. side sessionId nonce는 메인 세션 오염 방지(OpenAI/Codex, [C18]).
- **fixture 격리** — fixture 모드는 UI 우회로 채팅 원천 비노출([C7]); 무인 CI 결정론 보존.
